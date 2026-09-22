import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installPortraitCamera, verifyMobileCameras } from './call-camera-regression.mjs';
import { verifyCallMedia } from './call-media-regression.mjs';

const testDirectory = await mkdtemp(join(tmpdir(), 'mova-call-e2e-'));
const port = 8792;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, MOVA_PORT: String(port), MOVA_DATABASE_PATH: join(testDirectory, 'db.json'), MOVA_MAINTENANCE_PATH: join(testDirectory, 'maintenance.json'), MOVA_AUTH_TEST_BYPASS: '1' },
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
  if (process.env.MOVA_TEST_CAMERA === '1') {
    const avatarDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    await Promise.all([first, second].map(user => api('/api/profile', 'PATCH', { name: user.user.name, handle: user.user.handle, avatarDataUrl }, user.token)));
  }
  await api(`/api/friends/${second.user.id}`, 'POST', undefined, first.token);
  await api(`/api/friends/${first.user.id}`, 'PATCH', undefined, second.token);
  const conversation = await api('/api/conversations', 'POST', { kind: 'direct', memberIds: [second.user.id] }, first.token);

  const browserCandidates = [process.env.MOVA_BROWSER_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  let executablePath;
  for (const candidate of browserCandidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
  if (!executablePath) throw new Error('Chromium not found. Run `pnpm exec playwright install chromium` or set MOVA_BROWSER_PATH.');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${process.env.MOVA_TEST_AUDIO_FILE || fileURLToPath(new URL('./fixtures/call-speech.wav', import.meta.url))}`] });
  const openUser = async (token, selectedConversationId = conversation.conversation.id) => {
    const context = await browser.newContext({ permissions: ['microphone', 'camera'], baseURL: base, ...(process.env.MOVA_MOBILE_CALL_QA === '1' ? { viewport: { width: 390, height: 844 } } : {}) });
    await context.addInitScript(({ sessionToken, conversationId }) => { sessionStorage.setItem('mova-session', sessionToken); localStorage.setItem('mova-selected-conversation', conversationId); }, { sessionToken: token, conversationId: selectedConversationId });
    // Control a real Web Audio capture track to test digital silence and recovery.
    await context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(...args) { super(...args); window.__callTestSocket = this; }
      };
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await capture(constraints);
        if (!constraints?.audio || constraints.video) return stream;
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const gain = audioContext.createGain();
        const output = audioContext.createMediaStreamDestination();
        source.connect(gain).connect(output);
        await audioContext.resume();
        window.__callTestCapture = { gain, audioContext };
        return output.stream;
      };
    });
    const page = await context.newPage();
    const frames = [];
    const realtimeReady = new Promise((resolve) => page.on('websocket', (socket) => {
      if (!socket.url().includes('/ws')) return;
      socket.on('framesent', ({ payload }) => frames.push(`sent:${String(payload)}`));
      socket.on('framereceived', ({ payload }) => { frames.push(`received:${String(payload)}`); if (String(payload).includes('"type":"ready"')) resolve(); });
    }));
    await page.goto(`${base}/app`);
    if (process.env.MOVA_MOBILE_CALL_QA === '1') await page.locator('.mova-real-chat-list>button').filter({ hasText: token === first.token ? second.user.name : first.user.name }).click();
    try { await page.getByRole('button', { name: 'Позвонить' }).waitFor({ timeout: 10_000 }); } catch (error) { console.error((await page.locator('body').innerText()).slice(0, 2500)); await page.screenshot({ path: '/tmp/mova-call-start-failure.png' }); throw error; }
    await Promise.race([realtimeReady, new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime socket was not ready')), 5_000))]);
    return { context, page, frames };
  };
  const caller = await openUser(first.token);
  const callee = await openUser(second.token);

  const initialMessage = `До звонка ${suffix}`;
  await caller.page.getByRole('textbox', { name: /^Сообщение в / }).fill(initialMessage);
  await caller.page.getByRole('button', { name: 'Отправить' }).click();
  await callee.page.locator('.mova-real-message').getByText(initialMessage, { exact: true }).waitFor({ timeout: 5_000 });
  await caller.page.locator('.mova-real-message').filter({ hasText: initialMessage }).waitFor({ timeout: 5_000 });
  if ((await caller.page.locator('.mova-real-message').filter({ hasText: initialMessage }).count()) !== 1) throw new Error('Optimistic message was duplicated after server acknowledgement');

  const failedParticipant = process.env.MOVA_TEST_CALLEE_CAPTURE === '1' ? callee : caller;
  await failedParticipant.page.evaluate(() => {
    localStorage.setItem('mova-audio-settings', JSON.stringify({ inputDeviceId: 'missing-device', outputDeviceId: 'default' }));
  });

  await caller.page.getByRole('button', { name: 'Позвонить' }).click();
  try { await callee.page.getByRole('button', { name: 'Принять', exact: true }).click({ timeout: 5_000 }); }
  catch (error) { console.error(JSON.stringify({ callerFrames: caller.frames, calleeFrames: callee.frames }, null, 2)); throw error; }
  await failedParticipant.page.getByRole('button', { name: /Повторить подключение/ }).waitFor({ timeout: 5_000 });
  await failedParticipant.page.getByRole('alert').filter({ hasText: 'Выбранный микрофон недоступен' }).waitFor();
  await failedParticipant.page.waitForTimeout(400);
  if (process.env.MOVA_CALL_SCREENSHOT) await failedParticipant.page.screenshot({ path: process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i, '') + '-recovery.png' });
  await failedParticipant.page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
    document.execCommand = () => false;
  });
  const reportDownload = failedParticipant.page.waitForEvent('download');
  await failedParticipant.page.getByRole('button', { name: 'Отчёт о звонке', exact: true }).click();
  const reportFile = await reportDownload;
  const report = JSON.parse(await readFile(await reportFile.path(), 'utf8'));
  if (report.call.failure !== 'microphone-unavailable' || report.call.state !== 'available') throw new Error('Failed-call report did not preserve the capture failure');
  await failedParticipant.page.getByRole('status').filter({ hasText: 'Отчёт сохранён в файл' }).waitFor();
  await failedParticipant.page.getByRole('button', { name: 'Подключиться с системным микрофоном' }).click();
  const healthyCall = '.mova-call-stage[data-call-connected="true"][data-audio-sending="true"][data-audio-receiving="true"]';
  await Promise.all([
    caller.page.locator(healthyCall).waitFor({ timeout: 20_000 }),
    callee.page.locator(healthyCall).waitFor({ timeout: 20_000 }),
  ]).catch(async (error) => {
    console.error(JSON.stringify(await Promise.all([caller.page, callee.page].map(async (page) => ({ text: (await page.locator('body').innerText()).slice(-1800), call: await page.locator('.mova-call-stage').evaluateAll((elements) => elements.map((element) => ({ connected: element.dataset.callConnected, sending: element.dataset.audioSending, receiving: element.dataset.audioReceiving }))) })))));
    throw error;
  });

  if (process.env.MOVA_TEST_CALL_SWITCH === '1') {
    const third = await api('/api/register', 'POST', { name: 'Третий участник', email: `third.${suffix}@mova.test`, password: 'strongpass3' });
    await api(`/api/friends/${third.user.id}`, 'POST', undefined, first.token);
    await api(`/api/friends/${first.user.id}`, 'PATCH', undefined, third.token);
    const other = await api('/api/conversations', 'POST', { kind: 'direct', memberIds: [third.user.id] }, first.token);
    const thirdClient = await openUser(third.token, other.conversation.id);
    await caller.page.locator('.mova-real-chat-list>button').filter({ hasText: third.user.name }).click();
    await caller.page.getByRole('button', { name: 'Позвонить', exact: true }).click().catch(async error => {
      console.error('Call switch navigation:', (await caller.page.locator('body').innerText()).slice(-2000));
      throw error;
    });
    await thirdClient.page.getByRole('button', { name: 'Принять', exact: true }).click();
    await Promise.all([caller.page.locator(healthyCall).waitFor({ timeout: 20_000 }), thirdClient.page.locator(healthyCall).waitFor({ timeout: 20_000 })]).catch(async (error) => {
      console.error(JSON.stringify(await Promise.all([caller, thirdClient].map(async (client) => ({ text: (await client.page.locator('body').innerText()).slice(-2000), frames: client.frames.slice(-30).map((frame) => frame.slice(0, 240)) })))));
      throw error;
    });
    const originalInvites = caller.frames.filter((frame) => frame.startsWith('sent:') && frame.includes('"type":"call:invite"') && frame.includes(conversation.conversation.id)).length;
    await caller.page.locator('.mova-real-chat-list>button').filter({ hasText: second.user.name }).click();
    await caller.page.getByRole('button', { name: 'Позвонить', exact: true }).click().catch(async error => {
      console.error('Call switch navigation:', (await caller.page.locator('body').innerText()).slice(-2000));
      throw error;
    });
    await Promise.all([caller.page.locator(healthyCall).waitFor({ timeout: 20_000 }), callee.page.locator(healthyCall).waitFor({ timeout: 20_000 })]);
    if (caller.frames.filter((frame) => frame.startsWith('sent:') && frame.includes('"type":"call:invite"') && frame.includes(conversation.conversation.id)).length > originalInvites + 1) throw new Error('Repeated invites while switching to an existing call');
    await thirdClient.context.close();
    console.log('Call switch A -> B -> existing A: bidirectional audio verified');
  }

  const readyBefore = caller.frames.filter((frame) => frame.includes('received:') && frame.includes('"type":"ready"')).length;
  await caller.page.evaluate(() => window.__callTestSocket.close(4000, 'Call regression test'));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (caller.frames.filter((frame) => frame.includes('received:') && frame.includes('"type":"ready"')).length > readyBefore) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (caller.frames.filter((frame) => frame.includes('received:') && frame.includes('"type":"ready"')).length <= readyBefore) throw new Error('Signalling failed to reconnect');
  await caller.page.locator(healthyCall).waitFor({ timeout: 10_000 });
  await caller.page.locator('.mova-call-participant-state.is-reconnecting').waitFor({ state: 'hidden' });
  await callee.page.locator('.mova-call-participant-state.is-reconnecting').waitFor({ state: 'hidden' });

  await caller.page.evaluate(() => { window.__callTestCapture.gain.gain.value = 0; });
  await caller.page.getByText('Нет сигнала с микрофона', { exact: true }).waitFor({ timeout: 16_000 });
  if (process.env.MOVA_CALL_SCREENSHOT) await caller.page.screenshot({ path: process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i, '') + '-silent.png' });
  await caller.page.getByRole('button', { name: 'Выключить микрофон', exact: true }).click();
  await caller.page.getByText('Нет сигнала с микрофона', { exact: true }).waitFor({ state: 'hidden' });
  await caller.page.getByRole('button', { name: 'Включить микрофон', exact: true }).click();
  await caller.page.evaluate(() => { window.__callTestCapture.gain.gain.value = 1; });
  await caller.page.locator(healthyCall).waitFor({ timeout: 10_000 });
  await caller.page.getByText('Нет сигнала с микрофона', { exact: true }).waitFor({ state: 'hidden' });

  if (process.env.MOVA_TEST_SCREEN === '1') await verifyCallMedia(caller, callee);

  if (process.env.MOVA_TEST_CAMERA === '1') await Promise.all([installPortraitCamera(caller.page), installPortraitCamera(callee.page)]);
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
  await Promise.all([caller.page, callee.page].map(page => page.waitForFunction(() => {
    const videos = [...document.querySelectorAll('.mova-call-grid.is-participants video')];
    return videos.length === 2 && videos.every(video => video.videoWidth > 0 && video.readyState >= 2);
  }, null, { timeout: 10000 })));
  if (await caller.page.getByRole('button', { name: /Открыть .* · вы на весь экран/ }).count()) throw new Error('The local preview must not replace the remote participant');
  if (process.env.MOVA_TEST_CAMERA === '1') await verifyMobileCameras(caller, callee);
  if (process.env.MOVA_CALL_SCREENSHOT && process.env.MOVA_TEST_CAMERA !== '1') {
    await caller.page.screenshot({ path: process.env.MOVA_CALL_SCREENSHOT });
    await caller.page.locator('.mova-call-primary-participant').getByRole('button', { name: /Открыть .* на весь экран/ }).click();
    await caller.page.locator('.mova-call-self-view .mova-call-tile.is-self').waitFor({ state: 'visible' });
    await caller.page.screenshot({ path: process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i, '') + '-expanded.png' });
    await caller.page.getByRole('button', { name: 'Закрыть полноэкранный режим' }).click();
  }

  await caller.page.getByRole('button', { name: 'Выйти из звонка' }).click();
  await caller.page.getByRole('button', { name: `Вернуться в звонок с ${second.user.name}` }).waitFor({ timeout: 5_000 });
  await callee.page.locator('.mova-call-stage').waitFor({ state: 'visible' });

  const messageWhileCallContinues = `Звонок продолжается ${suffix}`;
  await caller.page.getByRole('textbox', { name: /^Сообщение в / }).fill(messageWhileCallContinues);
  await caller.page.getByRole('button', { name: 'Отправить' }).click();
  if (await callee.page.getByRole('button', { name: /Открыть чат/ }).isVisible()) await callee.page.getByRole('button', { name: /Открыть чат/ }).click();
  await callee.page.locator('.mova-real-message').getByText(messageWhileCallContinues, { exact: true }).waitFor({ timeout: 5_000 });
  if (process.env.MOVA_MOBILE_CALL_QA === '1') await callee.page.getByRole('button', { name: 'Закрыть чат' }).click();

  await caller.page.getByRole('button', { name: `Вернуться в звонок с ${second.user.name}` }).click();
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
  await caller.page.getByRole('button', { name: `Вернуться в звонок с ${second.user.name}` }).click();
  await caller.page.getByRole('button', { name: /Повторить подключение/ }).waitFor({ timeout: 5_000 });

  const messageAfterMicFailure = `После ошибки микрофона ${suffix}`;
  await caller.page.getByRole('textbox', { name: /^Сообщение в / }).fill(messageAfterMicFailure);
  await caller.page.getByRole('button', { name: 'Отправить' }).click();
  if (process.env.MOVA_MOBILE_CALL_QA === '1') if (await callee.page.getByRole('button', { name: /Открыть чат/ }).isVisible()) await callee.page.getByRole('button', { name: /Открыть чат/ }).click();
  await callee.page.locator('.mova-real-message').getByText(messageAfterMicFailure, { exact: true }).waitFor({ timeout: 5_000 });
  if (process.env.MOVA_MOBILE_CALL_QA === '1') await callee.page.getByRole('button', { name: 'Закрыть чат' }).click();

  await callee.page.getByRole('button', { name: 'Выйти из звонка' }).click();
  await caller.page.getByRole('button', { name: 'Позвонить' }).waitFor({ timeout: 5_000 });
  await caller.page.locator('.mova-call-system-message').filter({ hasText: 'Звонок завершён' }).waitFor({ timeout: 5_000 });

  const storedMessages = await api(`/api/conversations/${conversation.conversation.id}/messages`, 'GET', undefined, first.token);
  console.log(JSON.stringify({ connected: true, signalingRecovered: true, missingMicrophoneDoesNotFallback: true, silentMicrophoneWarning: true, callerAudio: true, calleeAudio: true, returnedToCall: true, micFailureDoesNotBlockChat: true, messagesSent: storedMessages.messages.length }));
  await caller.context.close();
  await callee.context.close();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await rm(testDirectory, { recursive: true, force: true });
}
