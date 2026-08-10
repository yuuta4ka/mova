import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const serverRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serverRoot, '..');
const publicRoot = resolve(projectRoot, 'dist');
const databasePath = process.env.MOVA_DATABASE_PATH ? resolve(process.env.MOVA_DATABASE_PATH) : process.env.AMVERA ? '/data/db.json' : resolve(projectRoot, '.mova-data/db.json');
const port = Number(process.env.PORT || process.env.MOVA_PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const secret = process.env.MOVA_SESSION_SECRET || 'mova-local-development-secret';
const clients = new Map();
const voiceRooms = new Map();
const activeCalls = new Map();
const callCleanupTimers = new Map();

const defaultIceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
function rtcIceServers() {
  if (process.env.MOVA_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.MOVA_ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (error) {
      console.error('MOVA_ICE_SERVERS must be valid JSON:', error.message);
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

const emptyDatabase = {
  users: [],
  conversations: [],
  memberships: [],
  messages: [],
};
let database = emptyDatabase;

async function loadDatabase() {
  await mkdir(dirname(databasePath), { recursive: true });
  try {
    database = JSON.parse(await readFile(databasePath, 'utf8'));
  } catch {
    database = structuredClone(emptyDatabase);
    await persist();
  }
}

let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(() => writeFile(databasePath, JSON.stringify(database, null, 2)));
  return writeQueue;
}

const id = (prefix) => `${prefix}_${randomBytes(10).toString('hex')}`;
const publicUser = ({ passwordHash, ...user }) => {
  const normalized = user.presence === 'dnd' && user.dndUntil && user.dndUntil !== 'forever' && new Date(user.dndUntil).getTime() <= Date.now() ? { ...user, presence: 'online', dndUntil: null } : user;
  const connected = Boolean(clients.get(user.id)?.size);
  return {
    ...normalized,
    isOnline: normalized.presence !== 'invisible' && connected,
  };
};
const normalizeEmail = (email) =>
  String(email || '')
    .trim()
    .toLowerCase();
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString('base64url');
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
    return database.users.find((user) => user.id === data.userId) || null;
  } catch {
    return null;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 12_000_000) throw new Error('Payload too large');
  }
  return raw ? JSON.parse(raw) : {};
}
function auth(request) {
  return tokenUser(request.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
}
function isMember(userId, conversationId) {
  return database.memberships.some((membership) => membership.userId === userId && membership.conversationId === conversationId);
}
function messageDto(message) {
  const replyMessage = message.replyToId ? database.messages.find((item) => item.id === message.replyToId && item.conversationId === message.conversationId) : null;
  const replyAuthor = replyMessage ? database.users.find((item) => item.id === replyMessage.authorId) : null;
  return {
    ...message,
    sentAt: message.sentAt || message.createdAt,
    readBy: Array.isArray(message.readBy) ? message.readBy : [],
    author: publicUser(database.users.find((item) => item.id === message.authorId)),
    ...(replyMessage && replyAuthor
      ? {
          replyTo: {
            id: replyMessage.id,
            authorId: replyMessage.authorId,
            content: replyMessage.content,
            ...(replyMessage.attachment ? { attachmentName: replyMessage.attachment.name } : {}),
            author: publicUser(replyAuthor),
          },
        }
      : {}),
  };
}
function conversationDto(conversation, userId) {
  const memberIds = database.memberships.filter((item) => item.conversationId === conversation.id).map((item) => item.userId);
  const members = memberIds
    .map((memberId) => database.users.find((user) => user.id === memberId))
    .filter(Boolean)
    .map(publicUser);
  const storedLastMessage = database.messages.filter((message) => message.conversationId === conversation.id).at(-1) || null;
  const lastMessage = storedLastMessage
    ? {
        ...storedLastMessage,
        sentAt: storedLastMessage.sentAt || storedLastMessage.createdAt,
        readBy: Array.isArray(storedLastMessage.readBy) ? storedLastMessage.readBy : [],
      }
    : null;
  return {
    ...conversation,
    members,
    title: conversation.kind === 'direct' ? members.find((member) => member.id !== userId)?.name || 'Сохранённое' : conversation.title,
    lastMessage,
  };
}
function broadcastToConversation(conversationId, event, exceptUserId) {
  const memberIds = database.memberships.filter((item) => item.conversationId === conversationId).map((item) => item.userId);
  for (const userId of memberIds) if (userId !== exceptUserId) for (const socket of clients.get(userId) || []) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}
function broadcastAll(event, exceptUserId) {
  for (const [userId, sockets] of clients) if (userId !== exceptUserId) for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}
function roomUserIds(conversationId) {
  return [...(voiceRooms.get(conversationId)?.keys() || [])];
}
function callStateFor(conversationId, socket) {
  const active = activeCalls.get(conversationId);
  return {
    type: 'call:state',
    conversationId,
    status: active?.status || 'idle',
    ...(active
      ? {
          from: publicUser(database.users.find((item) => item.id === active.fromUserId)),
        }
      : {}),
    participants: roomUserIds(conversationId),
    joined: socket.voiceConversationId === conversationId,
  };
}
function clearCallCleanup(conversationId) {
  const timer = callCleanupTimers.get(conversationId);
  if (timer) clearTimeout(timer);
  callCleanupTimers.delete(conversationId);
}
function scheduleCallCleanup(conversationId, delay = 60_000) {
  clearCallCleanup(conversationId);
  const timer = setTimeout(() => {
    callCleanupTimers.delete(conversationId);
    if (voiceRooms.get(conversationId)?.size || !activeCalls.has(conversationId)) return;
    const call = activeCalls.get(conversationId);
    activeCalls.delete(conversationId);
    broadcastToConversation(conversationId, {
      type: 'call:end',
      conversationId,
      fromUserId: call?.fromUserId || '',
    });
  }, delay);
  callCleanupTimers.set(conversationId, timer);
}

async function handleApi(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true });
    if (request.method === 'POST' && url.pathname === '/api/register') {
      const data = await body(request);
      const email = normalizeEmail(data.email);
      const name = String(data.name || '').trim();
      const password = String(data.password || '');
      if (name.length < 2 || !email.includes('@') || password.length < 8)
        return json(response, 400, {
          error: 'Укажите имя, корректную почту и пароль от 8 символов',
        });
      if (database.users.some((user) => user.email === email))
        return json(response, 409, {
          error: 'Пользователь с такой почтой уже существует',
        });
      const colors = ['#74DCCB', '#9B83F4', '#FF8D72', '#F3C96B', '#68CFA4'];
      const baseHandle = `@${
        email
          .split('@')[0]
          .replace(/[^a-z0-9_.]/gi, '')
          .slice(0, 24) || 'user'
      }`;
      let handle = baseHandle;
      let suffix = 1;
      while (database.users.some((item) => item.handle === handle)) handle = `${baseHandle}${suffix++}`;
      const user = {
        id: id('usr'),
        name,
        email,
        handle,
        color: colors[database.users.length % colors.length],
        presence: 'online',
        dndUntil: null,
        bio: '',
        avatarDataUrl: '',
        bannerDataUrl: '',
        activity: null,
        lastActiveAt: new Date().toISOString(),
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      database.users.push(user);
      await persist();
      return json(response, 201, {
        token: createToken(user.id),
        user: publicUser(user),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      const data = await body(request);
      const user = database.users.find((item) => item.email === normalizeEmail(data.email));
      if (!user || !verifyPassword(String(data.password || ''), user.passwordHash)) return json(response, 401, { error: 'Неверная почта или пароль' });
      return json(response, 200, {
        token: createToken(user.id),
        user: publicUser(user),
      });
    }
    const user = auth(request);
    if (!user) return json(response, 401, { error: 'Требуется вход' });
    if (request.method === 'GET' && url.pathname === '/api/rtc-config') return json(response, 200, { iceServers: rtcIceServers() });
    if (request.method === 'GET' && url.pathname === '/api/me') return json(response, 200, { user: publicUser(user) });
    if (request.method === 'GET' && url.pathname === '/api/users')
      return json(response, 200, {
        users: database.users.filter((item) => item.id !== user.id).map(publicUser),
      });
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
      if (database.users.some((item) => item.id !== user.id && item.handle === handle)) return json(response, 409, { error: 'Этот юзернейм уже занят' });
      const avatarDataUrl = String(data.avatarDataUrl || '');
      const bannerDataUrl = String(data.bannerDataUrl || '');
      if ((avatarDataUrl && !avatarDataUrl.startsWith('data:image/')) || avatarDataUrl.length > 700_000)
        return json(response, 400, {
          error: 'Аватар слишком большой или имеет неверный формат',
        });
      if ((bannerDataUrl && !bannerDataUrl.startsWith('data:image/')) || bannerDataUrl.length > 1_800_000)
        return json(response, 400, {
          error: 'Шапка слишком большая или имеет неверный формат',
        });
      Object.assign(user, {
        name,
        handle,
        bio: String(data.bio || '')
          .trim()
          .slice(0, 240),
        avatarDataUrl,
        bannerDataUrl,
        activity: data.activity?.name
          ? {
              name: String(data.activity.name).trim().slice(0, 80),
              startedAt: data.activity.startedAt || new Date().toISOString(),
            }
          : null,
      });
      await persist();
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
      await persist();
      const dto = publicUser(user);
      broadcastAll({ type: 'presence:update', user: dto }, user.id);
      return json(response, 200, { user: dto });
    }
    if (request.method === 'GET' && url.pathname === '/api/conversations') {
      const ids = database.memberships.filter((item) => item.userId === user.id).map((item) => item.conversationId);
      const conversations = database.conversations.filter((item) => ids.includes(item.id)).map((item) => conversationDto(item, user.id));
      return json(response, 200, {
        conversations: conversations.sort(
          (left, right) => new Date(right.lastMessage?.createdAt || right.createdAt).getTime() - new Date(left.lastMessage?.createdAt || left.createdAt).getTime(),
        ),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/conversations') {
      const data = await body(request);
      const requestedIds = [...new Set((data.memberIds || []).filter((memberId) => database.users.some((item) => item.id === memberId && item.id !== user.id)))];
      if (data.kind === 'direct' && requestedIds.length === 1) {
        const existing = database.conversations.find(
          (conversation) =>
            conversation.kind === 'direct' &&
            database.memberships
              .filter((item) => item.conversationId === conversation.id)
              .map((item) => item.userId)
              .sort()
              .join() === [user.id, requestedIds[0]].sort().join(),
        );
        if (existing)
          return json(response, 200, {
            conversation: conversationDto(existing, user.id),
          });
      }
      const kind = data.kind === 'direct' ? 'direct' : 'group';
      const title = kind === 'group' ? String(data.title || '').trim() : '';
      if (kind === 'group' && title.length < 2) return json(response, 400, { error: 'Введите название группы' });
      if (kind === 'group' && requestedIds.length < 1)
        return json(response, 400, {
          error: 'Добавьте хотя бы одного участника',
        });
      const conversation = {
        id: id('cnv'),
        kind,
        title,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
      };
      database.conversations.push(conversation);
      for (const userId of [user.id, ...requestedIds])
        database.memberships.push({
          conversationId: conversation.id,
          userId,
          joinedAt: new Date().toISOString(),
        });
      await persist();
      const dto = conversationDto(conversation, user.id);
      broadcastToConversation(conversation.id, {
        type: 'conversation:new',
        conversationId: conversation.id,
      });
      return json(response, 201, { conversation: dto });
    }
    const readMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/read$/);
    if (readMatch && !isMember(user.id, readMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (readMatch && request.method === 'POST') {
      const data = await body(request);
      const messages = database.messages.filter((message) => message.conversationId === readMatch[1]);
      const throughIndex = messages.findIndex((message) => message.id === data.throughMessageId);
      if (throughIndex < 0) return json(response, 404, { error: 'Сообщение не найдено' });
      const readAt = new Date().toISOString();
      const messageIds = [];
      for (const message of messages.slice(0, throughIndex + 1)) {
        if (message.authorId === user.id) continue;
        if (!Array.isArray(message.readBy)) message.readBy = [];
        if (message.readBy.some((receipt) => receipt.userId === user.id)) continue;
        message.readBy.push({ userId: user.id, readAt });
        messageIds.push(message.id);
      }
      if (messageIds.length) {
        await persist();
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
    if (messageMatch && request.method === 'GET')
      return json(response, 200, {
        messages: database.messages
          .filter((message) => message.conversationId === messageMatch[1])
          .slice(-200)
          .map(messageDto),
      });
    if (messageMatch && request.method === 'POST') {
      const data = await body(request);
      const content = String(data.content || '').trim();
      const rawAttachment = data.attachment;
      const attachment =
        rawAttachment && typeof rawAttachment === 'object'
          ? {
              name: String(rawAttachment.name || 'Файл').slice(0, 180),
              type: String(rawAttachment.type || 'application/octet-stream').slice(0, 120),
              size: Number(rawAttachment.size || 0),
              dataUrl: String(rawAttachment.dataUrl || ''),
            }
          : undefined;
      if ((!content && !attachment) || content.length > 4000)
        return json(response, 400, {
          error: 'Сообщение пустое или слишком длинное',
        });
      if (attachment && (attachment.size > 8_000_000 || !attachment.dataUrl.startsWith('data:') || attachment.dataUrl.length > 11_000_000)) return json(response, 400, { error: 'Файл должен быть меньше 8 МБ' });
      const replyToId = String(data.replyToId || '');
      if (replyToId && !database.messages.some((item) => item.id === replyToId && item.conversationId === messageMatch[1]))
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
        createdAt,
        sentAt: createdAt,
        readBy: [],
      };
      database.messages.push(message);
      await persist();
      const dto = messageDto(message);
      broadcastToConversation(message.conversationId, {
        type: 'message:new',
        message: dto,
      });
      return json(response, 201, { message: dto });
    }
    const editMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/);
    if (editMessageMatch && !isMember(user.id, editMessageMatch[1])) return json(response, 403, { error: 'Нет доступа к чату' });
    if (editMessageMatch && request.method === 'PATCH') {
      const message = database.messages.find((item) => item.id === editMessageMatch[2] && item.conversationId === editMessageMatch[1]);
      if (!message) return json(response, 404, { error: 'Сообщение не найдено' });
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
      await persist();
      const dto = messageDto(message);
      broadcastToConversation(message.conversationId, {
        type: 'message:update',
        message: dto,
      });
      return json(response, 200, { message: dto });
    }
    return json(response, 404, { error: 'Не найдено' });
  } catch (error) {
    console.error(error);
    return json(response, 500, { error: 'Внутренняя ошибка сервера' });
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
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

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
  let contents;
  try {
    contents = await readFile(filePath);
  } catch {
    if (extname(pathname)) return json(response, 404, { error: 'Файл не найден' });
    filePath = resolve(publicRoot, 'index.html');
    try {
      contents = await readFile(filePath);
    } catch {
      return json(response, 503, { error: 'Frontend не собран' });
    }
  }

  response.writeHead(200, {
    'content-type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
}

function handleRequest(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  return pathname.startsWith('/api/') ? handleApi(request, response) : serveFrontend(request, response);
}

function leaveVoice(socket) {
  if (!socket.voiceConversationId || !socket.userId) return;
  const conversationId = socket.voiceConversationId;
  socket.voiceConversationId = null;
  const room = voiceRooms.get(conversationId);
  const userSockets = room?.get(socket.userId);
  userSockets?.delete(socket);
  if (userSockets?.size === 0) {
    room.delete(socket.userId);
    broadcastToConversation(conversationId, { type: 'voice:left', conversationId, userId: socket.userId }, socket.userId);
  }
  if (room?.size === 0) {
    voiceRooms.delete(conversationId);
    const call = activeCalls.get(conversationId);
    activeCalls.delete(conversationId);
    clearCallCleanup(conversationId);
    broadcastToConversation(conversationId, {
      type: 'call:end',
      conversationId,
      fromUserId: call?.fromUserId || socket.userId,
    });
  } else if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(callStateFor(conversationId, socket)));
  }
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
  socket.send(JSON.stringify({ type: 'ready', user: publicUser(user) }));
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  if (firstConnection) broadcastAll({ type: 'presence:update', user: publicUser(user) }, user.id);
  for (const conversationId of activeCalls.keys()) if (isMember(user.id, conversationId)) socket.send(JSON.stringify(callStateFor(conversationId, socket)));
  socket.on('message', (raw) => {
    try {
      const event = JSON.parse(raw.toString());
      if (event.type === 'heartbeat')
        return socket.send(
          JSON.stringify({
            type: 'heartbeat:ack',
            sentAt: Number(event.sentAt) || Date.now(),
          }),
        );
      const conversationId = event.conversationId;
      if (!conversationId || !isMember(user.id, conversationId)) return;
      if (event.type === 'typing') {
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
      if (event.type === 'call:sync') return socket.send(JSON.stringify(callStateFor(conversationId, socket)));
      if (event.type === 'call:invite') {
        activeCalls.set(conversationId, {
          fromUserId: user.id,
          status: 'ringing',
          createdAt: Date.now(),
        });
        scheduleCallCleanup(conversationId, 45_000);
        return broadcastToConversation(conversationId, { type: 'call:invite', conversationId, from: publicUser(user) }, user.id);
      }
      if (event.type === 'call:accept') {
        const active = activeCalls.get(conversationId) || {
          fromUserId: user.id,
          createdAt: Date.now(),
        };
        active.status = 'active';
        activeCalls.set(conversationId, active);
        scheduleCallCleanup(conversationId);
        return broadcastToConversation(conversationId, { type: 'call:accept', conversationId, fromUserId: user.id }, user.id);
      }
      if (event.type === 'call:decline') {
        const active = activeCalls.get(conversationId);
        if (active?.status === 'ringing') {
          activeCalls.delete(conversationId);
          clearCallCleanup(conversationId);
        }
        return broadcastToConversation(conversationId, { type: 'call:decline', conversationId, fromUserId: user.id }, user.id);
      }
      if (event.type === 'call:end') {
        return leaveVoice(socket);
      }
      if (event.type === 'voice:join') {
        leaveVoice(socket);
        socket.voiceConversationId = conversationId;
        clearCallCleanup(conversationId);
        if (!activeCalls.has(conversationId))
          activeCalls.set(conversationId, {
            fromUserId: user.id,
            status: 'active',
            createdAt: Date.now(),
          });
        if (!voiceRooms.has(conversationId)) voiceRooms.set(conversationId, new Map());
        const room = voiceRooms.get(conversationId);
        const peers = [...room.keys()].filter((userId) => userId !== user.id);
        if (!room.has(user.id)) room.set(user.id, new Set());
        room.get(user.id).add(socket);
        socket.send(JSON.stringify({ type: 'voice:peers', conversationId, peers }));
        return broadcastToConversation(conversationId, { type: 'voice:joined', conversationId, user: publicUser(user) }, user.id);
      }
      if (event.type === 'voice:leave') return leaveVoice(socket);
      if (event.type === 'voice:media' && ['camera', 'screen'].includes(event.mediaKind))
        return broadcastToConversation(
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
      if (event.type === 'voice:state')
        return broadcastToConversation(
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
      if (['voice:offer', 'voice:answer', 'voice:ice'].includes(event.type) && event.targetUserId) for (const targetSocket of clients.get(event.targetUserId) || []) if (targetSocket.readyState === WebSocket.OPEN) targetSocket.send(JSON.stringify({ ...event, fromUserId: user.id }));
    } catch {}
  });
  socket.on('close', () => {
    leaveVoice(socket);
    clients.get(user.id)?.delete(socket);
    for (const conversationId of socket.typingConversationIds || []) {
      const stillTyping = [...(clients.get(user.id) || [])].some((otherSocket) => otherSocket.typingConversationIds?.has(conversationId));
      if (!stillTyping) broadcastToConversation(conversationId, { type: 'typing', conversationId, userId: user.id, active: false }, user.id);
    }
    if (clients.get(user.id)?.size === 0) {
      clients.delete(user.id);
      user.lastActiveAt = new Date().toISOString();
      void persist();
      broadcastAll({ type: 'presence:update', user: publicUser(user) }, user.id);
    }
  });
}

await loadDatabase();
const server = createServer(handleRequest);
const sockets = new WebSocketServer({ noServer: true });
sockets.on('connection', handleSocket);
const socketHeartbeat = setInterval(() => {
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
server.listen(port, host, () => console.log(`Mova ready at http://${host}:${port}; data: ${databasePath}`));
