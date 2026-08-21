import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';

const testDirectory = await mkdtemp(join(tmpdir(), 'mova-integration-'));
const port = 8791;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    MOVA_PORT: String(port),
    MOVA_DATABASE_PATH: join(testDirectory, 'db.json'),
    MOVA_AUTH_TEST_BYPASS: '1',
    MOVA_BACKUPS_ENABLED: 'false',
    MOVA_TURN_URLS: 'turn:turn.example.test:3478,turns:turn.example.test:443',
    MOVA_TURN_USERNAME: 'integration-user',
    MOVA_TURN_CREDENTIAL: 'integration-secret',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Integration server did not start');
};
const call = async (path, method = 'GET', data, token) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
};
const callStatus = async (path, method = 'GET', data, token) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, result: await response.json() };
};
const upload = async (name, type, contents, token) => {
  const response = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: {
      'content-type': type,
      'x-mova-file-name': encodeURIComponent(name),
      authorization: `Bearer ${token}`,
    },
    body: contents,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result.attachment;
};
const openSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
const openSocketWaitingFor = (token, type) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timeout waiting for ${type} on reconnect`));
    }, 2500);
    socket.on('message', (raw) => {
      const event = JSON.parse(raw);
      if (event.type === type) {
        clearTimeout(timer);
        resolve({ socket, event });
      }
    });
    socket.once('error', reject);
  });
const waitFor = (socket, type) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 2500);
    const listener = (raw) => {
      const event = JSON.parse(raw);
      if (event.type === type) {
        clearTimeout(timer);
        socket.off('message', listener);
        resolve(event);
      }
    };
    socket.on('message', listener);
  });
const captureEvents = (socket, type, predicate = () => true) => {
  const events = [];
  const listener = (raw) => {
    const event = JSON.parse(raw);
    if (event.type === type && predicate(event)) events.push(event);
  };
  socket.on('message', listener);
  return { events, stop: () => socket.off('message', listener) };
};
const settleRealtime = () => new Promise((resolve) => setTimeout(resolve, 120));

try {
  await waitForServer();
  const tracedHealth = await fetch(`${base}/api/health`, { headers: { 'x-request-id': 'integration-request-123' } });
  if (tracedHealth.headers.get('x-request-id') !== 'integration-request-123') throw new Error('HTTP request correlation id was not preserved');
  const metricsResponse = await fetch(`${base}/metrics`);
  const metricsText = await metricsResponse.text();
  if (!metricsResponse.ok || !metricsText.includes('mova_http_request_duration_ms_bucket') || !metricsText.includes('mova_process_uptime_seconds')) throw new Error('Production metrics were not exposed');
  const suffix = Date.now();
  const first = await call('/api/register', 'POST', {
    name: 'Первый',
    email: `first.${suffix}@mova.test`,
    password: 'strongpass1',
  });
  const second = await call('/api/register', 'POST', {
    name: 'Второй',
    email: `second.${suffix}@mova.test`,
    password: 'strongpass2',
  });
  await call(`/api/friends/${second.user.id}`, 'POST', undefined, first.token);
  const requestConversation = await call('/api/conversations', 'GET', undefined, second.token);
  if (requestConversation.conversations.length !== 1 || requestConversation.conversations[0].lastMessage?.kind !== 'friend_request' || requestConversation.conversations[0].lastMessage?.friendRequest?.status !== 'pending') throw new Error('Friend request did not create a direct chat and system message');
  await call(`/api/friends/${first.user.id}`, 'PATCH', undefined, second.token);
  const acceptedRequestMessages = await call(`/api/conversations/${requestConversation.conversations[0].id}/messages`, 'GET', undefined, first.token);
  if (acceptedRequestMessages.messages[0]?.friendRequest?.status !== 'accepted') throw new Error('Friend request system message was not finalized');
  const third = await call('/api/register', 'POST', {
    name: 'Третий',
    email: `third.${suffix}@mova.test`,
    password: 'strongpass3',
  });
  await call(`/api/friends/${third.user.id}`, 'POST', undefined, first.token);
  await call(`/api/friends/${first.user.id}`, 'PATCH', undefined, third.token);
  const profile = await call(
    '/api/profile',
    'PATCH',
    {
      name: 'Первый игрок',
      handle: '@first_player',
      bio: 'Проверка профиля',
      avatarDataUrl: '',
      bannerDataUrl: '',
    },
    first.token,
  );
  const activity = await call('/api/activity', 'POST', { name: 'Mova' }, first.token);
  const presence = await call('/api/presence', 'POST', { presence: 'dnd', dndUntil: new Date(Date.now() + 900_000).toISOString() }, first.token);
  const conversation = await call('/api/conversations', 'POST', { kind: 'direct', memberIds: [second.user.id] }, first.token);
  const rtcConfig = await call('/api/rtc-config', 'GET', undefined, first.token);
  if (rtcConfig.iceServers.length !== 2 || rtcConfig.iceServers[1].username !== 'integration-user' || rtcConfig.iceServers[1].urls.length !== 2) throw new Error('Runtime TURN configuration was not returned');
  const pushConfig = await call('/api/push-config', 'GET', undefined, first.token);
  if (!pushConfig.publicKey) throw new Error('Web Push public key was not returned');
  const pushEndpoint = `https://push.example.test/${suffix}`;
  await call('/api/push-subscriptions', 'POST', { endpoint: pushEndpoint, expirationTime: null, keys: { p256dh: 'integration-p256dh', auth: 'integration-auth' } }, first.token);
  await call('/api/push-subscriptions', 'DELETE', { endpoint: pushEndpoint }, first.token);
  const uploadedAttachment = await upload('mova-test.txt', 'text/plain', 'mova test', first.token);
  const attachmentMessage = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    {
      content: 'Файл',
      clientId: 'integration-attachment-message',
      attachment: uploadedAttachment,
    },
    first.token,
  );
  const storedAttachmentResponse = await fetch(`${base}${attachmentMessage.message.attachment.url}`);
  const storedAttachmentContents = await storedAttachmentResponse.text();
  if (!storedAttachmentResponse.ok || storedAttachmentContents !== 'mova test' || attachmentMessage.message.attachment.dataUrl) throw new Error('Binary attachment was not stored outside the database');
  const uploadedVoice = await upload('voice.webm', 'audio/webm', 'voice test', first.token);
  const voiceWaveform = [0.2, 0.8, 0.4, 0.7, 0.3, 0.9, 0.5, 0.6];
  const voiceMessage = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    { content: '', clientId: 'integration-voice-message', attachment: { ...uploadedVoice, durationMs: 1_800, waveform: voiceWaveform } },
    first.token,
  );
  if (voiceMessage.message.attachment.durationMs !== 1_800 || JSON.stringify(voiceMessage.message.attachment.waveform) !== JSON.stringify(voiceWaveform)) throw new Error('Voice message metadata was not preserved');
  const firstSocket = await openSocket(first.token);
  const secondSocket = await openSocket(second.token);
  const voiceListenedPromise = waitFor(firstSocket, 'message:voice-listened');
  const voiceListenedReceipt = await call(`/api/conversations/${conversation.conversation.id}/messages/${voiceMessage.message.id}/listened`, 'POST', undefined, second.token);
  const voiceListenedEvent = await voiceListenedPromise;
  const attachmentRetryEvents = captureEvents(secondSocket, 'message:new', (event) => event.message.clientId === 'integration-attachment-message');
  const attachmentRetry = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    { content: 'Файл', clientId: 'integration-attachment-message', attachment: uploadedAttachment },
    first.token,
  );
  await settleRealtime();
  attachmentRetryEvents.stop();
  if (attachmentRetry.message.id !== attachmentMessage.message.id || attachmentRetryEvents.events.length !== 0) throw new Error('Attachment retry was not idempotent');

  const sequentialEvents = captureEvents(secondSocket, 'message:new', (event) => event.message.clientId === 'integration-sequential');
  const sequentialFirst = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    { content: 'Последовательный retry', clientId: 'integration-sequential' },
    first.token,
  );
  const sequentialSecond = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    { content: 'Последовательный retry', clientId: 'integration-sequential' },
    first.token,
  );
  await settleRealtime();
  sequentialEvents.stop();
  if (sequentialFirst.message.id !== sequentialSecond.message.id || sequentialEvents.events.length !== 1) throw new Error('Sequential message retry created a duplicate or a second realtime event');

  const sharedClientId = 'integration-shared-between-users';
  const firstShared = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    { content: 'От первого', clientId: sharedClientId },
    first.token,
  );
  const secondShared = await call(
    `/api/conversations/${conversation.conversation.id}/messages`,
    'POST',
    { content: 'От второго', clientId: sharedClientId },
    second.token,
  );
  if (firstShared.message.id === secondShared.message.id || firstShared.message.authorId === secondShared.message.authorId) throw new Error('The same client id incorrectly conflicted between users');

  const concurrentEvents = captureEvents(secondSocket, 'message:new', (event) => event.message.clientId === 'integration-concurrent');
  const concurrentResults = await Promise.all([
    call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Одновременный retry', clientId: 'integration-concurrent' }, first.token),
    call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Одновременный retry', clientId: 'integration-concurrent' }, first.token),
  ]);
  await settleRealtime();
  concurrentEvents.stop();
  if (concurrentResults[0].message.id !== concurrentResults[1].message.id || concurrentEvents.events.length !== 1) throw new Error('Concurrent message retry was not idempotent');

  const concurrentAttachment = await upload('concurrent.txt', 'text/plain', 'concurrent attachment', first.token);
  const concurrentAttachmentEvents = captureEvents(secondSocket, 'message:new', (event) => event.message.clientId === 'integration-concurrent-attachment');
  const concurrentAttachmentResults = await Promise.all([
    call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Одновременный файл', clientId: 'integration-concurrent-attachment', attachment: concurrentAttachment }, first.token),
    call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Одновременный файл', clientId: 'integration-concurrent-attachment', attachment: concurrentAttachment }, first.token),
  ]);
  await settleRealtime();
  concurrentAttachmentEvents.stop();
  if (concurrentAttachmentResults[0].message.id !== concurrentAttachmentResults[1].message.id || concurrentAttachmentEvents.events.length !== 1) throw new Error('Concurrent attachment retry was not idempotent');

  const idempotentHistory = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  const countByClientId = (clientId) => idempotentHistory.messages.filter((message) => message.clientId === clientId).length;
  if (countByClientId('integration-sequential') !== 1 || countByClientId('integration-concurrent') !== 1 || countByClientId(sharedClientId) !== 2) throw new Error('Re-read message DTOs did not preserve unique client ids');
  const newestPage = await call(`/api/conversations/${conversation.conversation.id}/messages?limit=2`, 'GET', undefined, first.token);
  const olderPage = await call(`/api/conversations/${conversation.conversation.id}/messages?limit=2&before=${encodeURIComponent(newestPage.nextCursor)}`, 'GET', undefined, first.token);
  const pageIds = [...olderPage.messages, ...newestPage.messages].map((message) => message.id);
  if (!newestPage.hasMore || !newestPage.nextCursor || new Set(pageIds).size !== pageIds.length || pageIds.some((id, index) => index > 0 && id === pageIds[index - 1])) throw new Error('Cursor message pagination was not stable');
  const sqliteVerification = new DatabaseSync(join(testDirectory, 'db.sqlite'), { readOnly: true });
  const sequentialRows = sqliteVerification.prepare('SELECT COUNT(*) AS count FROM messages WHERE author_id=? AND client_id=?').get(first.user.id, 'integration-sequential').count;
  const concurrentRows = sqliteVerification.prepare('SELECT COUNT(*) AS count FROM messages WHERE author_id=? AND client_id=?').get(first.user.id, 'integration-concurrent').count;
  const attachmentUpload = sqliteVerification.prepare('SELECT attached_message_id, purpose FROM uploads WHERE file_name=?').get(uploadedAttachment.url.split('/').at(-1));
  const concurrentAttachmentUpload = sqliteVerification.prepare('SELECT attached_message_id, purpose FROM uploads WHERE file_name=?').get(concurrentAttachment.url.split('/').at(-1));
  sqliteVerification.close();
  if (sequentialRows !== 1 || concurrentRows !== 1 || attachmentUpload?.attached_message_id !== attachmentMessage.message.id || attachmentUpload?.purpose !== 'message' || concurrentAttachmentUpload?.attached_message_id !== concurrentAttachmentResults[0].message.id || concurrentAttachmentUpload?.purpose !== 'message') throw new Error('SQLite idempotency or attachment ownership verification failed');

  const presencePromise = waitFor(secondSocket, 'presence:update');
  const livePresence = await call('/api/presence', 'POST', { presence: 'idle' }, first.token);
  const presenceEvent = await presencePromise;
  const replyPromise = waitFor(secondSocket, 'message:new');
  const replyMessage = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Ответ на файл', replyToId: attachmentMessage.message.id }, first.token);
  const replyEvent = await replyPromise;
  const editPromise = waitFor(secondSocket, 'message:update');
  const editedMessage = await call(`/api/conversations/${conversation.conversation.id}/messages/${replyMessage.message.id}`, 'PATCH', { content: 'Исправленный ответ' }, first.token);
  const editEvent = await editPromise;
  const pinPromise = waitFor(secondSocket, 'message:update');
  const pinnedMessage = await call(`/api/conversations/${conversation.conversation.id}/messages/${replyMessage.message.id}/pin`, 'POST', undefined, first.token);
  const pinEvent = await pinPromise;
  const targetConversationPromise = waitFor(secondSocket, 'conversation:new');
  const forwardTarget = await call('/api/conversations', 'POST', { kind: 'group', title: 'Пересылка', memberIds: [second.user.id] }, first.token);
  await targetConversationPromise;
  if (forwardTarget.conversation.memberRoles?.[first.user.id] !== 'owner' || forwardTarget.conversation.memberRoles?.[second.user.id] !== 'member') throw new Error('Group ownership was not returned');
  const ordinaryEdit = await callStatus(`/api/conversations/${forwardTarget.conversation.id}`, 'PATCH', { title: 'Чужое название' }, second.token);
  if (ordinaryEdit.status !== 403) throw new Error('Ordinary group member could edit the group');
  const renamedGroup = await call(`/api/conversations/${forwardTarget.conversation.id}`, 'PATCH', { title: 'Команда интеграции' }, first.token);
  if (renamedGroup.conversation.title !== 'Команда интеграции') throw new Error('Group owner could not rename the group');
  const groupWithThird = await call(`/api/conversations/${forwardTarget.conversation.id}/members`, 'POST', { userIds: [third.user.id] }, first.token);
  if (!groupWithThird.conversation.members.some((member) => member.id === third.user.id)) throw new Error('Group owner could not add a member');
  const promotedAdmin = await call(`/api/conversations/${forwardTarget.conversation.id}/members/${second.user.id}`, 'PATCH', { role: 'admin' }, first.token);
  if (promotedAdmin.conversation.memberRoles?.[second.user.id] !== 'admin') throw new Error('Group owner could not promote an administrator');
  const adminEdit = await call(`/api/conversations/${forwardTarget.conversation.id}`, 'PATCH', { title: 'Команда администратора' }, second.token);
  if (adminEdit.conversation.title !== 'Команда администратора') throw new Error('Group administrator could not edit the group');
  const removeOwner = await callStatus(`/api/conversations/${forwardTarget.conversation.id}/members/${first.user.id}`, 'DELETE', undefined, second.token);
  if (removeOwner.status !== 403) throw new Error('Group owner could be removed');
  const removedThird = await call(`/api/conversations/${forwardTarget.conversation.id}/members/${third.user.id}`, 'DELETE', undefined, second.token);
  if (removedThird.conversation.members.some((member) => member.id === third.user.id)) throw new Error('Group administrator could not remove a member');
  const demotedAdmin = await call(`/api/conversations/${forwardTarget.conversation.id}/members/${second.user.id}`, 'PATCH', { role: 'member' }, first.token);
  if (demotedAdmin.conversation.memberRoles?.[second.user.id] !== 'member') throw new Error('Group owner could not demote an administrator');
  const forwardPromise = waitFor(secondSocket, 'message:new');
  const forwardedMessage = await call(`/api/conversations/${conversation.conversation.id}/messages/${replyMessage.message.id}/forward`, 'POST', { conversationId: forwardTarget.conversation.id }, first.token);
  const forwardEvent = await forwardPromise;
  const deletePromise = waitFor(firstSocket, 'message:delete');
  const deletedMessage = await call(`/api/conversations/${conversation.conversation.id}/messages/${replyMessage.message.id}`, 'DELETE', undefined, first.token);
  const deleteEvent = await deletePromise;
  const firstHistoryAfterDelete = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  const secondHistoryAfterDelete = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, second.token);
  const globalMessage = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Удалить у всех' }, first.token);
  const globalDeletePromise = waitFor(secondSocket, 'message:delete');
  const globallyDeletedMessage = await call(`/api/conversations/${conversation.conversation.id}/messages/${globalMessage.message.id}?scope=everyone`, 'DELETE', undefined, first.token);
  const globalDeleteEvent = await globalDeletePromise;
  const firstHistoryAfterGlobalDelete = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  const secondHistoryAfterGlobalDelete = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, second.token);
  const conversationOverview = await call('/api/conversations', 'GET', undefined, second.token);
  if (conversationOverview.conversations.find((item) => item.id === conversation.conversation.id)?.lastMessage?.content !== 'Исправленный ответ') throw new Error('Conversation preview did not return the latest edited message');
  const heartbeatPromise = waitFor(firstSocket, 'heartbeat:ack');
  firstSocket.send(JSON.stringify({ type: 'heartbeat', sentAt: Date.now() }));
  await heartbeatPromise;
  const typingStartPromise = waitFor(secondSocket, 'typing');
  firstSocket.send(JSON.stringify({ type: 'typing', conversationId: conversation.conversation.id, active: true }));
  const typingStarted = await typingStartPromise;
  const typingStopPromise = waitFor(secondSocket, 'typing');
  firstSocket.send(JSON.stringify({ type: 'typing', conversationId: conversation.conversation.id, active: false }));
  const typingStopped = await typingStopPromise;
  const readPromise = waitFor(firstSocket, 'message:read');
  await call(`/api/conversations/${conversation.conversation.id}/read`, 'POST', { throughMessageId: attachmentMessage.message.id }, second.token);
  const readReceipt = await readPromise;
  const messagesAfterRead = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  const storedVoiceMessage = messagesAfterRead.messages.find((message) => message.id === voiceMessage.message.id);
  const incomingPromise = waitFor(secondSocket, 'call:invite');
  firstSocket.send(
    JSON.stringify({
      type: 'call:invite',
      conversationId: conversation.conversation.id,
    }),
  );
  const incoming = await incomingPromise;
  const acceptedPromise = waitFor(firstSocket, 'call:accept');
  secondSocket.send(
    JSON.stringify({
      type: 'call:accept',
      conversationId: conversation.conversation.id,
    }),
  );
  const accepted = await acceptedPromise;
  firstSocket.send(
    JSON.stringify({
      type: 'voice:join',
      conversationId: conversation.conversation.id,
    }),
  );
  await waitFor(firstSocket, 'voice:peers');
  secondSocket.send(
    JSON.stringify({
      type: 'voice:join',
      conversationId: conversation.conversation.id,
    }),
  );
  const peers = await waitFor(secondSocket, 'voice:peers');
  const mediaPromise = waitFor(secondSocket, 'voice:media');
  firstSocket.send(
    JSON.stringify({
      type: 'voice:media',
      conversationId: conversation.conversation.id,
      mediaKind: 'camera',
      enabled: true,
      streamId: 'test-camera-stream',
    }),
  );
  const media = await mediaPromise;
  const statePromise = waitFor(secondSocket, 'voice:state');
  firstSocket.send(
    JSON.stringify({
      type: 'voice:state',
      conversationId: conversation.conversation.id,
      muted: true,
      deafened: true,
    }),
  );
  const voiceState = await statePromise;
  const disconnectTypingStartPromise = waitFor(secondSocket, 'typing');
  firstSocket.send(JSON.stringify({ type: 'typing', conversationId: conversation.conversation.id, active: true }));
  await disconnectTypingStartPromise;
  const disconnectTypingStopPromise = waitFor(secondSocket, 'typing');
  firstSocket.close();
  const typingStoppedOnDisconnect = await disconnectTypingStopPromise;
  const recovered = await openSocketWaitingFor(first.token, 'call:state');
  recovered.socket.send(
    JSON.stringify({
      type: 'voice:join',
      conversationId: conversation.conversation.id,
    }),
  );
  const recoveredPeers = await waitFor(recovered.socket, 'voice:peers');
  const leftPromise = waitFor(secondSocket, 'voice:left');
  const returnStatePromise = waitFor(recovered.socket, 'call:state');
  recovered.socket.send(
    JSON.stringify({
      type: 'voice:leave',
      conversationId: conversation.conversation.id,
    }),
  );
  recovered.socket.send(
    JSON.stringify({
      type: 'call:sync',
      conversationId: conversation.conversation.id,
    }),
  );
  await leftPromise;
  const returnState = await returnStatePromise;
  const endPromise = waitFor(secondSocket, 'call:end');
  const completedCallMessagePromise = waitFor(secondSocket, 'message:new');
  secondSocket.send(
    JSON.stringify({
      type: 'voice:leave',
      conversationId: conversation.conversation.id,
    }),
  );
  const ended = await endPromise;
  const completedCallMessage = await completedCallMessagePromise;
  const messagesAfterCall = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  recovered.socket.close();
  secondSocket.close();
  console.log(
    JSON.stringify({
      profile: profile.user.handle,
      friendRequestCard: acceptedRequestMessages.messages[0].friendRequest.status,
      activity: activity.user.activity.name,
      presence: presence.user.presence,
      livePresence: livePresence.user.presence === 'idle' && presenceEvent.user.id === first.user.id && presenceEvent.user.isOnline === true,
      latestPreview: conversationOverview.conversations[0].lastMessage.content,
      rtcIceServers: rtcConfig.iceServers.length,
      pushNotifications: Boolean(pushConfig.publicKey),
      attachment: attachmentMessage.message.attachment.name,
      clientId: attachmentMessage.message.clientId === 'integration-attachment-message',
      sequentialIdempotency: sequentialFirst.message.id === sequentialSecond.message.id && sequentialRows === 1,
      concurrentIdempotency: concurrentResults[0].message.id === concurrentResults[1].message.id && concurrentRows === 1,
      concurrentAttachmentIdempotency: concurrentAttachmentResults[0].message.id === concurrentAttachmentResults[1].message.id && concurrentAttachmentEvents.events.length === 1,
      perUserClientId: firstShared.message.id !== secondShared.message.id,
      singleRealtimeEvent: sequentialEvents.events.length === 1 && concurrentEvents.events.length === 1,
      attachmentRetry: attachmentRetry.message.id === attachmentMessage.message.id && attachmentRetryEvents.events.length === 0,
      persistedClientIdDto: countByClientId('integration-sequential') === 1,
      attachmentUrl: attachmentMessage.message.attachment.url.startsWith('/uploads/'),
      voiceMetadata: voiceMessage.message.attachment.durationMs === 1_800,
      voiceListened: voiceListenedReceipt.userId === second.user.id && voiceListenedEvent.messageId === voiceMessage.message.id && storedVoiceMessage.listenedBy[0].userId === second.user.id,
      reply: replyEvent.message.replyTo.id === attachmentMessage.message.id && replyEvent.message.replyTo.attachment.name === 'mova-test.txt',
      edited: editedMessage.message.content === 'Исправленный ответ' && Boolean(editEvent.message.editedAt),
      pinned: Boolean(pinnedMessage.message.pinnedAt && pinEvent.message.pinnedAt),
      forwarded: forwardedMessage.message.conversationId === forwardTarget.conversation.id && forwardEvent.message.id === forwardedMessage.message.id,
      deletedForUser: deletedMessage.messageId === replyMessage.message.id && deleteEvent.messageId === replyMessage.message.id && !firstHistoryAfterDelete.messages.some((message) => message.id === replyMessage.message.id) && secondHistoryAfterDelete.messages.some((message) => message.id === replyMessage.message.id),
      deletedForEveryone: globallyDeletedMessage.scope === 'everyone' && globalDeleteEvent.messageId === globalMessage.message.id && !firstHistoryAfterGlobalDelete.messages.some((message) => message.id === globalMessage.message.id) && !secondHistoryAfterGlobalDelete.messages.some((message) => message.id === globalMessage.message.id),
      typing: typingStarted.active === true && typingStopped.active === false,
      typingDisconnect: typingStoppedOnDisconnect.active === false,
      sentAt: Boolean(attachmentMessage.message.sentAt),
      readBy: messagesAfterRead.messages[0].readBy[0].userId === second.user.id,
      readEvent: readReceipt.messageIds.includes(attachmentMessage.message.id),
      incomingFrom: incoming.from.name,
      callCreatedAt: Boolean(incoming.createdAt),
      callStartedAt: Boolean(accepted.startedAt && recovered.event.startedAt),
      voicePeers: peers.peers.length,
      media: `${media.mediaKind}:${media.enabled}`,
      voiceState: `${voiceState.muted}:${voiceState.deafened}`,
      recoveredCall: `${recovered.event.status}:${recoveredPeers.peers.length}`,
      availableAfterLeave: returnState.status === 'active' && returnState.joined === false,
      endedBy: ended.fromUserId,
      completedCallMessage: completedCallMessage.message.kind === 'call' && completedCallMessage.message.call.status === 'completed' && completedCallMessage.message.call.durationSeconds >= 0,
      storedCallMessage: messagesAfterCall.messages.at(-1)?.kind === 'call',
    }),
  );
} finally {
  server.kill('SIGTERM');
  await rm(testDirectory, { recursive: true, force: true });
}
