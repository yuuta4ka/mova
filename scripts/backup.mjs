import { resolve } from 'node:path';
import { createBackup, listBackups, restoreBackup, verifyBackup } from '../server/backup.mjs';
import { openDatabase, resolveDataPaths } from '../server/database.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const paths = resolveDataPaths(projectRoot);
const backupRoot = process.env.MOVA_BACKUP_PATH ? resolve(process.env.MOVA_BACKUP_PATH) : resolve(paths.sqlitePath, '..', 'backups');
const [action = 'list', argument] = process.argv.slice(2);

async function main() {
  if (action === 'create') {
    const database = await openDatabase(paths);
    try {
      const result = await createBackup(database, { root: backupRoot, retention: Number(process.env.MOVA_BACKUP_RETENTION || 14), reason: 'manual' });
      console.log(JSON.stringify({ ok: true, path: result.path, createdAt: result.manifest.createdAt }));
    } finally {
      database.close();
    }
    return;
  }
  if (action === 'list') {
    console.log(JSON.stringify((await listBackups(backupRoot)).map(({ path, manifest }) => ({ path, createdAt: manifest.createdAt, reason: manifest.reason }))));
    return;
  }
  if (action === 'verify' && argument) {
    const manifest = await verifyBackup(resolve(argument));
    console.log(JSON.stringify({ ok: true, createdAt: manifest.createdAt, uploads: manifest.uploads.length }));
    return;
  }
  if (action === 'restore' && argument) {
    const target = process.argv[4];
    if (!target) throw new Error('Restore requires a new empty target directory');
    const targetRoot = resolve(target);
    const manifest = await restoreBackup(resolve(argument), { sqlitePath: resolve(targetRoot, 'db.sqlite'), legacyJsonPath: resolve(targetRoot, 'db.json'), uploadsPath: resolve(targetRoot, 'uploads') });
    console.log(JSON.stringify({ ok: true, target: targetRoot, createdAt: manifest.createdAt }));
    return;
  }
  throw new Error('Usage: pnpm backup <create|list|verify PATH|restore PATH EMPTY_TARGET>');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
