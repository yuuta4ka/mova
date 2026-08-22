// @vitest-environment node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let baseUrl;
let serverProcess;
let testDirectory;

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

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}

async function openSocket(token) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, 'ws')}/ws?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for realtime ready')), 3_000);
    socket.once('error', reject);
    socket.on('message', (raw) => {
      if (JSON.parse(raw).type !== 'ready') return;
      clearTimeout(timeout);
      resolve();
    });
  });
  return socket;
}

function waitForProfile(socket, userId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for profile activity')), 3_000);
    const listener = (raw) => {
      const event = JSON.parse(raw);
      if (event.type !== 'profile:update' || event.user.id !== userId) return;
      clearTimeout(timeout);
      socket.off('message', listener);
      resolve(event.user);
    };
    socket.on('message', listener);
  });
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-activity-test-'));
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: join(testDirectory, 'db.sqlite'),
      MOVA_SESSION_SECRET: 'activity-test-secret',
      MOVA_AUTH_TEST_BYPASS: '1',
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not start');
});

afterAll(async () => {
  if (serverProcess?.exitCode === null) {
    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGTERM');
    await exited;
  }
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

describe('game activity', () => {
  it('stores, broadcasts and clears a desktop game status', async () => {
    const suffix = Date.now();
    const first = await request('/api/register', { method: 'POST', body: { name: 'Игрок', email: `player.${suffix}@mova.test`, password: 'strongpass1' } });
    const second = await request('/api/register', { method: 'POST', body: { name: 'Друг', email: `friend.${suffix}@mova.test`, password: 'strongpass2' } });
    const player = await openSocket(first.token);
    const observer = await openSocket(second.token);

    const startedEvent = waitForProfile(observer, first.user.id);
    const iconDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const started = await request('/api/activity', { method: 'POST', token: first.token, body: { name: 'Minecraft', iconDataUrl } });
    expect(started.user.activity).toMatchObject({ type: 'game', name: 'Minecraft', iconDataUrl });
    expect((await startedEvent).activity).toEqual(started.user.activity);
    expect((await request('/api/me', { token: first.token })).user.activity).toEqual(started.user.activity);

    const socketActivityEvent = waitForProfile(observer, first.user.id);
    player.send(JSON.stringify({ type: 'activity:update', name: 'Stardew Valley', iconDataUrl }));
    expect((await socketActivityEvent).activity).toMatchObject({ type: 'game', name: 'Stardew Valley', iconDataUrl });

    const disconnectedEvent = waitForProfile(observer, first.user.id);
    player.close();
    expect((await disconnectedEvent).activity).toBeNull();

    const restartedEvent = waitForProfile(observer, first.user.id);
    await request('/api/activity', { method: 'POST', token: first.token, body: { name: 'Minecraft' } });
    await restartedEvent;
    const clearedEvent = waitForProfile(observer, first.user.id);
    const cleared = await request('/api/activity', { method: 'POST', token: first.token, body: { name: null } });
    expect(cleared.user.activity).toBeNull();
    expect((await clearedEvent).activity).toBeNull();

    observer.close();
  });
});
