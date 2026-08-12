// @vitest-environment node

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let baseUrl;
let port;
let serverProcess;
let testDirectory;
const hookSecret = 'deployment-maintenance-test-secret';
const execFileAsync = promisify(execFile);

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

async function startServer() {
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOVA_PORT: String(port),
      MOVA_DATABASE_PATH: join(testDirectory, 'db.sqlite'),
      MOVA_SESSION_SECRET: 'deployment-test-session-secret',
      MOVA_DEPLOY_HOOK_SECRET: hookSecret,
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not become ready');
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
  serverProcess.kill('SIGTERM');
  await exited;
}

async function setMaintenance(active, deploymentId, previousInstanceId) {
  return fetch(`${baseUrl}/api/maintenance`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hookSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ active, deploymentId, previousInstanceId }),
  });
}

const waitForDeployment = (timeoutSeconds) =>
  execFileAsync(process.execPath, ['scripts/maintenance.mjs', 'wait-ready', 'deploy-restart', String(timeoutSeconds)], {
    cwd: process.cwd(),
    env: { ...process.env, MOVA_DEPLOY_URL: baseUrl, MOVA_DEPLOY_HOOK_SECRET: hookSecret },
  });

beforeAll(async () => {
  port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  testDirectory = await mkdtemp(join(tmpdir(), 'mova-deployment-test-'));
});

afterAll(async () => {
  await stopServer();
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

describe('deployment maintenance lifecycle', () => {
  it('persists through backend restart and clears only after the new instance is ready', async () => {
    const oldReadiness = await startServer();
    expect(oldReadiness.ok).toBe(true);
    expect(oldReadiness.instanceId).toBeTruthy();

    const enabled = await setMaintenance(true, 'deploy-restart', oldReadiness.instanceId);
    expect(enabled.ok).toBe(true);
    expect(await enabled.json()).toMatchObject({ active: true, previousInstanceId: oldReadiness.instanceId });

    await expect(waitForDeployment(0)).rejects.toBeTruthy();
    expect(await fetch(`${baseUrl}/api/maintenance`).then((response) => response.json())).toMatchObject({ active: true });

    await stopServer();
    const newReadiness = await startServer();
    expect(newReadiness.ok).toBe(true);
    expect(newReadiness.instanceId).not.toBe(oldReadiness.instanceId);

    const duringRestart = await fetch(`${baseUrl}/api/maintenance`).then((response) => response.json());
    expect(duringRestart).toMatchObject({ active: true, deploymentId: 'deploy-restart' });

    await expect(waitForDeployment(2)).resolves.toMatchObject({ stdout: expect.stringContaining(newReadiness.instanceId) });
    expect(await fetch(`${baseUrl}/api/maintenance`).then((response) => response.json())).toEqual({ active: false });
  });
});
