// @vitest-environment node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const avatarContents = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const avatarDataUrl = `data:image/png;base64,${avatarContents.toString('base64')}`;

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
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}

async function openSocket(token) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
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

beforeAll(async () => {
  const port = await availablePort();
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-avatar-test-'));
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: join(testDirectory, 'db.sqlite'),
      MOVA_SESSION_SECRET: 'profile-avatar-test-secret',
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
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGTERM');
    await exited;
  }
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

describe('profile avatar persistence', () => {
  it('keeps an uploaded avatar after fetching the saved profile and logging in again', async () => {
    const credentials = {
      name: 'Аватар',
      email: `avatar.${Date.now()}@mova.test`,
      password: 'strongpass1',
    };
    const registered = await request('/api/register', { method: 'POST', body: credentials });
    const socket = await openSocket(registered.token);
    const updated = await request('/api/profile', {
      method: 'PATCH',
      token: registered.token,
      body: {
        name: 'Аватар Новый',
        handle: '@avatar_test',
        bio: 'Описание должно пережить отключение',
        avatarDataUrl,
        bannerDataUrl: '',
        activity: null,
      },
    });

    expect(updated.user.avatarDataUrl).toMatch(/^\/uploads\/.+\.png$/);
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));

    let storedProfile;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      storedProfile = await request('/api/me', { token: registered.token });
      if (storedProfile.user.lastActiveAt !== registered.user.lastActiveAt) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(storedProfile.user.name).toBe(updated.user.name);
    expect(storedProfile.user.bio).toBe(updated.user.bio);
    expect(storedProfile.user.avatarDataUrl).toBe(updated.user.avatarDataUrl);

    const loggedIn = await request('/api/login', {
      method: 'POST',
      body: { email: credentials.email, password: credentials.password },
    });
    expect(loggedIn.user.avatarDataUrl).toBe(updated.user.avatarDataUrl);

    const sqlite = new DatabaseSync(join(testDirectory, 'db.sqlite'), { readOnly: true });
    const storedRow = sqlite.prepare('SELECT name,bio,avatar_url FROM users WHERE id=?').get(registered.user.id);
    sqlite.close();
    expect(storedRow.name).toBe(updated.user.name);
    expect(storedRow.bio).toBe(updated.user.bio);
    expect(storedRow.avatar_url).toBe(updated.user.avatarDataUrl);

    const avatarResponse = await fetch(`${baseUrl}${storedProfile.user.avatarDataUrl}`);
    expect(avatarResponse.ok).toBe(true);
    expect(Buffer.from(await avatarResponse.arrayBuffer())).toEqual(avatarContents);
  });
});
