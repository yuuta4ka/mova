import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, listBackups, restoreBackup, verifyBackup } from './backup.mjs';
import { openDatabase } from './database.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mova-backup-'));
  temporaryRoots.push(root);
  const paths = { sqlitePath: join(root, 'data', 'db.sqlite'), legacyJsonPath: join(root, 'data', 'db.json'), uploadsPath: join(root, 'data', 'uploads') };
  const database = await openDatabase(paths);
  const createdAt = '2026-08-13T10:00:00.000Z';
  database.insertUser({ id: 'user', name: 'Юта', email: 'user@mova.test', handle: '@user', color: '#74DCCB', passwordHash: 'hash', createdAt });
  database.createConversation({ id: 'chat', kind: 'direct', title: 'Backup', createdBy: 'user', createdAt }, ['user']);
  const attachment = await database.storeBuffer(Buffer.from('backup attachment'), 'proof.txt', 'text/plain', 'user');
  expect(database.getUpload(attachment.url.split('/').at(-1))).toEqual({
    fileName: attachment.url.split('/').at(-1),
    originalName: 'proof.txt',
    type: 'text/plain',
    size: Buffer.byteLength('backup attachment'),
  });
  expect(await database.normalizeAttachment({ ...attachment, name: 'spoofed.bin', type: 'application/octet-stream', size: 999_999 }, 'user')).toEqual(attachment);
  for (let index = 1; index <= 7; index += 1) {
    const id = `message-${String(index).padStart(2, '0')}`;
    database.insertMessage({ id, conversationId: 'chat', authorId: 'user', content: `Сообщение ${index}`, attachment: index === 7 ? attachment : null, createdAt, sentAt: createdAt });
  }
  database.markVoiceListened('message-01', 'user', '2026-08-13T10:01:00.000Z');
  return { root, paths, database, attachment };
}

describe('message cursor pagination', () => {
  it('returns every message once with a stable createdAt/id cursor', async () => {
    const { database } = await fixture();
    try {
      const newest = database.messagePage('chat', { limit: 3 });
      const middle = database.messagePage('chat', { limit: 3, before: JSON.parse(Buffer.from(newest.nextCursor, 'base64url').toString()) });
      const oldest = database.messagePage('chat', { limit: 3, before: JSON.parse(Buffer.from(middle.nextCursor, 'base64url').toString()) });
      const ids = [...oldest.messages, ...middle.messages, ...newest.messages].map((message) => message.id);

      expect(ids).toEqual(['message-01', 'message-02', 'message-03', 'message-04', 'message-05', 'message-06', 'message-07']);
      expect(newest.hasMore).toBe(true);
      expect(middle.hasMore).toBe(true);
      expect(oldest.hasMore).toBe(false);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      database.close();
    }
  });
});

describe('SQLite backups', () => {
  it('verifies checksums and restores the database with registered uploads', async () => {
    const { root, database, attachment } = await fixture();
    const backupRoot = join(root, 'backups');
    const restoredPaths = { sqlitePath: join(root, 'restore', 'db.sqlite'), legacyJsonPath: join(root, 'restore', 'db.json'), uploadsPath: join(root, 'restore', 'uploads') };
    try {
      const backup = await createBackup(database, { root: backupRoot, now: new Date('2026-08-13T12:00:00.000Z'), reason: 'test' });
      expect((await verifyBackup(backup.path)).reason).toBe('test');
      await restoreBackup(backup.path, restoredPaths);
      const restored = await openDatabase(restoredPaths);
      try {
        expect(restored.messages('chat').map((message) => message.content)).toHaveLength(7);
        expect(restored.voiceListens('message-01')).toEqual([{ userId: 'user', listenedAt: '2026-08-13T10:01:00.000Z' }]);
        expect(await readFile(join(restoredPaths.uploadsPath, attachment.url.split('/').at(-1)), 'utf8')).toBe('backup attachment');
      } finally {
        restored.close();
      }
    } finally {
      database.close();
    }
  });

  it('keeps only the configured number of successful backups', async () => {
    const { root, database } = await fixture();
    const backupRoot = join(root, 'backups');
    try {
      for (let day = 1; day <= 3; day += 1) {
        await createBackup(database, { root: backupRoot, retention: 2, now: new Date(`2026-08-${10 + day}T12:00:00.000Z`) });
      }
      expect((await listBackups(backupRoot)).map((backup) => backup.manifest.createdAt)).toEqual(['2026-08-13T12:00:00.000Z', '2026-08-12T12:00:00.000Z']);
    } finally {
      database.close();
    }
  });
});
