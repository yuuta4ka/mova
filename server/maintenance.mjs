import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const inactiveState = { active: false };

export class MaintenanceStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async read() {
    try {
      const stored = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!stored?.active) return inactiveState;
      return {
        active: true,
        deploymentId: String(stored.deploymentId || ''),
        previousInstanceId: String(stored.previousInstanceId || ''),
        startedAt: String(stored.startedAt || ''),
      };
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return inactiveState;
      throw error;
    }
  }

  async update({ active, deploymentId, previousInstanceId }) {
    const current = await this.read();
    const normalizedDeploymentId = String(deploymentId || '').trim();
    if (!normalizedDeploymentId) throw Object.assign(new Error('deploymentId is required'), { statusCode: 400 });
    if (current.active && current.deploymentId !== normalizedDeploymentId)
      throw Object.assign(new Error(`Maintenance is already active for ${current.deploymentId}`), { statusCode: 409 });

    const next = active
      ? {
          active: true,
          deploymentId: normalizedDeploymentId.slice(0, 160),
          previousInstanceId: String(previousInstanceId || '').slice(0, 160),
          startedAt: current.active ? current.startedAt : new Date().toISOString(),
        }
      : { active: false, deploymentId: normalizedDeploymentId.slice(0, 160), completedAt: new Date().toISOString() };
    const temporaryPath = join(dirname(this.filePath), `.maintenance-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    await rename(temporaryPath, this.filePath);
    return next.active ? next : inactiveState;
  }
}
