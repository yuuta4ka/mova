import { createServer } from 'node:http';
import { randomBytes, randomInt, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';
import webpush from 'web-push';
import { openDatabase, resolveDataPaths } from './database.mjs';
import { backupIfDue, resolveBackupConfig } from './backup.mjs';
import { MaintenanceStore } from './maintenance.mjs';
import { MovaMetrics, createLogger, requestId, routeName } from './observability.mjs';
import { createEmailService } from './email.mjs';
import { contentDisposition } from './file-download.mjs';

const serverRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverRoot, '..');
const publicRoot = resolve(projectRoot, 'dist');
const dataPaths = resolveDataPaths(projectRoot);
const maintenance = new MaintenanceStore(process.env.MOVA_MAINTENANCE_PATH ? resolve(process.env.MOVA_MAINTENANCE_PATH) : join(dirname(dataPaths.sqlitePath), 'maintenance.json'));
const port = Number(process.env.PORT || process.env.MOVA_PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const secret = process.env.MOVA_SESSION_SECRET || 'mova-local-development-secret';
const clients = new Map();
const voiceRooms = new Map();
const voiceStates = new Map();
const voiceReconnectTimers = new Map();
const activeCalls = new Map();
const callCleanupTimers = new Map();
const voiceReconnectGraceMs = Math.max(1_000, Number(process.env.MOVA_VOICE_RECONNECT_GRACE_MS || 12_000));
const hashAsync = promisify(scrypt);
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
const metrics = new MovaMetrics();
const rateLimits = new Map();
let database;
let pushPublicKey = '';
let backupInFlight = null;

function decodeMessageCursor(value) {
  if (!value) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (cursor.v !== 1 || typeof cursor.createdAt !== 'string' || typeof cursor.id !== 'string' || !cursor.createdAt || !cursor.id) return null;
    return cursor;
  } catch {
    return null;
  }
}

function configureWebPush() {
  const environmentPublicKey = String(process.env.MOVA_VAPID_PUBLIC_KEY || '');
  const environmentPrivateKey = String(process.env.MOVA_VAPID_PRIVATE_KEY || '');
  let publicKey = environmentPublicKey;
  let privateKey = environmentPrivateKey;
  if (!publicKey || !privateKey) {
    publicKey = database.metadata('vapid_public_key') || '';
    privateKey = database.metadata('vapid_private_key') || '';
  }
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    database.setMetadata('vapid_public_key', publicKey);
    database.setMetadata('vapid_private_key', privateKey);
  }
  pushPublicKey = publicKey;
  webpush.setVapidDetails(process.env.MOVA_VAPID_SUBJECT || 'mailto:admin@hola-mova.ru', publicKey, privateKey);
}

function pushAllowed(userId) {
  const user = database.getUserById(userId);
  if (!user) return false;
  if (user.presence !== 'dnd') return true;
  return Boolean(user.dndUntil && user.dndUntil !== 'forever' && new Date(user.dndUntil).getTime() <= Date.now());
}

async function sendPushToUser(userId, notification) {
  if (!pushPublicKey || (notification.kind !== 'close' && !pushAllowed(userId))) return;
  await Promise.all(
    database.pushSubscriptions(userId).map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(notification), { TTL: notification.kind === 'call' ? 45 : 86_400, urgency: notification.kind === 'call' ? 'high' : 'normal' });
      } catch (error) {
        if ([404, 410].includes(Number(error?.statusCode))) database.deletePushSubscription(subscription.endpoint);
        else logger.warn('push.delivery_failed', { statusCode: error?.statusCode, error });
      }
    }),
  );
}

function closeCallPush(conversationId) {
  for (const userId of database.memberIds(conversationId))
    void sendPushToUser(userId, { kind: 'close', closeTag: `mova-call-${conversationId}` });
}

function messagePushNotification(message, recipientId) {
  const author = database.getUserById(message.authorId);
  const conversation = database.getConversation(message.conversationId);
  if (!author || !conversation || recipientId === message.authorId || (message.kind && message.kind !== 'user')) return null;
  const title = conversation.kind === 'group' ? `${author.name} · ${conversation.title}` : author.name;
  const body = String(message.content || '').trim() || (message.attachment?.type?.startsWith('image/') ? 'Фотография' : message.attachment?.type?.startsWith('audio/') && message.attachment.durationMs ? 'Голосовое сообщение' : message.attachment ? `Файл: ${message.attachment.name}` : 'Новое сообщение');
  return {
    kind: 'message',
    title,
    body,
    icon: author.avatarDataUrl || '/icon-192.png',
    badge: '/icon-192.png',
    tag: `mova-conversation-${message.conversationId}`,
    conversationId: message.conversationId,
    url: `/app?conversation=${encodeURIComponent(message.conversationId)}`,
  };
}

function pushMessage(message) {
  for (const userId of database.memberIds(message.conversationId)) {
    const notification = messagePushNotification(message, userId);
    if (notification) void sendPushToUser(userId, notification);
  }
}

const defaultIceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
function rtcIceServers() {
  if (process.env.MOVA_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.MOVA_ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (error) {
      logger.error('rtc.configuration_invalid', { source: 'MOVA_ICE_SERVERS', error });
    }
  }
  const urls = String(process.env.MOVA_TURN_URLS || process.env.MOVA_TURN_URL || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return urls.length
    ? [
        ...defaultIceServers,
        {
          urls,
          username: process.env.MOVA_TURN_USERNAME || '',
          credential: process.env.MOVA_TURN_CREDENTIAL || '',
        },
      ]
    : defaultIceServers;
}

const id = (prefix) => `${prefix}_${randomBytes(10).toString('hex')}`;
const instanceId = id('instance');
const instanceStartedAt = new Date().toISOString();
const logger = createLogger({ instanceId });
const emailService = createEmailService({ logger });
const authTestBypass = process.env.MOVA_AUTH_TEST_BYPASS === '1';
const secureEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && leftBuffer.length > 0 && timingSafeEqual(leftBuffer, rightBuffer);
};
const publicUser = (storedUser) => {
  if (!storedUser) return null;
  const { passwordHash, sessionVersion, ...user } = storedUser;
  const normalized = user.presence === 'dnd' && user.dndUntil && user.dndUntil !== 'forever' && new Date(user.dndUntil).getTime() <= Date.now() ? { ...user, presence: 'online', dndUntil: null } : user;
  const connected = Boolean(clients.get(user.id)?.size);
  return {
    ...normalized,
    isOnline: normalized.presence !== 'invisible' && connected,
  };
};
const userDto = (storedUser, viewerId) => {
  const user = publicUser(storedUser);
  return user && viewerId ? { ...user, relationship: database.relationship(viewerId, user.id) } : user;
};
const normalizeEmail = (email) =>
  String(email || '')
    .trim()
    .toLowerCase();
const validEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${Buffer.from(await hashAsync(password, salt, 64)).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = Buffer.from(await hashAsync(password, salt, 64));
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ userId: user.id, sessionVersion: Number(user.sessionVersion || 1), exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function tokenUser(token) {
  try {
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', secret).update(payload).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'base64url'))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    const user = database.getUserById(data.userId);
    if (!user || Number(data.sessionVersion || 1) !== Number(user.sessionVersion || 1)) return null;
    return user;
  } catch {
    return null;
  }
}

const emailChallengeTtlMs = 10 * 60_000;
const emailChallengeMaxAttempts = 5;
const emailChallengeHash = (challengeId, code) => createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
const createEmailCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

function createStoredUser({ name, email, passwordHash }) {
  const colors = ['#74DCCB', '#9B83F4', '#FF8D72', '#F3C96B', '#68CFA4'];
  const baseHandle = `@${email.split('@')[0].replace(/[^a-z0-9_.]/gi, '').slice(0, 24) || 'user'}`;
  let handle = baseHandle;
  let suffix = 1;
  while (database.getUserByHandle(handle)) handle = `${baseHandle}${suffix++}`;
  const createdAt = new Date().toISOString();
  return {
    id: id('usr'),
    name,
    email,
    handle,
    color: colors[database.count('users') % colors.length],
    presence: 'online',
    dndUntil: null,
    bio: '',
    avatarDataUrl: '',
    bannerDataUrl: '',
    activity: null,
    lastActiveAt: createdAt,
    passwordHash,
    emailVerifiedAt: createdAt,
    sessionVersion: 1,
    createdAt,
  };
}

function emailChallengeResponse(challenge) {
  return {
    challengeId: challenge.id,
    email: challenge.email,
    expiresAt: challenge.expiresAt,
    resendAfterSeconds: 60,
  };
}

async function issueEmailChallenge({ purpose, email, userId = null, payload = {}, send = true }) {
  if (!emailService.configured) throw Object.assign(new Error('Отправка писем пока не настроена'), { statusCode: 503 });
  const previousChallenge = database.latestPendingEmailChallenge(purpose, email);
  const resendAt = previousChallenge ? new Date(previousChallenge.createdAt).getTime() + 60_000 : 0;
  if (resendAt > Date.now()) {
    const waitSeconds = Math.max(1, Math.ceil((resendAt - Date.now()) / 1000));
    throw Object.assign(new Error(`Новый код можно запросить через ${waitSeconds} сек.`), { statusCode: 429 });
  }
  const challengeId = id('eml');
  const code = createEmailCode();
  const createdAt = new Date().toISOString();
  const challenge = {
    id: challengeId,
    purpose,
    userId,
    email,
    codeHash: emailChallengeHash(challengeId, code),
    payload,
    expiresAt: new Date(Date.now() + emailChallengeTtlMs).toISOString(),
    createdAt,
  };
  database.createEmailChallenge(challenge);
  if (send) {
    try {
      await emailService.sendCode({ to: email, code, purpose });
    } catch (error) {
      database.deleteEmailChallenge(challengeId);
      logger.warn('email.code_delivery_failed', { purpose, error });
      throw Object.assign(new Error('Не удалось отправить письмо. Попробуйте позже'), { statusCode: Number(error?.statusCode) || 502 });
    }
  }
  return challenge;
}

function requireEmailChallenge({ challengeId, purpose, code, userId }) {
  const challenge = database.getEmailChallenge(String(challengeId || ''));
  const invalid = () => Object.assign(new Error('Неверный или просроченный код'), { statusCode: 400 });
  if (!challenge || challenge.purpose !== purpose || challenge.consumedAt || (userId && challenge.userId !== userId)) throw invalid();
  if (new Date(challenge.expiresAt).getTime() <= Date.now() || challenge.attemptCount >= emailChallengeMaxAttempts) {
    database.consumeEmailChallenge(challenge.id);
    throw invalid();
  }
  const normalizedCode = String(code || '').trim();
  if (!/^\d{6}$/u.test(normalizedCode) || !secureEqual(emailChallengeHash(challenge.id, normalizedCode), challenge.codeHash)) {
    database.incrementEmailChallengeAttempts(challenge.id, challenge.attemptCount + 1 >= emailChallengeMaxAttempts);
    throw invalid();
  }
  return challenge;
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
async function body(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 12_000_000) throw Object.assign(new Error('Payload too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Некорректный JSON'), { statusCode: 400 });
  }
}
async function binaryBody(request, maximum = 8_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw Object.assign(new Error('Файл должен быть меньше 8 МБ'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function allowRequest(key, maximum, intervalMs) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + intervalMs });
    return true;
  }
  current.count += 1;
  return current.count <= maximum;
}
function requestIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function auth(request) {
  return tokenUser(request.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
}
function isMember(userId, conversationId) {
  return database.isMember(userId, conversationId);
}
function forwardedFromDto(forwardedFrom, viewerId) {
  if (!forwardedFrom) return undefined;
  const sourceVisible = Boolean(
    viewerId
      && forwardedFrom.conversationId
      && forwardedFrom.messageId
      && database.isMember(viewerId, forwardedFrom.conversationId)
      && database.isMessageVisibleTo(forwardedFrom.messageId, forwardedFrom.conversationId, viewerId),
  );
  const sourceAuthor = database.getUserById(forwardedFrom.authorId);
  return {
    authorId: forwardedFrom.authorId,
    authorName: sourceAuthor?.name || forwardedFrom.authorName || 'Пользователь',
    createdAt: forwardedFrom.createdAt,
    canOpen: sourceVisible,
    ...(sourceVisible ? { conversationId: forwardedFrom.conversationId, messageId: forwardedFrom.messageId } : {}),
  };
}
function messageDto(message, readStates = database.readStates(message.conversationId), viewerId) {
  const replyMessage = message.replyToId ? database.getMessage(message.replyToId, message.conversationId) : null;
  const replyAuthor = replyMessage ? database.getUserById(replyMessage.authorId) : null;
  return {
    ...message,
    sentAt: message.sentAt || message.createdAt,
    readBy: readStates.filter((receipt) => receipt.userId !== message.authorId && receipt.readAt >= message.createdAt),
    listenedBy: message.attachment?.type?.startsWith('audio/') && message.attachment.durationMs ? database.voiceListens(message.id) : [],
    author: userDto(database.getUserById(message.authorId), viewerId),
    ...(message.forwardedFrom ? { forwardedFrom: forwardedFromDto(message.forwardedFrom, viewerId) } : {}),
    ...(replyMessage && replyAuthor
      ? {
          replyTo: {
            id: replyMessage.id,
            authorId: replyMessage.authorId,
            content: replyMessage.content,
            ...(replyMessage.attachment
              ? {
                  attachmentName: replyMessage.attachment.name,
                  attachment: replyMessage.attachment,
                }
              : {}),
            author: userDto(replyAuthor, viewerId),
          },
        }
      : {}),
  };
}
function conversationDto(conversation, userId) {
  const members = database.members(conversation.id).map((member) => userDto(member, userId));
  const storedLastMessage = database.lastMessage(conversation.id, userId);
  const lastMessage = storedLastMessage
    ? {
        ...storedLastMessage,
        sentAt: storedLastMessage.sentAt || storedLastMessage.createdAt,
        readBy: Array.isArray(storedLastMessage.readBy) ? storedLastMessage.readBy : [],
        ...(storedLastMessage.forwardedFrom ? { forwardedFrom: forwardedFromDto(storedLastMessage.forwardedFrom, userId) } : {}),
      }
    : null;
  return {
    ...conversation,
    members,
    memberRoles: conversation.kind === 'group' ? database.memberRoles(conversation.id) : undefined,
    title: conversation.kind === 'direct' ? members.find((member) => member.id !== userId)?.name || 'Сохранённое' : conversation.title,
    lastMessage,
    unreadCount: database.unreadCount(conversation.id, userId),
    isDraft: conversation.kind === 'direct' && !lastMessage,
  };
}
function directOtherUserId(conversationId, userId) {
  const conversation = database.getConversation(conversationId);
  if (!conversation || conversation.kind !== 'direct') return null;
  return database.memberIds(conversationId).find((memberId) => memberId !== userId) || null;
}
function canInteractInConversation(conversationId, userId) {
  const otherUserId = directOtherUserId(conversationId, userId);
  return !otherUserId || !database.isBlockedEither(userId, otherUserId);
}
function canCallInConversation(conversationId, userId) {
  const conversation = database.getConversation(conversationId);
  if (!conversation || conversation.kind === 'saved') return false;
  const otherUserId = directOtherUserId(conversationId, userId);
  return !otherUserId || database.areFriends(userId, otherUserId);
}
function sendToUser(userId, event) {
  const payload = JSON.stringify(event);
  for (const socket of clients.get(userId) || []) safeSocketSend(socket, payload);
}
function broadcastRelationship(firstUserId, secondUserId) {
  const first = database.getUserById(firstUserId);
  const second = database.getUserById(secondUserId);
  if (second) sendToUser(firstUserId, { type: 'relationship:update', user: userDto(second, firstUserId) });
  if (first) sendToUser(secondUserId, { type: 'relationship:update', user: userDto(first, secondUserId) });
}
function broadcastMessage(type, message) {
  const readStates = database.readStates(message.conversationId);
  for (const userId of database.memberIds(message.conversationId)) {
    sendToUser(userId, { type, message: messageDto(message, readStates, userId) });
  }
  if (type === 'message:new') pushMessage(message);
}
function ensureDirectConversation(firstUserId, secondUserId) {
  const existing = database.findDirectConversation(firstUserId, secondUserId);
  if (existing) return existing;
  const conversation = {
    id: id('cnv'),
    kind: 'direct',
    title: '',
    createdBy: firstUserId,
    createdAt: new Date().toISOString(),
  };
  database.createConversation(conversation, [firstUserId, secondUserId]);
  return conversation;
}
function ensureSavedConversation(userId) {
  const existing = database.findSavedConversation(userId);
  if (existing) return existing;
  const conversation = {
    id: id('saved'),
    kind: 'saved',
    title: 'Избранное',
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  try {
    database.createConversation(conversation, [userId]);
    return conversation;
  } catch (error) {
    const concurrent = database.findSavedConversation(userId);
    if (concurrent) return concurrent;
    throw error;
  }
}
function createFriendRequestMessage(requester, otherUserId) {
  const conversation = ensureDirectConversation(requester.id, otherUserId);
  const createdAt = new Date().toISOString();
  const message = {
    id: id('msg'),
    conversationId: conversation.id,
    authorId: requester.id,
    kind: 'friend_request',
    content: 'Заявка в друзья',
    friendRequest: { requestedBy: requester.id, status: 'pending' },
    createdAt,
    sentAt: createdAt,
    readBy: [],
  };
  database.insertMessage(message);
  broadcastToConversation(conversation.id, { type: 'conversation:new', conversationId: conversation.id });
  broadcastMessage('message:new', message);
}
function finishFriendRequest(firstUserId, secondUserId, requestedBy, status) {
  const conversation = database.findDirectConversation(firstUserId, secondUserId);
  if (!conversation) return;
  const message = database.updatePendingFriendRequest(conversation.id, requestedBy, status);
  if (message) broadcastMessage('message:update', message);
}
function broadcastToConversation(conversationId, event, exceptUserId) {
  const payload = JSON.stringify(event);
  for (const userId of database.memberIds(conversationId)) if (userId !== exceptUserId) for (const socket of clients.get(userId) || []) safeSocketSend(socket, payload);
}
function broadcastAll(event, exceptUserId) {
  const payload = JSON.stringify(event);
  for (const [userId, sockets] of clients) if (userId !== exceptUserId) for (const socket of sockets) safeSocketSend(socket, payload);
}
function safeSocketSend(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 2_000_000) return socket.close(4008, 'Client too slow');
  socket.send(payload);
}
function synchronizeSocketGameActivity(userId) {
  const activeSocket = [...(clients.get(userId) || [])]
    .filter((socket) => socket.gameActivityName)
    .sort((left, right) => (right.gameActivityChangedAt || 0) - (left.gameActivityChangedAt || 0))[0];
  const currentUser = database.getUserById(userId);
  if (!currentUser) return;
  const nextName = activeSocket?.gameActivityName || '';
  if ((currentUser.activity?.name || '') === nextName) return;
  currentUser.activity = nextName ? { type: 'game', name: nextName, startedAt: new Date().toISOString() } : null;
  database.updateUser(currentUser);
  broadcastAll({ type: 'profile:update', user: publicUser(currentUser) });
}
function roomUserIds(conversationId) {
  return [...(voiceRooms.get(conversationId)?.keys() || [])];
}
function voiceReconnectKey(conversationId, userId) {
  return `${conversationId}:${userId}`;
}
function clearVoiceReconnect(conversationId, userId) {
  const key = voiceReconnectKey(conversationId, userId);
  const timer = voiceReconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  voiceReconnectTimers.delete(key);
}
function voiceStateFor(conversationId, userId) {
  if (!voiceStates.has(conversationId)) voiceStates.set(conversationId, new Map());
  const states = voiceStates.get(conversationId);
  if (!states.has(userId)) states.set(userId, { muted: false, deafened: false, media: {} });
  return states.get(userId);
}
function roomSnapshot(conversationId) {
  const room = voiceRooms.get(conversationId);
  if (!room) return [];
  return [...room.entries()].map(([userId, sockets]) => {
    const state = voiceStateFor(conversationId, userId);
    return {
      userId,
      connectionState: sockets.size ? 'connected' : 'reconnecting',
      muted: Boolean(state.muted),
      deafened: Boolean(state.deafened),
      media: { ...state.media },
    };
  });
}
function broadcastVoiceSnapshot(conversationId) {
  broadcastToConversation(conversationId, { type: 'voice:snapshot', conversationId, participants: roomSnapshot(conversationId) });
}
function callStateFor(conversationId, socket) {
  const active = activeCalls.get(conversationId);
  return {
    type: 'call:state',
    conversationId,
    status: active?.status || 'idle',
    ...(active
      ? {
          from: publicUser(database.getUserById(active.fromUserId)),
          createdAt: new Date(active.createdAt).toISOString(),
          ...(active.startedAt ? { startedAt: new Date(active.startedAt).toISOString() } : {}),
        }
      : {}),
    participants: roomUserIds(conversationId),
    room: roomSnapshot(conversationId),
    joined: socket.voiceConversationId === conversationId,
  };
}
function clearCallCleanup(conversationId) {
  const timer = callCleanupTimers.get(conversationId);
  if (timer) clearTimeout(timer);
  callCleanupTimers.delete(conversationId);
}
function callDurationLabel(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .slice(hours ? 0 : 1)
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
function finishCall(conversationId, fallbackUserId = '') {
  const call = activeCalls.get(conversationId);
  if (!call) return;
  activeCalls.delete(conversationId);
  clearCallCleanup(conversationId);
  closeCallPush(conversationId);
  const endedAt = Date.now();
  broadcastToConversation(conversationId, {
    type: 'call:end',
    conversationId,
    fromUserId: call.fromUserId || fallbackUserId,
  });
  if (!call.startedAt) return;
  const durationSeconds = Math.max(0, Math.floor((endedAt - call.startedAt) / 1000));
  const createdAt = new Date(endedAt).toISOString();
  const message = {
    id: id('msg'),
    conversationId,
    authorId: call.fromUserId || fallbackUserId,
    kind: 'call',
    content: `Звонок завершён · ${callDurationLabel(durationSeconds)}`,
    call: {
      status: 'completed',
      durationSeconds,
      startedAt: new Date(call.startedAt).toISOString(),
      endedAt: createdAt,
    },
    createdAt,
    sentAt: createdAt,
    readBy: [],
  };
  database.insertMessage(message);
  broadcastMessage('message:new', message);
}
function scheduleCallCleanup(conversationId, delay = 60_000) {
  clearCallCleanup(conversationId);
  const timer = setTimeout(() => {
    callCleanupTimers.delete(conversationId);
    if (voiceRooms.get(conversationId)?.size || !activeCalls.has(conversationId)) return;
    finishCall(conversationId);
  }, delay);
  callCleanupTimers.set(conversationId, timer);
}

async function handleApi(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/api/maintenance') return json(response, 200, await maintenance.read());
    if (request.method === 'GET' && url.pathname === '/api/ready') {
      database.sqlite.prepare('SELECT 1').get();
      return json(response, 200, { ok: true, storage: 'sqlite', journalMode: 'wal', instanceId, startedAt: instanceStartedAt });
    }
    if (request.method === 'POST' && url.pathname === '/api/maintenance') {
      const hookSecret = process.env.MOVA_DEPLOY_HOOK_SECRET || '';
      const providedSecret = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!hookSecret || !secureEqual(providedSecret, hookSecret)) return json(response, 401, { error: 'Deploy hook is not authorized' });
      const data = await body(request);
      if (typeof data.active !== 'boolean') return json(response, 400, { error: 'active must be boolean' });
      const state = await maintenance.update(data);
      return json(response, 200, state);
    }
    if (request.method === 'POST' && url.pathname === '/api/register') {
      if (!allowRequest(`register:${requestIp(request)}`, 5, 60_000)) throw Object.assign(new Error('Слишком много попыток регистрации'), { statusCode: 429 });
      const data = await body(request);
      const email = normalizeEmail(data.email);
      const name = String(data.name || '').trim();
      const password = String(data.password || '');
      if (name.length < 2 || name.length > 40 || !validEmail(email) || password.length < 8 || password.length > 200)
        return json(response, 400, {
          error: 'Укажите имя, корректную почту и пароль от 8 символов',
        });
      if (database.getUserByEmail(email))
        return json(response, 409, {
          error: 'Пользователь с такой почтой уже существует',
        });
      const passwordHash = await hashPassword(password);
      if (authTestBypass) {
        const user = createStoredUser({ name, email, passwordHash });
        try {
          database.insertUser(user);
        } catch (error) {
          if (String(error?.code || '').includes('CONSTRAINT')) return json(response, 409, { error: 'Пользователь с такой почтой или юзернеймом уже существует' });
          throw error;
        }
        return json(response, 201, { token: createToken(user), user: publicUser(user) });
      }
      if (!allowRequest(`register-email:${email}`, 3, 15 * 60_000)) throw Object.assign(new Error('Новый код можно запросить позже'), { statusCode: 429 });
      const challenge = await issueEmailChallenge({ purpose: 'registration', email, payload: { name, passwordHash } });
      return json(response, 202, emailChallengeResponse(challenge));
    }
    if (request.method === 'POST' && url.pathname === '/api/register/verify') {
      if (!allowRequest(`register-verify:${requestIp(request)}`, 20, 15 * 60_000)) throw Object.assign(new Error('Слишком много попыток подтверждения'), { statusCode: 429 });
      const data = await body(request);
      const challenge = requireEmailChallenge({ challengeId: data.challengeId, purpose: 'registration', code: data.code });
      if (database.getUserByEmail(challenge.email)) return json(response, 409, { error: 'Пользователь с такой почтой уже существует' });
      const user = createStoredUser({ name: String(challenge.payload.name || '').trim(), email: challenge.email, passwordHash: challenge.payload.passwordHash });
      try {
        database.transaction(() => {
          database.insertUser(user);
          if (!database.consumeEmailChallenge(challenge.id)) throw Object.assign(new Error('Код уже использован'), { statusCode: 409 });
        });
      } catch (error) {
        if (String(error?.code || '').includes('CONSTRAINT')) return json(response, 409, { error: 'Пользователь с такой почтой или юзернеймом уже существует' });
        throw error;
      }
      return json(response, 201, { token: createToken(user), user: publicUser(user) });
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      if (!allowRequest(`login:${requestIp(request)}`, 10, 60_000)) throw Object.assign(new Error('Слишком много попыток входа'), { statusCode: 429 });
      const data = await body(request);
      const user = database.getUserByEmail(normalizeEmail(data.email));
      if (!user || !(await verifyPassword(String(data.password || ''), user.passwordHash))) return json(response, 401, { error: 'Неверная почта или пароль' });
      return json(response, 200, {
        token: createToken(user),
        user: publicUser(user),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/password-reset/request') {
      if (!allowRequest(`password-reset:${requestIp(request)}`, 5, 15 * 60_000)) throw Object.assign(new Error('Слишком много запросов. Попробуйте позже'), { statusCode: 429 });
      const data = await body(request);
      const email = normalizeEmail(data.email);
      if (!validEmail(email)) return json(response, 400, { error: 'Укажите корректную почту' });
      if (!allowRequest(`password-reset-email:${email}`, 3, 15 * 60_000)) throw Object.assign(new Error('Новый код можно запросить позже'), { statusCode: 429 });
      const existingUser = database.getUserByEmail(email);
      const challenge = await issueEmailChallenge({ purpose: 'password_reset', email, userId: existingUser?.id || null, payload: { dummy: !existingUser }, send: Boolean(existingUser) });
      return json(response, 202, {
        ...emailChallengeResponse(challenge),
        message: 'Если аккаунт с такой почтой существует, код уже отправлен',
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/password-reset/confirm') {
      if (!allowRequest(`password-reset-confirm:${requestIp(request)}`, 20, 15 * 60_000)) throw Object.assign(new Error('Слишком много попыток подтверждения'), { statusCode: 429 });
      const data = await body(request);
      const password = String(data.password || '');
      if (password.length < 8 || password.length > 200) return json(response, 400, { error: 'Пароль должен содержать не менее 8 символов' });
      const challenge = requireEmailChallenge({ challengeId: data.challengeId, purpose: 'password_reset', code: data.code });
      const resetUser = challenge.userId ? database.getUserById(challenge.userId) : null;
      if (!resetUser) return json(response, 400, { error: 'Неверный или просроченный код' });
      resetUser.passwordHash = await hashPassword(password);
      resetUser.sessionVersion = Number(resetUser.sessionVersion || 1) + 1;
      database.transaction(() => {
        database.updateUser(resetUser);
        if (!database.consumeEmailChallenge(challenge.id)) throw Object.assign(new Error('Код уже использован'), { statusCode: 409 });
      });
      for (const socket of clients.get(resetUser.id) || []) socket.close(4001, 'Session revoked');
      return json(response, 200, { ok: true });
    }
    const user = auth(request);
    if (!user) return json(response, 401, { error: 'Требуется вход' });
    if (request.method === 'GET' && url.pathname === '/api/push-config') return json(response, 200, { publicKey: pushPublicKey });
    if (url.pathname === '/api/push-subscriptions' && request.method === 'POST') {
      if (!allowRequest(`push-subscription:${user.id}`, 20, 60_000)) throw Object.assign(new Error('Слишком много попыток регистрации уведомлений'), { statusCode: 429 });
      const data = await body(request);
      let endpoint;
      try {
        endpoint = new URL(String(data.endpoint || ''));
      } catch {
        return json(response, 400, { error: 'Некорректная push-подписка' });
      }
      if (endpoint.protocol !== 'https:' || !data.keys?.p256dh || !data.keys?.auth) return json(response, 400, { error: 'Некорректная push-подписка' });
      database.savePushSubscription(user.id, data);
      return json(response, 201, { ok: true });
    }
    if (url.pathname === '/api/push-subscriptions' && request.method === 'DELETE') {
      const data = await body(request);
      database.deletePushSubscription(String(data.endpoint || ''), user.id);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/uploads') {
      if (!allowRequest(`upload:${user.id}`, 30, 60_000)) throw Object.assign(new Error('Слишком много загрузок'), { statusCode: 429 });
      const type = String(request.headers['content-type'] || 'application/octet-stream').split(';')[0].slice(0, 120);
      let name = 'Файл';
      try {
        name = decodeURIComponent(String(request.headers['x-mova-file-name'] || 'Файл')).slice(0, 180);
      } catch {}
      const attachment = await database.storeBuffer(await binaryBody(request), name, type, user.id);
      return json(response, 201, { attachment });
    }
    if (request.method === 'GET' && url.pathname === '/api/rtc-config') return json(response, 200, { iceServers: rtcIceServers() });
    if (request.method === 'GET' && url.pathname === '/api/me') return json(response, 200, { user: userDto(user, user.id) });
    if (request.method === 'POST' && url.pathname === '/api/email-verification/request') {
      if (user.emailVerifiedAt) return json(response, 409, { error: 'Почта уже подтверждена' });
      if (!allowRequest(`email-verification:${user.id}`, 5, 15 * 60_000)) throw Object.assign(new Error('Слишком много запросов. Попробуйте позже'), { statusCode: 429 });
      if (!allowRequest(`email-verification-address:${user.email}`, 3, 15 * 60_000)) throw Object.assign(new Error('Новый код можно запросить позже'), { statusCode: 429 });
      const challenge = await issueEmailChallenge({ purpose: 'email_verification', email: user.email, userId: user.id });
      return json(response, 202, emailChallengeResponse(challenge));
    }
    if (request.method === 'POST' && url.pathname === '/api/email-verification/confirm') {
      if (user.emailVerifiedAt) return json(response, 409, { error: 'Почта уже подтверждена' });
      if (!allowRequest(`email-verification-confirm:${user.id}`, 20, 15 * 60_000)) throw Object.assign(new Error('Слишком много попыток подтверждения'), { statusCode: 429 });
      const data = await body(request);
      const challenge = requireEmailChallenge({ challengeId: data.challengeId, purpose: 'email_verification', code: data.code, userId: user.id });
      if (challenge.email !== user.email) return json(response, 409, { error: 'Адрес аккаунта изменился. Запросите новый код' });
      user.emailVerifiedAt = new Date().toISOString();
      database.transaction(() => {
        database.updateUser(user);
        if (!database.consumeEmailChallenge(challenge.id)) throw Object.assign(new Error('Код уже использован'), { statusCode: 409 });
      });
      const dto = publicUser(user);
      broadcastAll({ type: 'profile:update', user: dto }, user.id);
      return json(response, 200, { user: dto });
    }
    if (request.method === 'POST' && url.pathname === '/api/email-change/request') {
      if (!allowRequest(`email-change:${user.id}`, 5, 15 * 60_000)) throw Object.assign(new Error('Слишком много запросов. Попробуйте позже'), { statusCode: 429 });
      const data = await body(request);
      const email = normalizeEmail(data.email);
      if (!validEmail(email)) return json(response, 400, { error: 'Укажите корректную новую почту' });
      if (email === user.email) return json(response, 400, { error: 'Это уже текущая почта аккаунта' });
      if (database.getUserByEmail(email)) return json(response, 409, { error: 'Пользователь с такой почтой уже существует' });
      if (!(await verifyPassword(String(data.password || ''), user.passwordHash))) return json(response, 401, { error: 'Неверный текущий пароль' });
      if (!allowRequest(`email-change-address:${email}`, 3, 15 * 60_000)) throw Object.assign(new Error('Новый код можно запросить позже'), { statusCode: 429 });
      const challenge = await issueEmailChallenge({ purpose: 'email_change', email, userId: user.id });
      return json(response, 202, emailChallengeResponse(challenge));
    }
    if (request.method === 'POST' && url.pathname === '/api/email-change/confirm') {
      if (!allowRequest(`email-change-confirm:${user.id}`, 20, 15 * 60_000)) throw Object.assign(new Error('Слишком много попыток подтверждения'), { statusCode: 429 });
      const data = await body(request);
      const challenge = requireEmailChallenge({ challengeId: data.challengeId, purpose: 'email_change', code: data.code, userId: user.id });
      const emailOwner = database.getUserByEmail(challenge.email);
      if (emailOwner && emailOwner.id !== user.id) return json(response, 409, { error: 'Пользователь с такой почтой уже существует' });
      const previousEmail = user.email;
      user.email = challenge.email;
      user.emailVerifiedAt = new Date().toISOString();
      user.sessionVersion = Number(user.sessionVersion || 1) + 1;
      database.transaction(() => {
        database.updateUser(user);
        if (!database.consumeEmailChallenge(challenge.id)) throw Object.assign(new Error('Код уже использован'), { statusCode: 409 });
      });
      const dto = publicUser(user);
      const token = createToken(user);
      broadcastAll({ type: 'profile:update', user: dto }, user.id);
      void emailService.sendEmailChangedNotice({ to: previousEmail, newEmail: user.email });
      setTimeout(() => {
        for (const socket of clients.get(user.id) || []) socket.close(4001, 'Session renewed');
      }, 100);
      return json(response, 200, { token, user: dto });
    }
    if (request.method === 'GET' && url.pathname === '/api/users')
      return json(response, 200, {
        users: database.listUsers(user.id).map((otherUser) => userDto(otherUser, user.id)),
      });
    const friendRejectMatch = url.pathname.match(/^\/api\/friends\/([^/]+)\/reject$/);
    if (friendRejectMatch && request.method === 'POST') {
      const otherUser = database.getUserById(friendRejectMatch[1]);
      if (!otherUser || otherUser.id === user.id) return json(response, 404, { error: 'Пользователь не найден' });
      if (!database.rejectFriend(user.id, otherUser.id)) return json(response, 409, { error: 'Входящая заявка не найдена' });
      finishFriendRequest(user.id, otherUser.id, otherUser.id, 'declined');
      broadcastRelationship(user.id, otherUser.id);
      return json(response, 200, { user: userDto(otherUser, user.id) });
    }
    const friendMatch = url.pathname.match(/^\/api\/friends\/([^/]+)$/);
    if (friendMatch) {
      const otherUser = database.getUserById(friendMatch[1]);
      if (!otherUser || otherUser.id === user.id) return json(response, 404, { error: 'Пользователь не найден' });
      if (request.method === 'POST') {
        if (database.isBlockedEither(user.id, otherUser.id)) return json(response, 409, { error: 'Сначала снимите блокировку' });
        const requestResult = database.requestFriend(user.id, otherUser.id);
        if (requestResult.retryAt) return json(response, 429, { error: 'Повторную заявку можно отправить через 24 часа после отказа', retryAt: requestResult.retryAt });
        if (requestResult.relationship === 'incoming') return json(response, 409, { error: 'Сначала примите входящую заявку' });
        if (requestResult.created) createFriendRequestMessage(user, otherUser.id);
        broadcastRelationship(user.id, otherUser.id);
        return json(response, 200, { user: userDto(otherUser, user.id) });
      }
      if (request.method === 'PATCH') {
        const relationship = database.acceptFriend(user.id, otherUser.id);
        if (relationship !== 'friend') return json(response, 409, { error: 'Входящая заявка не найдена' });
        finishFriendRequest(user.id, otherUser.id, otherUser.id, 'accepted');
        broadcastRelationship(user.id, otherUser.id);
        return json(response, 200, { user: userDto(otherUser, user.id) });
      }
      if (request.method === 'DELETE') {
        const previousRelationship = database.relationship(user.id, otherUser.id);
        if (previousRelationship === 'friend' || previousRelationship === 'outgoing') database.removeFriend(user.id, otherUser.id);
        if (previousRelationship === 'outgoing') finishFriendRequest(user.id, otherUser.id, user.id, 'cancelled');
        broadcastRelationship(user.id, otherUser.id);
        return json(response, 200, { user: userDto(otherUser, user.id) });
      }
    }
    const blockMatch = url.pathname.match(/^\/api\/blocks\/([^/]+)$/);
    if (blockMatch) {
      const otherUser = database.getUserById(blockMatch[1]);
      if (!otherUser || otherUser.id === user.id) return json(response, 404, { error: 'Пользователь не найден' });
      if (request.method === 'POST') {
        const previousRelationship = database.relationship(user.id, otherUser.id);
        database.blockUser(user.id, otherUser.id);
        if (previousRelationship === 'outgoing') finishFriendRequest(user.id, otherUser.id, user.id, 'cancelled');
        if (previousRelationship === 'incoming') finishFriendRequest(user.id, otherUser.id, otherUser.id, 'cancelled');
        broadcastRelationship(user.id, otherUser.id);
        return json(response, 200, { user: userDto(otherUser, user.id) });
      }
      if (request.method === 'DELETE') {
        database.unblockUser(user.id, otherUser.id);
        broadcastRelationship(user.id, otherUser.id);
        return json(response, 200, { user: userDto(otherUser, user.id) });
      }
    }
    if (request.method === 'PATCH' && url.pathname === '/api/profile') {
      const data = await body(request);
      const name = String(data.name || '').trim();
      const handle = String(data.handle || '')
        .trim()
        .toLowerCase();
      if (name.length < 2 || name.length > 40)
        return json(response, 400, {
          error: 'Имя должно содержать от 2 до 40 символов',
        });
      if (!/^@[a-z0-9_.]{3,24}$/.test(handle))
        return json(response, 400, {
          error: 'Юзернейм начинается с @ и содержит 3–24 латинских символа',
        });
      const handleOwner = database.getUserByHandle(handle);
      if (handleOwner && handleOwner.id !== user.id) return json(response, 409, { error: 'Этот юзернейм уже занят' });
      const rawAvatar = String(data.avatarDataUrl || '');
      const rawBanner = String(data.bannerDataUrl || '');
      if ((rawAvatar && !rawAvatar.startsWith('data:image/') && !rawAvatar.startsWith('/uploads/')) || rawAvatar.length > 8_000_000)
        return json(response, 400, {
          error: 'Аватар слишком большой или имеет неверный формат',
        });
      if ((rawBanner && !rawBanner.startsWith('data:image/') && !rawBanner.startsWith('/uploads/')) || rawBanner.length > 8_000_000)
        return json(response, 400, {
          error: 'Шапка слишком большая или имеет неверный формат',
        });
      const avatarDataUrl = await database.normalizeProfileImage(rawAvatar, `${user.id}-avatar`, user.id);
      const bannerDataUrl = await database.normalizeProfileImage(rawBanner, `${user.id}-banner`, user.id);
      Object.assign(user, {
        name,
        handle,
        bio: String(data.bio || '')
          .trim()
          .slice(0, 240),
        avatarDataUrl,
        bannerDataUrl,
      });
      database.updateUser(user);
      const dto = publicUser(user);
      broadcastAll({ type: 'profile:update', user: dto }, user.id);
      return json(response, 200, { user: dto });
    }
    if (request.method === 'POST' && url.pathname === '/api/activity') {
      if (!allowRequest(`activity:${user.id}`, 30, 60_000)) throw Object.assign(new Error('Слишком много обновлений активности'), { statusCode: 429 });
      const data = await body(request);
      const name = String(data.name || '').trim().slice(0, 80);
      if ((user.activity?.name || '') === name) return json(response, 200, { user: publicUser(user) });
      user.activity = name ? { type: 'game', name, startedAt: new Date().toISOString() } : null;
      database.updateUser(user);
      const dto = publicUser(user);
      broadcastAll({ type: 'profile:update', user: dto }, user.id);
      return json(response, 200, { user: dto });
    }
    if (request.method === 'POST' && url.pathname === '/api/presence') {
      const data = await body(request);
      const allowed = ['online', 'idle', 'dnd', 'invisible'];
      if (!allowed.includes(data.presence)) return json(response, 400, { error: 'Неизвестный статус' });
      user.presence = data.presence;
      user.dndUntil = data.presence === 'dnd' ? data.dndUntil || 'forever' : null;
      user.lastActiveAt = new Date().toISOString();
      database.updateUser(user);
      const dto = publicUser(user);
      broadcastAll({ type: 'presence:update', user: dto }, user.id);
      return json(response, 200, { user: dto });
    }
    if (request.method === 'GET' && url.pathname === '/api/conversations') {
      ensureSavedConversation(user.id);
      const conversations = database.listConversations(user.id)
        .map((item) => conversationDto(item, user.id))
        .filter((conversation) => !conversation.isDraft || conversation.createdBy === user.id);
      return json(response, 200, {
        conversations: conversations.sort(
          (left, right) => Number(right.kind === 'saved') - Number(left.kind === 'saved')
            || new Date(right.lastMessage?.createdAt || right.createdAt).getTime() - new Date(left.lastMessage?.createdAt || left.createdAt).getTime(),
        ),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/conversations') {
      const data = await body(request);
      const requestedIds = [...new Set((data.memberIds || []).filter((memberId) => database.getUserById(memberId) && memberId !== user.id))];
      if (data.kind === 'direct' && requestedIds.length === 1) {
        const existing = database.findDirectConversation(user.id, requestedIds[0]);
        if (existing)
          return json(response, 200, {
            conversation: conversationDto(existing, user.id),
          });
      }
      const kind = data.kind === 'direct' ? 'direct' : 'group';
      const title = kind === 'group' ? String(data.title || '').trim() : '';
      if (kind === 'group' && title.length < 2) return json(response, 400, { error: 'Введите название группы' });
      if (kind === 'group' && title.length > 80) return json(response, 400, { error: 'Название группы должно быть короче 80 символов' });
      if (kind === 'group' && requestedIds.length < 1)
        return json(response, 400, {
          error: 'Добавьте хотя бы одного участника',
        });
      if (kind === 'group' && requestedIds.length > 199) return json(response, 400, { error: 'В группе может быть до 200 участников' });
      if (kind === 'group' && requestedIds.some((memberId) => !database.areFriends(user.id, memberId)))
        return json(response, 403, { error: 'В группу можно добавлять только друзей' });
      const rawAvatar = kind === 'group' ? String(data.avatarDataUrl || '') : '';
      if ((rawAvatar && !rawAvatar.startsWith('data:image/') && !rawAvatar.startsWith('/uploads/')) || rawAvatar.length > 8_000_000)
        return json(response, 400, { error: 'Фото группы слишком большое или имеет неверный формат' });
      const avatarDataUrl = kind === 'group' ? await database.normalizeConversationImage(rawAvatar, `${user.id}-group-avatar`, user.id) : '';
      const conversation = {
        id: id('cnv'),
        kind,
        title,
        avatarDataUrl,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
      };
      database.createConversation(conversation, [user.id, ...requestedIds]);
      const dto = conversationDto(conversation, user.id);
      if (kind === 'group') broadcastToConversation(conversation.id, { type: 'conversation:new', conversationId: conversation.id });
      return json(response, 201, { conversation: dto });
    }
    const conversationDetailsMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationDetailsMatch && request.method === 'PATCH') {
      const conversationId = conversationDetailsMatch[1];
      const conversation = database.getConversation(conversationId);
      if (!conversation || conversation.kind !== 'group') return json(response, 404, { error: 'Группа не найдена' });
      if (!database.isGroupAdmin(user.id, conversationId)) return json(response, 403, { error: 'Изменять группу могут только администраторы' });
      const data = await body(request);
      const hasTitle = Object.prototype.hasOwnProperty.call(data, 'title');
      const hasAvatar = Object.prototype.hasOwnProperty.call(data, 'avatarDataUrl');
      if (!hasTitle && !hasAvatar) return json(response, 400, { error: 'Нет изменений для сохранения' });
      const title = hasTitle ? String(data.title || '').trim() : conversation.title;
      if (title.length < 2) return json(response, 400, { error: 'Введите название группы' });
      if (title.length > 80) return json(response, 400, { error: 'Название группы должно быть короче 80 символов' });
      const rawAvatar = hasAvatar ? String(data.avatarDataUrl || '') : conversation.avatarDataUrl;
      if (hasAvatar && ((rawAvatar && !rawAvatar.startsWith('data:image/') && !rawAvatar.startsWith('/uploads/')) || rawAvatar.length > 8_000_000))
        return json(response, 400, { error: 'Фото группы слишком большое или имеет неверный формат' });
      const avatarDataUrl = hasAvatar ? await database.normalizeConversationImage(rawAvatar, `${user.id}-group-avatar`, user.id) : conversation.avatarDataUrl;
      const updated = await database.setConversationDetails(conversationId, title, avatarDataUrl);
      const dto = conversationDto(updated, user.id);
      broadcastToConversation(conversationId, { type: 'conversation:new', conversationId });
      return json(response, 200, { conversation: dto });
    }
    const conversationMembersMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/members$/);
    if (conversationMembersMatch && request.method === 'POST') {
      const conversationId = conversationMembersMatch[1];
      const conversation = database.getConversation(conversationId);
      if (!conversation || conversation.kind !== 'group') return json(response, 404, { error: 'Группа не найдена' });
      if (!database.isGroupAdmin(user.id, conversationId)) return json(response, 403, { error: 'Добавлять участников могут только администраторы' });
      const data = await body(request);
      const requestedIds = [...new Set((Array.isArray(data.userIds) ? data.userIds : [data.userId]).filter((memberId) => database.getUserById(memberId) && !database.isMember(memberId, conversationId)))];
      if (!requestedIds.length) return json(response, 400, { error: 'Выберите новых участников' });
      if (database.memberIds(conversationId).length + requestedIds.length > 200) return json(response, 400, { error: 'В группе может быть до 200 участников' });
      if (requestedIds.some((memberId) => !database.areFriends(user.id, memberId))) return json(response, 403, { error: 'В группу можно добавлять только друзей' });
      database.addMembers(conversationId, requestedIds);
      const dto = conversationDto(conversation, user.id);
      broadcastToConversation(conversationId, { type: 'conversation:new', conversationId });
      return json(response, 200, { conversation: dto });
    }
    const conversationMemberMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/members\/([^/]+)$/);
    if (conversationMemberMatch && request.method === 'DELETE') {
      const [, conversationId, memberId] = conversationMemberMatch;
      const conversation = database.getConversation(conversationId);
      if (!conversation || conversation.kind !== 'group') return json(response, 404, { error: 'Группа не найдена' });
      const actorRole = database.membershipRole(user.id, conversationId);
      const targetRole = database.membershipRole(memberId, conversationId);
      if (!['owner', 'admin'].includes(actorRole)) return json(response, 403, { error: 'Удалять участников могут только администраторы' });
      if (!targetRole) return json(response, 404, { error: 'Участник не найден' });
      if (targetRole === 'owner') return json(response, 403, { error: 'Владельца нельзя удалить из группы' });
      if (targetRole === 'admin' && actorRole !== 'owner') return json(response, 403, { error: 'Только владелец может удалить администратора' });
      if (activeCalls.has(conversationId) || voiceRooms.has(conversationId)) return json(response, 409, { error: 'Нельзя удалять участников во время звонка' });
      database.removeMember(conversationId, memberId);
      sendToUser(memberId, { type: 'conversation:delete', conversationId });
      broadcastToConversation(conversationId, { type: 'conversation:new', conversationId });
      return json(response, 200, { conversation: conversationDto(conversation, user.id), removedUserId: memberId });
    }
    if (conversationMemberMatch && request.method === 'PATCH') {
      const [, conversationId, memberId] = conversationMemberMatch;
      const conversation = database.getConversation(conversationId);
      if (!conversation || conversation.kind !== 'group') return json(response, 404, { error: 'Группа не найдена' });
      if (database.membershipRole(user.id, conversationId) !== 'owner') return json(response, 403, { error: 'Назначать администраторов может только владелец' });
      const targetRole = database.membershipRole(memberId, conversationId);
      if (!targetRole) return json(response, 404, { error: 'Участник не найден' });
      if (targetRole === 'owner') return json(response, 403, { error: 'Нельзя изменить роль владельца' });
      const data = await body(request);
      const role = data.role === 'admin' ? 'admin' : data.role === 'member' ? 'member' : '';
      if (!role) return json(response, 400, { error: 'Неизвестная роль' });
      database.setMemberRole(conversationId, memberId, role);
      const dto = conversationDto(conversation, user.id);
      broadcastToConversation(conversationId, { type: 'conversation:new', conversationId });
      return json(response, 200, { conversation: dto });
    }
    const deleteConversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (deleteConversationMatch && request.method === 'DELETE') {
      const conversationId = deleteConversationMatch[1];
      if (!isMember(user.id, conversationId)) return json(response, 403, { error: 'Нет доступа к чату' });
      const conversation = database.getConversation(conversationId);
      if (conversation?.kind === 'saved') return json(response, 403, { error: 'Избранное нельзя удалить' });
      if (conversation?.kind === 'group' && database.membershipRole(user.id, conversationId) !== 'owner') return json(response, 403, { error: 'Удалить группу может только владелец' });
      if (activeCalls.has(conversationId) || voiceRooms.has(conversationId)) return json(response, 409, { error: 'Нельзя удалить чат во время звонка' });
      const memberIds = database.memberIds(conversationId);
      const otherUserId = directOtherUserId(conversationId, user.id);
      const relationship = otherUserId ? database.relationship(user.id, otherUserId) : 'none';
      const deleted = await database.deleteConversation(conversationId);
      if (!deleted) return json(response, 404, { error: 'Чат не найден' });
      if (otherUserId && (relationship === 'incoming' || relationship === 'outgoing')) database.removeFriend(user.id, otherUserId);
      for (const memberId of memberIds) sendToUser(memberId, { type: 'conversation:delete', conversationId });
      if (otherUserId && (relationship === 'incoming' || relationship === 'outgoing')) broadcastRelationship(user.id, otherUserId);
      return json(response, 200, { conversationId });
    }
    const readMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/read$/);
    if (readMatch && !isMember(user.id, readMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (readMatch && request.method === 'POST') {
      const data = await body(request);
      const readAt = new Date().toISOString();
      const messageIds = database.markRead(readMatch[1], user.id, String(data.throughMessageId || ''), readAt);
      if (!messageIds) return json(response, 404, { error: 'Сообщение не найдено' });
      if (messageIds.length) {
        broadcastToConversation(
          readMatch[1],
          {
            type: 'message:read',
            conversationId: readMatch[1],
            userId: user.id,
            messageIds,
            readAt,
          },
          user.id,
        );
      }
      return json(response, 200, {
        conversationId: readMatch[1],
        userId: user.id,
        messageIds,
        readAt,
      });
    }
    const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messageMatch && !isMember(user.id, messageMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (messageMatch && request.method === 'GET') {
      const cursor = decodeMessageCursor(url.searchParams.get('before'));
      if (cursor === null) return json(response, 400, { error: 'Некорректный курсор истории' });
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 80)));
      const readStates = database.readStates(messageMatch[1]);
      const page = database.messagePage(messageMatch[1], { limit, before: cursor, viewerId: user.id });
      return json(response, 200, { ...page, messages: page.messages.map((message) => messageDto(message, readStates, user.id)) });
    }
    if (messageMatch && request.method === 'POST') {
      if (!canInteractInConversation(messageMatch[1], user.id)) return json(response, 403, { error: 'Обмен сообщениями недоступен из-за блокировки' });
      if (!allowRequest(`message:${user.id}`, 120, 60_000)) throw Object.assign(new Error('Слишком много сообщений'), { statusCode: 429 });
      const wasEmptyConversation = !database.lastMessage(messageMatch[1]);
      const data = await body(request);
      const clientId = String(data.clientId || '');
      if (clientId.length > 100) return json(response, 400, { error: 'Некорректный идентификатор сообщения' });
      const existingMessage = clientId ? database.getMessageByClientId(user.id, clientId) : null;
      if (existingMessage) {
        if (existingMessage.conversationId !== messageMatch[1]) return json(response, 409, { error: 'Идентификатор сообщения уже использован в другом чате' });
        return json(response, 200, { message: messageDto(existingMessage, undefined, user.id) });
      }
      const content = String(data.content || '').trim();
      const rawAttachment = data.attachment;
      let attachment;
      try {
        attachment = rawAttachment && typeof rawAttachment === 'object' ? await database.normalizeAttachment(rawAttachment, user.id) : undefined;
      } catch (attachmentError) {
        const concurrentMessage = clientId ? database.getMessageByClientId(user.id, clientId) : null;
        if (!concurrentMessage) throw attachmentError;
        if (concurrentMessage.conversationId !== messageMatch[1]) return json(response, 409, { error: 'Идентификатор сообщения уже использован в другом чате' });
        return json(response, 200, { message: messageDto(concurrentMessage, undefined, user.id) });
      }
      if ((!content && !attachment) || content.length > 4000)
        return json(response, 400, {
          error: 'Сообщение пустое или слишком длинное',
        });
      const replyToId = String(data.replyToId || '');
      if (replyToId && !database.getMessage(replyToId, messageMatch[1]))
        return json(response, 400, {
          error: 'Сообщение для ответа не найдено',
        });
      const createdAt = new Date().toISOString();
      const message = {
        id: id('msg'),
        conversationId: messageMatch[1],
        authorId: user.id,
        content,
        ...(attachment ? { attachment } : {}),
        ...(replyToId ? { replyToId } : {}),
        ...(clientId ? { clientId } : {}),
        createdAt,
        sentAt: createdAt,
        readBy: [],
      };
      const stored = database.insertMessageIdempotent(message);
      if (!stored.created && stored.message.conversationId !== messageMatch[1]) return json(response, 409, { error: 'Идентификатор сообщения уже использован в другом чате' });
      const dto = messageDto(stored.message, undefined, user.id);
      if (!stored.created) return json(response, 200, { message: dto });
      if (wasEmptyConversation) broadcastToConversation(message.conversationId, { type: 'conversation:new', conversationId: message.conversationId });
      broadcastMessage('message:new', stored.message);
      return json(response, 201, { message: dto });
    }
    const messageContextMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/context$/);
    if (messageContextMatch && !isMember(user.id, messageContextMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (messageContextMatch && request.method === 'GET') {
      const context = database.messageContext(messageContextMatch[1], messageContextMatch[2], { viewerId: user.id });
      if (!context) return json(response, 404, { error: 'Исходное сообщение не найдено' });
      const readStates = database.readStates(messageContextMatch[1]);
      return json(response, 200, { messages: context.map((message) => messageDto(message, readStates, user.id)) });
    }
    const voiceListenedMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/listened$/);
    if (voiceListenedMatch && !isMember(user.id, voiceListenedMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (voiceListenedMatch && request.method === 'POST') {
      const message = database.getMessage(voiceListenedMatch[2], voiceListenedMatch[1]);
      if (!message) return json(response, 404, { error: 'Сообщение не найдено' });
      if (!message.attachment?.type?.startsWith('audio/') || !message.attachment.durationMs) return json(response, 400, { error: 'Это не голосовое сообщение' });
      if (message.authorId === user.id) return json(response, 400, { error: 'Своё голосовое уже известно как прослушанное' });
      const listenedAt = new Date().toISOString();
      const created = database.markVoiceListened(message.id, user.id, listenedAt);
      const receipt = database.voiceListens(message.id).find((item) => item.userId === user.id) || { userId: user.id, listenedAt };
      const result = { conversationId: message.conversationId, messageId: message.id, ...receipt };
      if (created) broadcastToConversation(message.conversationId, { type: 'message:voice-listened', ...result });
      return json(response, 200, result);
    }
    const pinMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/pin$/);
    if (pinMessageMatch && !isMember(user.id, pinMessageMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (pinMessageMatch && (request.method === 'POST' || request.method === 'DELETE')) {
      const message = database.getMessage(pinMessageMatch[2], pinMessageMatch[1]);
      if (!message) return json(response, 404, { error: 'Сообщение не найдено' });
      if (message.kind && message.kind !== 'user') return json(response, 400, { error: 'Системное сообщение нельзя закрепить' });
      const pinnedAt = request.method === 'POST' ? new Date().toISOString() : null;
      const updated = database.setMessagePinned(message.id, message.conversationId, user.id, pinnedAt);
      const dto = messageDto(updated, undefined, user.id);
      broadcastMessage('message:update', updated);
      return json(response, 200, { message: dto });
    }
    const forwardMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/forward$/);
    if (forwardMessageMatch && !isMember(user.id, forwardMessageMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (forwardMessageMatch && request.method === 'POST') {
      const source = database.getMessage(forwardMessageMatch[2], forwardMessageMatch[1]);
      if (!source) return json(response, 404, { error: 'Сообщение не найдено' });
      if (source.kind && source.kind !== 'user') return json(response, 400, { error: 'Системное сообщение нельзя переслать' });
      const data = await body(request);
      const targetConversationId = String(data.conversationId || '');
      if (!targetConversationId || !isMember(user.id, targetConversationId)) return json(response, 403, { error: 'Нет доступа к выбранному чату' });
      if (!canInteractInConversation(targetConversationId, user.id)) return json(response, 403, { error: 'Обмен сообщениями недоступен из-за блокировки' });
      const wasEmptyConversation = !database.lastMessage(targetConversationId);
      const createdAt = new Date().toISOString();
      const sourceAuthor = database.getUserById(source.authorId);
      const forwarded = {
        id: id('msg'),
        conversationId: targetConversationId,
        authorId: user.id,
        content: source.content,
        ...(source.attachment ? { attachment: source.attachment } : {}),
        forwardedFrom: source.forwardedFrom || {
          conversationId: source.conversationId,
          messageId: source.id,
          authorId: source.authorId,
          authorName: sourceAuthor?.name || 'Пользователь',
          createdAt: source.createdAt,
        },
        createdAt,
        sentAt: createdAt,
        readBy: [],
      };
      database.insertMessage(forwarded);
      const dto = messageDto(forwarded, undefined, user.id);
      if (wasEmptyConversation) broadcastToConversation(targetConversationId, { type: 'conversation:new', conversationId: targetConversationId });
      broadcastMessage('message:new', forwarded);
      return json(response, 201, { message: dto });
    }
    const editMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/);
    if (editMessageMatch && !isMember(user.id, editMessageMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (editMessageMatch && request.method === 'PATCH') {
      const message = database.getMessage(editMessageMatch[2], editMessageMatch[1]);
      if (!message) return json(response, 404, { error: 'Сообщение не найдено' });
      if (message.kind && message.kind !== 'user') return json(response, 400, { error: 'Системное сообщение нельзя редактировать' });
      if (message.forwardedFrom) return json(response, 400, { error: 'Пересланное сообщение нельзя редактировать' });
      if (message.authorId !== user.id)
        return json(response, 403, {
          error: 'Можно редактировать только свои сообщения',
        });
      const data = await body(request);
      const content = String(data.content || '').trim();
      if ((!content && !message.attachment) || content.length > 4000)
        return json(response, 400, {
          error: 'Сообщение пустое или слишком длинное',
        });
      message.content = content;
      message.editedAt = new Date().toISOString();
      database.updateMessage(message);
      const dto = messageDto(message, undefined, user.id);
      broadcastMessage('message:update', message);
      return json(response, 200, { message: dto });
    }
    if (editMessageMatch && request.method === 'DELETE') {
      const message = database.getMessage(editMessageMatch[2], editMessageMatch[1]);
      if (!message) return json(response, 404, { error: 'Сообщение не найдено' });
      const deletedAt = new Date().toISOString();
      const scope = url.searchParams.get('scope') === 'everyone' ? 'everyone' : 'self';
      if (scope === 'everyone' && message.authorId !== user.id) return json(response, 403, { error: 'У всех можно удалить только своё сообщение' });
      const deletionTargets = scope === 'everyone'
        ? database.hideMessageForEveryone(message.id, message.conversationId, deletedAt)
        : (database.hideMessage(message.id, message.conversationId, user.id, deletedAt) ? [user.id] : []);
      let requesterEvent = null;
      for (const targetUserId of deletionTargets) {
        const storedLastMessage = database.lastMessage(message.conversationId, targetUserId);
        const lastMessageDto = storedLastMessage ? messageDto(storedLastMessage, undefined, targetUserId) : null;
        const lastMessage = lastMessageDto ? (({ author: _author, ...preview }) => preview)(lastMessageDto) : null;
        const event = { type: 'message:delete', conversationId: message.conversationId, messageId: message.id, userId: targetUserId, deletedAt, scope, lastMessage };
        if (targetUserId === user.id) requesterEvent = event;
        sendToUser(targetUserId, event);
      }
      return json(response, 200, requesterEvent);
    }
    return json(response, 404, { error: 'Не найдено' });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) logger.error('http.request_failed', { requestId: request.movaRequestId, method: request.method, route: routeName(new URL(request.url, 'http://localhost').pathname), error });
    if (status === 429) metrics.recordRejection('rate_limit');
    return json(response, status, { error: status >= 500 ? 'Внутренняя ошибка сервера' : error.message });
  }
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveUpload(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method || '')) return json(response, 405, { error: 'Метод не поддерживается' });
  let fileName;
  try {
    fileName = decodeURIComponent(pathname.slice('/uploads/'.length));
  } catch {
    return json(response, 400, { error: 'Некорректный адрес' });
  }
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.startsWith('.')) return json(response, 403, { error: 'Нет доступа' });
  const filePath = resolve(dataPaths.uploadsPath, fileName);
  if (!filePath.startsWith(`${resolve(dataPaths.uploadsPath)}${sep}`)) return json(response, 403, { error: 'Нет доступа' });
  try {
    const info = await stat(filePath);
    const upload = database.getUpload(fileName);
    const requestedName = new URL(request.url, 'http://localhost').searchParams.get('download');
    const downloadName = upload?.originalName || requestedName || fileName;
    const extension = extname(filePath).toLowerCase();
    const inlineImage = ['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'].includes(extension);
    const downloading = requestedName !== null || !inlineImage;
    response.writeHead(200, {
      'content-type': upload?.type || (inlineImage ? contentTypes[extension] : 'application/octet-stream'),
      'content-length': info.size,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-disposition': contentDisposition(downloading ? 'attachment' : 'inline', downloadName),
    });
    if (request.method === 'HEAD') return response.end();
    createReadStream(filePath).on('error', () => response.destroy()).pipe(response);
  } catch {
    return json(response, 404, { error: 'Файл не найден' });
  }
}

async function serveFrontend(request, response) {
  if (!['GET', 'HEAD'].includes(request.method || '')) return json(response, 405, { error: 'Метод не поддерживается' });
  const url = new URL(request.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return json(response, 400, { error: 'Некорректный адрес' });
  }

  const requestedPath = resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (requestedPath !== publicRoot && !requestedPath.startsWith(`${publicRoot}${sep}`)) return json(response, 403, { error: 'Нет доступа' });

  let filePath = requestedPath;
  let info;
  try {
    info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
  } catch {
    if (extname(pathname)) return json(response, 404, { error: 'Файл не найден' });
    filePath = resolve(publicRoot, 'index.html');
    try {
      info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');
    } catch {
      return json(response, 503, { error: 'Frontend не собран' });
    }
  }

  const extension = extname(filePath).toLowerCase();
  const video = ['.m4v', '.mp4'].includes(extension);
  const baseHeaders = {
    'content-type': contentTypes[extension] || 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') || filePath.endsWith('mova-sw.js') ? 'no-cache' : 'public, max-age=31536000, immutable',
    ...(filePath.endsWith('mova-sw.js') ? { 'service-worker-allowed': '/' } : {}),
    ...(video ? { 'accept-ranges': 'bytes' } : {}),
  };

  let start = 0;
  let end = info.size - 1;
  let status = 200;
  if (video && request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range).trim());
    if (match) {
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        start = Number.isSafeInteger(suffixLength) && suffixLength > 0 ? Math.max(0, info.size - suffixLength) : info.size;
      } else {
        start = Number(match[1]);
      }
      end = match[2] && match[1] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    } else {
      start = info.size;
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= info.size || end < start) {
      response.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${info.size}`, 'content-length': 0 });
      return response.end();
    }
    status = 206;
  }

  const contentLength = Math.max(0, end - start + 1);
  response.writeHead(status, {
    ...baseHeaders,
    'content-length': contentLength,
    ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
  });
  if (request.method === 'HEAD') return response.end();
  createReadStream(filePath, { start, end }).on('error', () => response.destroy()).pipe(response);
}

function handleRequest(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const currentRequestId = requestId(request.headers['x-request-id']);
  const normalizedRoute = routeName(pathname);
  const startedAt = performance.now();
  request.movaRequestId = currentRequestId;
  response.setHeader('x-request-id', currentRequestId);
  response.once('finish', () => {
    const durationMs = performance.now() - startedAt;
    metrics.recordHttp({ method: request.method || 'UNKNOWN', route: normalizedRoute, status: response.statusCode, durationMs });
    const quietSuccessfulPoll = request.method === 'GET' && ['/api/health', '/api/ready', '/api/maintenance', '/metrics', '/static'].includes(normalizedRoute) && response.statusCode < 400;
    if (!quietSuccessfulPoll)
      logger[response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info']('http.request_completed', {
        requestId: currentRequestId,
        method: request.method,
        route: normalizedRoute,
        status: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
  });
  if (pathname === '/metrics') {
    const metricsToken = process.env.MOVA_METRICS_TOKEN || '';
    const providedToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (metricsToken && !secureEqual(providedToken, metricsToken)) return json(response, 401, { error: 'Metrics endpoint is not authorized' });
    const stats = database.stats();
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
    return response.end(metrics.render({
      mova_websocket_connections: sockets?.clients?.size || 0,
      mova_active_calls: activeCalls.size,
      mova_voice_participants: [...voiceRooms.values()].reduce((total, room) => total + room.size, 0),
      mova_event_loop_delay_mean_ms: eventLoopDelay.mean / 1e6 || 0,
      mova_event_loop_delay_p99_ms: eventLoopDelay.percentile(99) / 1e6 || 0,
      mova_users: stats.users,
      mova_conversations: stats.conversations,
      mova_messages: stats.messages,
      mova_process_uptime_seconds: process.uptime(),
      mova_backups_enabled: backupConfig.enabled ? 1 : 0,
    }));
  }
  if (pathname.startsWith('/uploads/')) return serveUpload(request, response, pathname);
  return pathname.startsWith('/api/') ? handleApi(request, response) : serveFrontend(request, response);
}

function removeVoiceParticipant(conversationId, userId, notify = true) {
  clearVoiceReconnect(conversationId, userId);
  const room = voiceRooms.get(conversationId);
  if (!room?.has(userId)) return;
  room.delete(userId);
  voiceStates.get(conversationId)?.delete(userId);
  if (notify) broadcastToConversation(conversationId, { type: 'voice:left', conversationId, userId }, userId);
  if (room.size === 0) {
    voiceRooms.delete(conversationId);
    voiceStates.delete(conversationId);
    finishCall(conversationId, userId);
  } else broadcastVoiceSnapshot(conversationId);
}

function leaveVoice(socket, allowReconnect = false) {
  if (!socket.voiceConversationId || !socket.userId) return;
  const conversationId = socket.voiceConversationId;
  socket.voiceConversationId = null;
  const room = voiceRooms.get(conversationId);
  const userSockets = room?.get(socket.userId);
  userSockets?.delete(socket);
  if (!userSockets || userSockets.size > 0) return;
  if (!allowReconnect) return removeVoiceParticipant(conversationId, socket.userId);
  clearVoiceReconnect(conversationId, socket.userId);
  const key = voiceReconnectKey(conversationId, socket.userId);
  voiceReconnectTimers.set(
    key,
    setTimeout(() => {
      voiceReconnectTimers.delete(key);
      if (voiceRooms.get(conversationId)?.get(socket.userId)?.size) return;
      removeVoiceParticipant(conversationId, socket.userId);
    }, voiceReconnectGraceMs),
  );
  broadcastVoiceSnapshot(conversationId);
}

function handleSocket(socket, request) {
  const url = new URL(request.url, 'http://localhost');
  const user = tokenUser(url.searchParams.get('token') || '');
  if (!user) return socket.close(4001, 'Unauthorized');
  const firstConnection = !clients.get(user.id)?.size;
  socket.userId = user.id;
  if (!clients.has(user.id)) clients.set(user.id, new Set());
  clients.get(user.id).add(socket);
  socket.typingConversationIds = new Set();
  safeSocketSend(socket, JSON.stringify({ type: 'ready', user: publicUser(user) }));
  socket.isAlive = true;
  socket.rateWindowStartedAt = Date.now();
  socket.rateWindowMessages = 0;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  if (firstConnection) broadcastAll({ type: 'presence:update', user: publicUser(user) }, user.id);
  for (const conversationId of activeCalls.keys()) if (isMember(user.id, conversationId)) safeSocketSend(socket, JSON.stringify(callStateFor(conversationId, socket)));
  socket.on('message', (raw) => {
    try {
      if (Date.now() - socket.rateWindowStartedAt >= 10_000) {
        socket.rateWindowStartedAt = Date.now();
        socket.rateWindowMessages = 0;
      }
      socket.rateWindowMessages += 1;
      if (socket.rateWindowMessages > 300) {
        metrics.recordRejection('websocket_rate_limit');
        return socket.close(4008, 'Rate limit');
      }
      const event = JSON.parse(raw.toString());
      metrics.recordWebSocket(event.type);
      if (event.type === 'heartbeat')
        return safeSocketSend(socket,
          JSON.stringify({
            type: 'heartbeat:ack',
            sentAt: Number(event.sentAt) || Date.now(),
          }),
        );
      if (event.type === 'activity:update') {
        const name = String(event.name || '').trim().slice(0, 80);
        if (socket.gameActivityName !== name) socket.gameActivityChangedAt = Date.now();
        socket.gameActivityName = name;
        socket.gameActivityDeclared = true;
        return synchronizeSocketGameActivity(user.id);
      }
      const conversationId = event.conversationId;
      if (!conversationId || !isMember(user.id, conversationId)) return;
      if (event.type === 'typing') {
        if (!canInteractInConversation(conversationId, user.id)) return;
        if (event.active) socket.typingConversationIds.add(conversationId);
        else socket.typingConversationIds.delete(conversationId);
        return broadcastToConversation(
          conversationId,
          {
            type: 'typing',
            conversationId,
            userId: user.id,
            active: Boolean(event.active),
          },
          user.id,
        );
      }
      if (event.type === 'call:sync') return safeSocketSend(socket, JSON.stringify(callStateFor(conversationId, socket)));
      if (event.type === 'call:invite') {
        if (!canCallInConversation(conversationId, user.id)) return;
        const caller = database.getUserById(user.id) || user;
        const createdAt = Date.now();
        activeCalls.set(conversationId, {
          fromUserId: user.id,
          status: 'ringing',
          createdAt,
        });
        scheduleCallCleanup(conversationId, 45_000);
        for (const targetUserId of database.memberIds(conversationId))
          if (targetUserId !== user.id)
            void sendPushToUser(targetUserId, {
              kind: 'call',
              title: `Входящий звонок · ${caller.name}`,
              body: 'Нажмите, чтобы открыть Mova',
              icon: caller.avatarDataUrl || '/icon-192.png',
              badge: '/icon-192.png',
              tag: `mova-call-${conversationId}`,
              conversationId,
              url: `/app?conversation=${encodeURIComponent(conversationId)}&call=incoming`,
              requireInteraction: true,
            });
        return broadcastToConversation(conversationId, { type: 'call:invite', conversationId, from: publicUser(caller), createdAt: new Date(createdAt).toISOString() }, user.id);
      }
      if (event.type === 'call:accept') {
        if (!canCallInConversation(conversationId, user.id)) return;
        const active = activeCalls.get(conversationId) || {
          fromUserId: user.id,
          createdAt: Date.now(),
        };
        active.status = 'active';
        active.startedAt ||= Date.now();
        activeCalls.set(conversationId, active);
        scheduleCallCleanup(conversationId);
        closeCallPush(conversationId);
        return broadcastToConversation(conversationId, { type: 'call:accept', conversationId, fromUserId: user.id, startedAt: new Date(active.startedAt).toISOString() }, user.id);
      }
      if (event.type === 'call:decline') {
        const active = activeCalls.get(conversationId);
        if (active?.status === 'ringing') {
          activeCalls.delete(conversationId);
          clearCallCleanup(conversationId);
        }
        closeCallPush(conversationId);
        return broadcastToConversation(conversationId, { type: 'call:decline', conversationId, fromUserId: user.id }, user.id);
      }
      if (event.type === 'call:end') {
        return leaveVoice(socket);
      }
      if (event.type === 'voice:join') {
        if (!canCallInConversation(conversationId, user.id)) return;
        if (socket.voiceConversationId && socket.voiceConversationId !== conversationId) leaveVoice(socket);
        socket.voiceConversationId = conversationId;
        clearCallCleanup(conversationId);
        if (!activeCalls.has(conversationId)) {
          const startedAt = Date.now();
          activeCalls.set(conversationId, {
            fromUserId: user.id,
            status: 'active',
            createdAt: startedAt,
            startedAt,
          });
        } else {
          const active = activeCalls.get(conversationId);
          active.status = 'active';
          active.startedAt ||= Date.now();
        }
        if (!voiceRooms.has(conversationId)) voiceRooms.set(conversationId, new Map());
        const room = voiceRooms.get(conversationId);
        const peers = [...room.keys()].filter((userId) => userId !== user.id);
        const participantJoined = !room.has(user.id);
        if (!room.has(user.id)) room.set(user.id, new Set());
        clearVoiceReconnect(conversationId, user.id);
        voiceStateFor(conversationId, user.id);
        room.get(user.id).add(socket);
        safeSocketSend(socket, JSON.stringify({ type: 'voice:peers', conversationId, peers }));
        if (participantJoined) {
          const participant = database.getUserById(user.id) || user;
          broadcastToConversation(conversationId, { type: 'voice:joined', conversationId, user: publicUser(participant) }, user.id);
        }
        return broadcastVoiceSnapshot(conversationId);
      }
      if (event.type === 'voice:leave') return leaveVoice(socket);
      if (event.type === 'voice:media' && ['camera', 'screen'].includes(event.mediaKind)) {
        if (socket.voiceConversationId !== conversationId || !voiceRooms.get(conversationId)?.has(user.id)) return;
        const state = voiceStateFor(conversationId, user.id);
        if (event.enabled && event.streamId) state.media[event.mediaKind] = String(event.streamId);
        else delete state.media[event.mediaKind];
        broadcastToConversation(
          conversationId,
          {
            type: 'voice:media',
            conversationId,
            fromUserId: user.id,
            mediaKind: event.mediaKind,
            enabled: Boolean(event.enabled),
            streamId: String(event.streamId || ''),
          },
          user.id,
        );
        return broadcastVoiceSnapshot(conversationId);
      }
      if (event.type === 'voice:state') {
        if (socket.voiceConversationId !== conversationId || !voiceRooms.get(conversationId)?.has(user.id)) return;
        const state = voiceStateFor(conversationId, user.id);
        state.muted = Boolean(event.muted);
        state.deafened = Boolean(event.deafened);
        broadcastToConversation(
          conversationId,
          {
            type: 'voice:state',
            conversationId,
            fromUserId: user.id,
            muted: Boolean(event.muted),
            deafened: Boolean(event.deafened),
          },
          user.id,
        );
        return broadcastVoiceSnapshot(conversationId);
      }
      if (['voice:offer', 'voice:answer', 'voice:ice'].includes(event.type) && event.targetUserId) {
        if (socket.voiceConversationId !== conversationId || !voiceRooms.get(conversationId)?.has(user.id) || !voiceRooms.get(conversationId)?.has(event.targetUserId)) return;
        const payload = JSON.stringify({ ...event, fromUserId: user.id });
        for (const targetSocket of clients.get(event.targetUserId) || []) safeSocketSend(targetSocket, payload);
      }
    } catch (error) {
      metrics.recordRejection('websocket_event');
      logger.warn('websocket.event_rejected', { userId: user.id, error });
    }
  });
  socket.on('close', () => {
    leaveVoice(socket, true);
    clients.get(user.id)?.delete(socket);
    if (socket.gameActivityDeclared) synchronizeSocketGameActivity(user.id);
    for (const conversationId of socket.typingConversationIds || []) {
      const stillTyping = [...(clients.get(user.id) || [])].some((otherSocket) => otherSocket.typingConversationIds?.has(conversationId));
      if (!stillTyping) broadcastToConversation(conversationId, { type: 'typing', conversationId, userId: user.id, active: false }, user.id);
    }
    if (clients.get(user.id)?.size === 0) {
      clients.delete(user.id);
      const lastActiveAt = new Date().toISOString();
      database.updateLastActiveAt(user.id, lastActiveAt);
      const currentUser = database.getUserById(user.id);
      if (currentUser) broadcastAll({ type: 'presence:update', user: publicUser(currentUser) }, user.id);
    }
  });
}

database = await openDatabase(dataPaths);
configureWebPush();
await database.cleanupOrphanUploads();
database.cleanupEmailChallenges();
const backupConfig = resolveBackupConfig(dataPaths);
const runBackup = () => {
  if (backupInFlight) return backupInFlight;
  backupInFlight = backupIfDue(database, backupConfig)
    .then((backup) => {
      if (!backup) return;
      metrics.recordBackup(true);
      logger.info('backup.created', { path: backup.path });
    })
    .catch((error) => {
      metrics.recordBackup(false);
      logger.error('backup.failed', { error });
    })
    .finally(() => { backupInFlight = null; });
  return backupInFlight;
};
void runBackup();
const uploadCleanupTimer = setInterval(() => {
  database.cleanupEmailChallenges();
  void database.cleanupOrphanUploads().catch((error) => logger.error('uploads.cleanup_failed', { error }));
}, 6 * 60 * 60_000);
uploadCleanupTimer.unref();
const backupTimer = setInterval(() => void runBackup(), Math.min(60 * 60_000, backupConfig.intervalMs));
backupTimer.unref();
const server = createServer(handleRequest);
const sockets = new WebSocketServer({ noServer: true, maxPayload: 256_000, perMessageDeflate: false });
sockets.on('connection', handleSocket);
const socketHeartbeat = setInterval(() => {
  const now = Date.now();
  for (const [key, item] of rateLimits) if (item.resetAt <= now) rateLimits.delete(key);
  for (const socket of sockets.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);
sockets.on('close', () => clearInterval(socketHeartbeat));
server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/ws')) return socket.destroy();
  sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit('connection', webSocket, request));
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => logger.info('server.ready', { host, port, databasePath: dataPaths.sqlitePath, uploadsPath: dataPaths.uploadsPath }));

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutting_down', { signal });
  clearInterval(socketHeartbeat);
  clearInterval(uploadCleanupTimer);
  clearInterval(backupTimer);
  for (const timer of callCleanupTimers.values()) clearTimeout(timer);
  for (const timer of voiceReconnectTimers.values()) clearTimeout(timer);
  for (const socket of sockets.clients) socket.close(1001, 'Server shutdown');
  sockets.close();
  server.close(async () => {
    await backupInFlight?.catch(() => undefined);
    eventLoopDelay.disable();
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
