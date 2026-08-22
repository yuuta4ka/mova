// @vitest-environment node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-saved-test-'));
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: join(testDirectory, 'db.sqlite'),
      MOVA_SESSION_SECRET: 'saved-messages-test-secret',
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

describe('saved messages', () => {
  it('creates one private saved chat and keeps forwarding provenance with a source jump', async () => {
    const owner = await register('Владелец');
    const author = await register('Автор');

    const ownerOverview = await request('/api/conversations', { token: owner.token });
    const authorOverview = await request('/api/conversations', { token: author.token });
    const ownerSaved = ownerOverview.result.conversations.find((conversation) => conversation.kind === 'saved');
    const authorSaved = authorOverview.result.conversations.find((conversation) => conversation.kind === 'saved');

    expect(ownerOverview.response.status).toBe(200);
    expect(ownerSaved).toMatchObject({ title: 'Избранное', members: [expect.objectContaining({ id: owner.user.id })] });
    expect(authorSaved).toMatchObject({ title: 'Избранное', members: [expect.objectContaining({ id: author.user.id })] });
    expect(authorSaved.id).not.toBe(ownerSaved.id);

    const direct = await request('/api/conversations', {
      method: 'POST',
      token: owner.token,
      body: { kind: 'direct', memberIds: [author.user.id] },
    });
    const source = await request(`/api/conversations/${direct.result.conversation.id}/messages`, {
      method: 'POST',
      token: author.token,
      body: {
        content: 'Сообщение автора',
        attachment: {
          name: 'photo.png',
          type: 'image/png',
          size: 68,
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        },
      },
    });
    const forwarded = await request(`/api/conversations/${direct.result.conversation.id}/messages/${source.result.message.id}/forward`, {
      method: 'POST',
      token: owner.token,
      body: { conversationId: ownerSaved.id },
    });

    expect(forwarded.response.status).toBe(201);
    expect(forwarded.result.message).toMatchObject({
      conversationId: ownerSaved.id,
      authorId: owner.user.id,
      content: 'Сообщение автора',
      attachment: expect.objectContaining({ name: 'photo.png', type: 'image/png', url: expect.stringMatching(/^\/uploads\//) }),
      forwardedFrom: {
        authorId: author.user.id,
        authorName: 'Автор',
        conversationId: direct.result.conversation.id,
        messageId: source.result.message.id,
        canOpen: true,
      },
    });

    const context = await request(`/api/conversations/${direct.result.conversation.id}/messages/${source.result.message.id}/context`, { token: owner.token });
    expect(context.response.status).toBe(200);
    expect(context.result.messages).toContainEqual(expect.objectContaining({ id: source.result.message.id, content: 'Сообщение автора' }));

    expect((await request(`/api/conversations/${ownerSaved.id}/messages`, { token: author.token })).response.status).toBe(403);
    expect((await request(`/api/conversations/${ownerSaved.id}`, { method: 'DELETE', token: owner.token })).result.error).toBe('Избранное нельзя удалить');
    expect((await request('/api/conversations', { token: owner.token })).result.conversations.filter((conversation) => conversation.kind === 'saved')).toHaveLength(1);
  });
});
