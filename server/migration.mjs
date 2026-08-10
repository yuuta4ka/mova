import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.mjs';

const directory = await mkdtemp(join(tmpdir(), 'mova-migration-'));
const paths = { sqlitePath: join(directory, 'db.sqlite'), legacyJsonPath: join(directory, 'db.json'), uploadsPath: join(directory, 'uploads') };
const createdAt = '2026-08-10T10:00:00.000Z';
const readAt = '2026-08-10T10:01:00.000Z';

try {
  await writeFile(
    paths.legacyJsonPath,
    JSON.stringify({
      users: [
        { id: 'usr_a', name: 'A', email: 'a@example.test', handle: '@user_a', color: '#fff', presence: 'online', passwordHash: 'salt:00', createdAt },
        { id: 'usr_b', name: 'B', email: 'b@example.test', handle: '@user_b', color: '#000', presence: 'online', passwordHash: 'salt:00', createdAt },
      ],
      conversations: [{ id: 'cnv_a', kind: 'direct', title: '', createdBy: 'usr_a', createdAt }],
      memberships: [
        { conversationId: 'cnv_a', userId: 'usr_a', joinedAt: createdAt },
        { conversationId: 'cnv_a', userId: 'usr_b', joinedAt: createdAt },
      ],
      messages: [
        {
          id: 'msg_a',
          conversationId: 'cnv_a',
          authorId: 'usr_a',
          content: 'legacy',
          attachment: { name: 'legacy.txt', type: 'text/plain', size: 4, dataUrl: 'data:text/plain;base64,bW92YQ==' },
          createdAt,
          sentAt: createdAt,
          readBy: [{ userId: 'usr_b', readAt }],
        },
      ],
    }),
  );

  let database = await openDatabase(paths);
  const message = database.getMessage('msg_a', 'cnv_a');
  if (database.stats().messages !== 1 || !message.attachment.url.startsWith('/uploads/') || message.attachment.dataUrl) throw new Error('Legacy message migration failed');
  const stored = await readFile(join(paths.uploadsPath, message.attachment.url.split('/').at(-1)), 'utf8');
  if (stored !== 'mova' || database.readStates('cnv_a')[0]?.userId !== 'usr_b') throw new Error('Legacy attachment or read state migration failed');
  database.close();

  database = await openDatabase(paths);
  if (database.stats().messages !== 1) throw new Error('Legacy migration was executed twice');
  database.close();
  console.log(JSON.stringify({ migrated: true, attachmentUrl: true, readState: true, idempotent: true }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
