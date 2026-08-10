import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const testDirectory = await mkdtemp(join(tmpdir(), 'mova-call-e2e-'));
const port = 8792;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, MOVA_PORT: String(port), MOVA_DATABASE_PATH: join(testDirectory, 'db.json') },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('E2E server did not start');
};
const api = async (path, method = 'GET', data, token) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result;
};

let browser;
try {
  await waitForServer();
  const suffix = Date.now();
  const first = await api('/api/register', 'POST', { name: 'Звонящий', email: `caller.${suffix}@mova.test`, password: 'strongpass1' });
  const second = await api('/api/register', 'POST', { name: 'Принимающий', email: `callee.${suffix}@mova.test`, password: 'strongpass2' });
  const conversation = await api('/api/conversations', 'POST', { kind: 'direct', memberIds: [second.user.id] }, first.token);

  const browserCandidates = [process.env.MOVA_BROWSER_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  let executablePath;
  for (const candidate of browserCandidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
  if (!executablePath) throw new Error('Chromium not found. Run `pnpm exec playwright install chromium` or set MOVA_BROWSER_PATH.');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const openUser = async (token) => {
    const context = await browser.newContext({ permissions: ['microphone', 'camera'], baseURL: base, ...(process.env.MOVA_MOBILE_CALL_QA === '1' ? { viewport: { width: 390, height: 844 } } : {}) });
    await context.addInitScript((sessionToken) => sessionStorage.setItem('mova-session', sessionToken), token);
    const page = await context.newPage();
    const frames = [];
    const realtimeReady = new Promise((resolve) => page.on('websocket', (socket) => {
      if (!socket.url().includes('/ws')) return;
      socket.on('framesent', ({ payload }) => frames.push(`sent:${String(payload)}`));
      socket.on('framereceived', ({ payload }) => { frames.push(`received:${String(payload)}`); if (String(payload).includes('"type":"ready"')) resolve(); });
    }));
    await page.goto(`${base}/app`);
    await page.getByRole('button', { name: 'Позвонить' }).waitFor();
    await Promise.race([realtimeReady, new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime socket was not ready')), 5_000))]);
    return { context, page, frames };
  };
  const caller = await openUser(first.token);
  const callee = await openUser(second.token);

  const initialMessage = `До звонка ${suffix}`;
  await caller.page.getByPlaceholder('Сообщение...').fill(initialMessage);
  await caller.page.getByRole('button', { name: 'Отправить' }).click();
  await callee.page.locator('.mova-real-message').getByText(initialMessage, { exact: true }).waitFor({ timeout: 5_000 });
  await caller.page.locator('.mova-real-message').filter({ hasText: initialMessage }).waitFor({ timeout: 5_000 });
  if ((await caller.page.locator('.mova-real-message').filter({ hasText: initialMessage }).count()) !== 1) throw new Error('Optimistic message was duplicated after server acknowledgement');

  await caller.page.evaluate(() => {
    localStorage.setItem('mova-audio-settings', JSON.stringify({ inputDeviceId: 'missing-device', outputDeviceId: 'default' }));
  });

  await caller.page.getByRole('button', { name: 'Позвонить' }).click();
  try { await callee.page.getByRole('button', { name: 'Принять', exact: true }).click({ timeout: 5_000 }); }
  catch (error) { console.error(JSON.stringify({ callerFrames: caller.frames, calleeFrames: callee.frames }, null, 2)); throw error; }
  const healthyCall = '.mova-call-stage[data-call-connected="true"][data-audio-sending="true"][data-audio-receiving="true"]';
  await Promise.all([
    caller.page.locator(healthyCall).waitFor({ timeout: 20_000 }),
    callee.page.locator(healthyCall).waitFor({ timeout: 20_000 }),
  ]);

  await Promise.all([
    caller.page.getByRole('button', { name: 'Включить камеру' }).click(),
    callee.page.getByRole('button', { name: 'Включить камеру' }).click(),
  ]);
  await Promise.all([
    caller.page.locator('.mova-call-primary-participant .mova-call-tile.has-video:not(.is-self)').waitFor({ timeout: 10_000 }),
    caller.page.locator('.mova-call-self-view .mova-call-tile.has-video.is-self').waitFor({ timeout: 10_000 }),
    callee.page.locator('.mova-call-primary-participant .mova-call-tile.has-video:not(.is-self)').waitFor({ timeout: 10_000 }),
    callee.page.locator('.mova-call-self-view .mova-call-tile.has-video.is-self').waitFor({ timeout: 10_000 }),
  ]);
  if (await caller.page.getByRole('button', { name: /Открыть .* · вы на весь экран/ }).count()) throw new Error('The local preview must not replace the remote participant');
  if (process.env.MOVA_CALL_SCREENSHOT) {
    await caller.page.screenshot({ path: process.env.MOVA_CALL_SCREENSHOT });
    await caller.page.locator('.mova-call-primary-participant').getByRole('button', { name: /Открыть .* на весь экран/ }).click();
    await caller.page.locator('.mova-call-self-view .mova-call-tile.is-self').waitFor({ state: 'visible' });
    await caller.page.screenshot({ path: process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i, '') + '-expanded.png' });
    await caller.page.getByRole('button', { name: 'Закрыть полноэкранный режим' }).click();
  }

  await caller.page.getByRole('button', { name: 'Выйти из звонка' }).click();
  await caller.page.getByRole('button', { name: 'Подключиться к звонку' }).waitFor({ timeout: 5_000 });
  await callee.page.locator('.mova-call-stage').waitFor({ state: 'visible' });

  const messageWhileCallContinues = `Звонок продолжается ${suffix}`;
  await caller.page.getByPlaceholder('Сообщение...').fill(messageWhileCallContinues);
  await caller.page.getByRole('button', { name: 'Отправить' }).click();
  await callee.page.getByRole('button', { name: /Открыть чат/ }).click();
  await callee.page.locator('.mova-real-message').getByText(messageWhileCallContinues, { exact: true }).waitFor({ timeout: 5_000 });
  if (process.env.MOVA_MOBILE_CALL_QA === '1') await callee.page.getByRole('button', { name: 'Закрыть чат' }).click();

  await caller.page.getByRole('button', { name: 'Подключиться к звонку' }).click();
  await Promise.all([
    caller.page.locator(healthyCall).waitFor({ timeout: 20_000 }),
    callee.page.locator(healthyCall).waitFor({ timeout: 20_000 }),
  ]);

  await caller.page.getByRole('button', { name: 'Выйти из звонка' }).click();
  await caller.page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied by regression test', 'NotAllowedError');
    };
  });
  await caller.page.getByRole('button', { name: 'Подключиться к звонку' }).click();
  await caller.page.getByRole('button', { name: /Повторить подключение/ }).waitFor({ timeout: 5_000 });

  const messageAfterMicFailure = `После ошибки микрофона ${suffix}`;
  await caller.page.getByPlaceholder('Сообщение...').fill(messageAfterMicFailure);
  await caller.page.getByRole('button', { name: 'Отправить' }).click();
  await callee.page.locator('.mova-real-message').getByText(messageAfterMicFailure, { exact: true }).waitFor({ timeout: 5_000 });

  await callee.page.getByRole('button', { name: 'Выйти из звонка' }).click();
  await caller.page.getByRole('button', { name: 'Позвонить' }).waitFor({ timeout: 5_000 });
  await caller.page.locator('.mova-call-system-message').filter({ hasText: 'Звонок завершён' }).waitFor({ timeout: 5_000 });

  const storedMessages = await api(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  console.log(JSON.stringify({ connected: true, callerAudio: true, calleeAudio: true, returnedToCall: true, micFailureDoesNotBlockChat: true, messagesSent: storedMessages.messages.length }));
  await caller.context.close();
  await callee.context.close();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await rm(testDirectory, { recursive: true, force: true });
}
