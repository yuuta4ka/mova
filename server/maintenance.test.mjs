// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MaintenanceStore } from './maintenance.mjs';

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('persistent maintenance state', () => {
  it('survives a new store instance and is only cleared by the matching deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mova-maintenance-test-'));
    directories.push(directory);
    const filePath = join(directory, 'maintenance.json');
    const store = new MaintenanceStore(filePath);

    await store.update({ active: true, deploymentId: 'deploy-1', previousInstanceId: 'instance-old' });
    await expect(new MaintenanceStore(filePath).read()).resolves.toMatchObject({
      active: true,
      deploymentId: 'deploy-1',
      previousInstanceId: 'instance-old',
    });
    await expect(store.update({ active: false, deploymentId: 'deploy-2' })).rejects.toMatchObject({ statusCode: 409 });
    await store.update({ active: false, deploymentId: 'deploy-1' });

    await expect(new MaintenanceStore(filePath).read()).resolves.toEqual({ active: false });
    expect(JSON.parse(await readFile(filePath, 'utf8')).completedAt).toBeTruthy();
  });
});
