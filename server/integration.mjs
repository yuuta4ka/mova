import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const testDirectory = await mkdtemp(join(tmpdir(), 'mova-integration-'));
const port = 8791;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, MOVA_PORT: String(port), MOVA_DATABASE_PATH: join(testDirectory, 'db.json') }, stdio: ['ignore', 'ignore', 'inherit'] });

const waitForServer = async () => { for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('Integration server did not start'); };
const call = async (path, method = 'GET', data, token) => { const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); return result; };
const openSocket = (token) => new Promise((resolve, reject) => { const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`); socket.once('open', () => resolve(socket)); socket.once('error', reject); });
const waitFor = (socket, type) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 2500); const listener = (raw) => { const event = JSON.parse(raw); if (event.type === type) { clearTimeout(timer); socket.off('message', listener); resolve(event); } }; socket.on('message', listener); });

try {
  await waitForServer();
  const suffix = Date.now();
  const first = await call('/api/register', 'POST', { name: 'Первый', email: `first.${suffix}@mova.test`, password: 'strongpass1' });
  const second = await call('/api/register', 'POST', { name: 'Второй', email: `second.${suffix}@mova.test`, password: 'strongpass2' });
  const profile = await call('/api/profile', 'PATCH', { name: 'Первый игрок', handle: '@first_player', bio: 'Проверка профиля', avatarDataUrl: '', bannerDataUrl: '', activity: { name: 'Играет в Mova', startedAt: new Date().toISOString() } }, first.token);
  const presence = await call('/api/presence', 'POST', { presence: 'dnd', dndUntil: new Date(Date.now() + 900_000).toISOString() }, first.token);
  const conversation = await call('/api/conversations', 'POST', { kind: 'direct', memberIds: [second.user.id] }, first.token);
  const attachmentMessage = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'POST', { content: 'Файл', attachment: { name: 'mova-test.txt', type: 'text/plain', size: 9, dataUrl: 'data:text/plain;base64,bW92YSB0ZXN0' } }, first.token);
  const firstSocket = await openSocket(first.token); const secondSocket = await openSocket(second.token);
  const readPromise = waitFor(firstSocket, 'message:read');
  await call(`/api/conversations/${conversation.conversation.id}/read`, 'POST', { throughMessageId: attachmentMessage.message.id }, second.token);
  const readReceipt = await readPromise;
  const messagesAfterRead = await call(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  const incomingPromise = waitFor(secondSocket, 'call:invite'); firstSocket.send(JSON.stringify({ type: 'call:invite', conversationId: conversation.conversation.id })); const incoming = await incomingPromise;
  const acceptedPromise = waitFor(firstSocket, 'call:accept'); secondSocket.send(JSON.stringify({ type: 'call:accept', conversationId: conversation.conversation.id })); await acceptedPromise;
  firstSocket.send(JSON.stringify({ type: 'voice:join', conversationId: conversation.conversation.id })); await waitFor(firstSocket, 'voice:peers');
  secondSocket.send(JSON.stringify({ type: 'voice:join', conversationId: conversation.conversation.id })); const peers = await waitFor(secondSocket, 'voice:peers');
  const mediaPromise = waitFor(secondSocket, 'voice:media'); firstSocket.send(JSON.stringify({ type: 'voice:media', conversationId: conversation.conversation.id, mediaKind: 'camera', enabled: true, streamId: 'test-camera-stream' })); const media = await mediaPromise;
  const statePromise = waitFor(secondSocket, 'voice:state'); firstSocket.send(JSON.stringify({ type: 'voice:state', conversationId: conversation.conversation.id, muted: true, deafened: true })); const voiceState = await statePromise;
  const endPromise = waitFor(secondSocket, 'call:end'); firstSocket.send(JSON.stringify({ type: 'call:end', conversationId: conversation.conversation.id })); const ended = await endPromise;
  firstSocket.close(); secondSocket.close();
  console.log(JSON.stringify({ profile: profile.user.handle, activity: profile.user.activity.name, presence: presence.user.presence, attachment: attachmentMessage.message.attachment.name, sentAt: Boolean(attachmentMessage.message.sentAt), readBy: messagesAfterRead.messages[0].readBy[0].userId === second.user.id, readEvent: readReceipt.messageIds.includes(attachmentMessage.message.id), incomingFrom: incoming.from.name, voicePeers: peers.peers.length, media: `${media.mediaKind}:${media.enabled}`, voiceState: `${voiceState.muted}:${voiceState.deafened}`, endedBy: ended.fromUserId }));
} finally {
  server.kill('SIGTERM');
  await rm(testDirectory, { recursive: true, force: true });
}
