// @vitest-environment node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let baseUrl;
let port;
let serverProcess;
let testDirectory;
const hookSecret = 'realtime-maintenance-test-secret';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function api(path, { method = 'GET', token, data } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}

function waitForEvent(socket, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 3_000);
    const listener = (raw) => {
      const event = JSON.parse(raw);
      if (event.type !== type || !predicate(event)) return;
      clearTimeout(timeout);
      socket.off('message', listener);
      resolve(event);
    };
    socket.on('message', listener);
  });
}

async function openSocket(token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const ready = waitForEvent(socket, 'ready');
  await ready;
  return socket;
}

async function maintenance(active, deploymentId) {
  const readiness = active ? await api('/api/ready') : null;
  return api('/api/maintenance', {
    method: 'POST',
    token: hookSecret,
    data: { active, deploymentId, previousInstanceId: readiness?.instanceId },
  });
}

beforeAll(async () => {
  port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-realtime-maintenance-'));
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: join(testDirectory, 'db.sqlite'),
      MOVA_SESSION_SECRET: 'realtime-maintenance-session-secret',
      MOVA_DEPLOY_HOOK_SECRET: hookSecret,
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/ready`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not become ready');
});

afterAll(async () => {
  if (serverProcess?.exitCode === null) {
    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGTERM');
    await exited;
  }
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

describe('realtime while maintenance state changes', () => {
  it('keeps presence, reconnect, incoming calls and cancellation working with maintenance off and on', async () => {
    const suffix = Date.now();
    const first = await api('/api/register', { method: 'POST', data: { name: 'Первый', email: `first.${suffix}@mova.test`, password: 'strongpass1' } });
    const second = await api('/api/register', { method: 'POST', data: { name: 'Второй', email: `second.${suffix}@mova.test`, password: 'strongpass2' } });
    const conversation = await api('/api/conversations', { method: 'POST', token: first.token, data: { kind: 'direct', memberIds: [second.user.id] } });
    const firstSocket = await openSocket(first.token);
    const secondOnline = waitForEvent(firstSocket, 'presence:update', (event) => event.user.id === second.user.id && event.user.isOnline);
    const secondSocket = await openSocket(second.token);
    await secondOnline;

    const users = await api('/api/users', { token: first.token });
    expect(users.users.find((user) => user.id === second.user.id)?.isOnline).toBe(true);

    const inviteOff = waitForEvent(secondSocket, 'call:invite');
    firstSocket.send(JSON.stringify({ type: 'call:invite', conversationId: conversation.conversation.id }));
    expect((await inviteOff).from.id).toBe(first.user.id);
    const cancelledOff = waitForEvent(firstSocket, 'call:decline');
    secondSocket.send(JSON.stringify({ type: 'call:decline', conversationId: conversation.conversation.id }));
    await cancelledOff;

    await maintenance(true, 'deploy-realtime');
    expect(await api('/api/maintenance')).toMatchObject({ active: true });
    const inviteOn = waitForEvent(secondSocket, 'call:invite');
    firstSocket.send(JSON.stringify({ type: 'call:invite', conversationId: conversation.conversation.id }));
    expect((await inviteOn).from.id).toBe(first.user.id);

    const firstOffline = waitForEvent(secondSocket, 'presence:update', (event) => event.user.id === first.user.id && !event.user.isOnline);
    firstSocket.close();
    await firstOffline;
    const firstBackOnline = waitForEvent(secondSocket, 'presence:update', (event) => event.user.id === first.user.id && event.user.isOnline);
    const reconnectedFirst = await openSocket(first.token);
    await firstBackOnline;

    const inviteAfterReconnect = waitForEvent(secondSocket, 'call:invite');
    reconnectedFirst.send(JSON.stringify({ type: 'call:invite', conversationId: conversation.conversation.id }));
    expect((await inviteAfterReconnect).from.id).toBe(first.user.id);
    const cancelledAfterReconnect = waitForEvent(reconnectedFirst, 'call:decline');
    secondSocket.send(JSON.stringify({ type: 'call:decline', conversationId: conversation.conversation.id }));
    await cancelledAfterReconnect;

    await maintenance(false, 'deploy-realtime');
    expect(await api('/api/maintenance')).toEqual({ active: false });
    reconnectedFirst.close();
    secondSocket.close();
  });
});
