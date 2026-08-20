// @vitest-environment node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

async function register(label) {
  const { response, result } = await request('/api/register', {
    method: 'POST',
    body: {
      name: label,
      email: `${label.toLocaleLowerCase()}.${Date.now()}.${Math.random()}@mova.test`,
      password: 'strongpass1',
    },
  });
  expect(response.status).toBe(201);
  return result;
}

beforeAll(async () => {
  const port = await availablePort();
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-group-test-'));
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: join(testDirectory, 'db.sqlite'),
      MOVA_SESSION_SECRET: 'group-conversation-test-secret',
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

describe('group conversations', () => {
  it('creates groups only with friends and persists the selected avatar', async () => {
    const owner = await register('Владелец');
    const member = await register('Участник');
    const stranger = await register('Посторонний');

    const rejected = await request('/api/conversations', {
      method: 'POST',
      token: owner.token,
      body: { kind: 'group', title: 'Закрытая группа', memberIds: [stranger.user.id] },
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.result.error).toBe('В группу можно добавлять только друзей');

    expect((await request(`/api/friends/${member.user.id}`, { method: 'POST', token: owner.token })).response.status).toBe(200);
    expect((await request(`/api/friends/${owner.user.id}`, { method: 'PATCH', token: member.token })).response.status).toBe(200);

    const created = await request('/api/conversations', {
      method: 'POST',
      token: owner.token,
      body: {
        kind: 'group',
        title: 'Команда друзей',
        memberIds: [member.user.id],
        avatarDataUrl,
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.result.conversation).toMatchObject({
      kind: 'group',
      title: 'Команда друзей',
      avatarDataUrl: expect.stringMatching(/^\/uploads\/.+\.png$/),
    });
    expect(created.result.conversation.members.map((user) => user.id)).toEqual(expect.arrayContaining([owner.user.id, member.user.id]));

    const memberConversations = await request('/api/conversations', { token: member.token });
    expect(memberConversations.response.status).toBe(200);
    expect(memberConversations.result.conversations).toContainEqual(expect.objectContaining({
      id: created.result.conversation.id,
      avatarDataUrl: created.result.conversation.avatarDataUrl,
    }));

    const avatarResponse = await fetch(`${baseUrl}${created.result.conversation.avatarDataUrl}`);
    expect(avatarResponse.status).toBe(200);
    expect(Buffer.from(await avatarResponse.arrayBuffer())).toEqual(avatarContents);

    const sqlite = new DatabaseSync(join(testDirectory, 'db.sqlite'), { readOnly: true });
    const stored = sqlite.prepare('SELECT avatar_url FROM conversations WHERE id=?').get(created.result.conversation.id);
    const upload = sqlite.prepare("SELECT purpose FROM uploads WHERE file_name=?").get(created.result.conversation.avatarDataUrl.slice('/uploads/'.length));
    sqlite.close();
    expect(stored.avatar_url).toBe(created.result.conversation.avatarDataUrl);
    expect(upload.purpose).toBe('conversation');

    const deleted = await request(`/api/conversations/${created.result.conversation.id}`, { method: 'DELETE', token: owner.token });
    expect(deleted.response.status).toBe(200);
    expect((await fetch(`${baseUrl}${created.result.conversation.avatarDataUrl}`)).status).toBe(404);
  });
});
