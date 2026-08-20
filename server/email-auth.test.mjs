// @vitest-environment node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let baseUrl;
let serverProcess;
let testDirectory;
let databasePath;
let emailPath;

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
  return { response, result: await response.json() };
}

async function deliveredEmails() {
  try {
    return (await readFile(emailPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function emailCode(purpose, to) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const email = (await deliveredEmails()).findLast((item) => item.purpose === purpose && item.to === to);
    if (email?.code) return email.code;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Email ${purpose} to ${to} was not delivered`);
}

beforeAll(async () => {
  const port = await availablePort();
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-email-auth-test-'));
  databasePath = join(testDirectory, 'db.sqlite');
  emailPath = join(testDirectory, 'emails.jsonl');
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: databasePath,
      MOVA_SESSION_SECRET: 'email-auth-test-session-secret',
      MOVA_EMAIL_TEST_PATH: emailPath,
      MOVA_BACKUPS_ENABLED: 'false',
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/ready`)).ok) return;
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

describe('email authentication flows', () => {
  it('verifies registration, resets the password and confirms an email change', async () => {
    const originalEmail = `email.auth.${Date.now()}@mova.test`;
    const changedEmail = `email.changed.${Date.now()}@mova.test`;
    const registration = await request('/api/register', {
      method: 'POST',
      body: { name: 'Почтовый пользователь', email: originalEmail, password: 'strongpass1' },
    });
    expect(registration.response.status).toBe(202);
    expect(registration.result).toMatchObject({ email: originalEmail, resendAfterSeconds: 60 });

    const beforeVerification = new DatabaseSync(databasePath, { readOnly: true });
    expect(beforeVerification.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(0);
    beforeVerification.close();

    const registrationCode = await emailCode('registration', originalEmail);
    const wrongRegistrationCode = await request('/api/register/verify', {
      method: 'POST',
      body: { challengeId: registration.result.challengeId, code: registrationCode === '000000' ? '000001' : '000000' },
    });
    expect(wrongRegistrationCode.response.status).toBe(400);

    const verified = await request('/api/register/verify', {
      method: 'POST',
      body: { challengeId: registration.result.challengeId, code: registrationCode },
    });
    expect(verified.response.status).toBe(201);
    expect(verified.result.user).toMatchObject({ email: originalEmail });
    expect(verified.result.user.emailVerifiedAt).toBeTruthy();

    const replay = await request('/api/register/verify', {
      method: 'POST',
      body: { challengeId: registration.result.challengeId, code: registrationCode },
    });
    expect(replay.response.status).toBe(400);

    const legacyAccount = new DatabaseSync(databasePath);
    legacyAccount.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(verified.result.user.id);
    legacyAccount.close();
    const beforeExistingVerification = await request('/api/me', { token: verified.result.token });
    expect(beforeExistingVerification.response.status).toBe(200);
    expect(beforeExistingVerification.result.user.emailVerifiedAt).toBeUndefined();

    const existingVerification = await request('/api/email-verification/request', { method: 'POST', token: verified.result.token });
    expect(existingVerification.response.status).toBe(202);
    expect(existingVerification.result.email).toBe(originalEmail);
    const existingVerificationCode = await emailCode('email_verification', originalEmail);
    const existingVerified = await request('/api/email-verification/confirm', {
      method: 'POST',
      token: verified.result.token,
      body: { challengeId: existingVerification.result.challengeId, code: existingVerificationCode },
    });
    expect(existingVerified.response.status).toBe(200);
    expect(existingVerified.result.user.emailVerifiedAt).toBeTruthy();
    expect((await request('/api/me', { token: verified.result.token })).result.user.emailVerifiedAt).toBeTruthy();

    const unknownReset = await request('/api/password-reset/request', { method: 'POST', body: { email: 'missing@mova.test' } });
    expect(unknownReset.response.status).toBe(202);
    expect(unknownReset.result.message).toContain('Если аккаунт');
    expect((await deliveredEmails()).some((item) => item.to === 'missing@mova.test')).toBe(false);

    const reset = await request('/api/password-reset/request', { method: 'POST', body: { email: originalEmail } });
    expect(reset.response.status).toBe(202);
    expect(reset.result.message).toEqual(unknownReset.result.message);
    const resetCode = await emailCode('password_reset', originalEmail);
    const resetConfirmed = await request('/api/password-reset/confirm', {
      method: 'POST',
      body: { challengeId: reset.result.challengeId, code: resetCode, password: 'strongpass2' },
    });
    expect(resetConfirmed.response.status).toBe(200);
    expect((await request('/api/me', { token: verified.result.token })).response.status).toBe(401);
    expect((await request('/api/login', { method: 'POST', body: { email: originalEmail, password: 'strongpass1' } })).response.status).toBe(401);

    const login = await request('/api/login', { method: 'POST', body: { email: originalEmail, password: 'strongpass2' } });
    expect(login.response.status).toBe(200);

    const wrongPasswordChange = await request('/api/email-change/request', {
      method: 'POST',
      token: login.result.token,
      body: { email: changedEmail, password: 'not-the-password' },
    });
    expect(wrongPasswordChange.response.status).toBe(401);

    const emailChange = await request('/api/email-change/request', {
      method: 'POST',
      token: login.result.token,
      body: { email: changedEmail, password: 'strongpass2' },
    });
    expect(emailChange.response.status).toBe(202);
    const emailChangeCode = await emailCode('email_change', changedEmail);
    const changed = await request('/api/email-change/confirm', {
      method: 'POST',
      token: login.result.token,
      body: { challengeId: emailChange.result.challengeId, code: emailChangeCode },
    });
    expect(changed.response.status).toBe(200);
    expect(changed.result.user.email).toBe(changedEmail);
    expect((await request('/api/me', { token: login.result.token })).response.status).toBe(401);
    expect((await request('/api/me', { token: changed.result.token })).result.user.email).toBe(changedEmail);
    expect((await request('/api/login', { method: 'POST', body: { email: originalEmail, password: 'strongpass2' } })).response.status).toBe(401);
    expect((await request('/api/login', { method: 'POST', body: { email: changedEmail, password: 'strongpass2' } })).response.status).toBe(200);

    const sqlite = new DatabaseSync(databasePath, { readOnly: true });
    const row = sqlite.prepare('SELECT email,email_verified_at,session_version FROM users WHERE id=?').get(verified.result.user.id);
    sqlite.close();
    expect(row.email).toBe(changedEmail);
    expect(row.email_verified_at).toBeTruthy();
    expect(row.session_version).toBe(3);
    expect((await deliveredEmails()).some((item) => item.purpose === 'email_changed_notice' && item.to === originalEmail)).toBe(true);
  });
});
