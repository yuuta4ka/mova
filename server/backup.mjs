import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const backupName = (date) => date.toISOString().replace(/[:.]/g, '-');

async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function inspectDatabase(path) {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = sqlite.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity.join(', ')}`);
    const uploads = sqlite.prepare('SELECT file_name FROM uploads ORDER BY file_name').all().map((row) => String(row.file_name));
    return { integrity: 'ok', uploads };
  } finally {
    sqlite.close();
  }
}

function safeFileName(value) {
  const file = String(value || '');
  if (!file || file === '.' || file === '..' || basename(file) !== file) throw new Error(`Unsafe backup file name: ${file}`);
  return file;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function resolveBackupConfig(paths) {
  return {
    enabled: process.env.MOVA_BACKUPS_ENABLED !== 'false',
    root: process.env.MOVA_BACKUP_PATH ? resolve(process.env.MOVA_BACKUP_PATH) : join(dirname(paths.sqlitePath), 'backups'),
    intervalMs: boundedNumber(process.env.MOVA_BACKUP_INTERVAL_MS, 24 * 60 * 60_000, 60_000, 365 * 24 * 60 * 60_000),
    retention: boundedNumber(process.env.MOVA_BACKUP_RETENTION, 14, 1, 365),
  };
}

export async function listBackups(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    try {
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
      backups.push({ path, manifest });
    } catch {}
  }
  return backups.sort((first, second) => String(second.manifest.createdAt).localeCompare(String(first.manifest.createdAt)));
}

export async function verifyBackup(path) {
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  const databasePath = join(path, safeFileName(manifest.database.file));
  const databaseStat = await stat(databasePath);
  if (databaseStat.size !== manifest.database.size || (await sha256(databasePath)) !== manifest.database.sha256) throw new Error('Backup database checksum mismatch');
  inspectDatabase(databasePath);
  for (const upload of manifest.uploads) {
    const uploadPath = join(path, 'uploads', safeFileName(upload.file));
    const uploadStat = await stat(uploadPath);
    if (uploadStat.size !== upload.size || (await sha256(uploadPath)) !== upload.sha256) throw new Error(`Backup upload checksum mismatch: ${upload.file}`);
  }
  return manifest;
}

export async function pruneBackups(root, retention) {
  const backups = await listBackups(root);
  const keep = boundedNumber(retention, 14, 1, 365);
  await Promise.all(backups.slice(keep).map((backup) => rm(backup.path, { recursive: true, force: true })));
  return backups.slice(0, keep);
}

export async function createBackup(database, { root, retention = 14, now = new Date(), reason = 'scheduled' } = {}) {
  if (!root) throw new Error('Backup root is required');
  await mkdir(root, { recursive: true });
  const name = backupName(now);
  const temporaryPath = join(root, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
  const finalPath = join(root, name);
  await mkdir(join(temporaryPath, 'uploads'), { recursive: true });
  try {
    const databasePath = join(temporaryPath, 'db.sqlite');
    await writeFile(databasePath, database.sqlite.serialize());
    const inspection = inspectDatabase(databasePath);
    const uploads = [];
    for (const file of inspection.uploads) {
      const source = join(database.paths.uploadsPath, file);
      const destination = join(temporaryPath, 'uploads', file);
      await copyFile(source, destination);
      const fileStat = await stat(destination);
      uploads.push({ file, size: fileStat.size, sha256: await sha256(destination) });
    }
    const databaseStat = await stat(databasePath);
    const manifest = {
      format: 1,
      createdAt: now.toISOString(),
      reason,
      database: { file: 'db.sqlite', size: databaseStat.size, sha256: await sha256(databasePath), integrity: inspection.integrity },
      uploads,
    };
    await writeFile(join(temporaryPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (await stat(finalPath).catch(() => null)) throw new Error(`Backup already exists: ${name}`);
    await rename(temporaryPath, finalPath);
    await verifyBackup(finalPath);
    await pruneBackups(root, retention);
    return { path: finalPath, manifest };
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreBackup(backupPath, targetPaths) {
  const manifest = await verifyBackup(backupPath);
  await mkdir(dirname(targetPaths.sqlitePath), { recursive: true });
  await mkdir(targetPaths.uploadsPath, { recursive: true });
  if ((await stat(targetPaths.sqlitePath).catch(() => null)) || (await readdir(targetPaths.uploadsPath).catch(() => [])).length) throw new Error('Restore target must be empty');
  await copyFile(join(backupPath, safeFileName(manifest.database.file)), targetPaths.sqlitePath);
  for (const upload of manifest.uploads) {
    const file = safeFileName(upload.file);
    await copyFile(join(backupPath, 'uploads', file), join(targetPaths.uploadsPath, file));
  }
  return manifest;
}

export async function backupIfDue(database, config, now = new Date()) {
  if (!config.enabled) return null;
  const latest = (await listBackups(config.root))[0];
  if (latest && now.getTime() - new Date(latest.manifest.createdAt).getTime() < config.intervalMs) return null;
  return createBackup(database, { root: config.root, retention: config.retention, now });
}
