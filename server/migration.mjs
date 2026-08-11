import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.mjs';

const directory = await mkdtemp(join(tmpdir(), 'mova-migration-'));
const schemaDirectory = await mkdtemp(join(tmpdir(), 'mova-schema-migration-'));
const paths = { sqlitePath: join(directory, 'db.sqlite'), legacyJsonPath: join(directory, 'db.json'), uploadsPath: join(directory, 'uploads') };
const oldSchemaPaths = { sqlitePath: join(schemaDirectory, 'db.sqlite'), legacyJsonPath: join(schemaDirectory, 'db.json'), uploadsPath: join(schemaDirectory, 'uploads') };
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

  database = await openDatabase(oldSchemaPaths);
  database.insertUser({ id: 'usr_old', name: 'Old', email: 'old@example.test', handle: '@old_user', color: '#fff', presence: 'online', passwordHash: 'salt:00', createdAt });
  database.insertConversation({ id: 'cnv_old', kind: 'direct', title: '', createdBy: 'usr_old', createdAt });
  database.insertMembership({ conversationId: 'cnv_old', userId: 'usr_old', joinedAt: createdAt });
  database.insertMessage({ id: 'msg_old', conversationId: 'cnv_old', authorId: 'usr_old', content: 'before client id', createdAt, sentAt: createdAt });
  database.close();
  const oldSchema = new DatabaseSync(oldSchemaPaths.sqlitePath);
  oldSchema.exec('DROP INDEX idx_messages_author_client; ALTER TABLE messages DROP COLUMN client_id');
  oldSchema.close();

  database = await openDatabase(oldSchemaPaths);
  const migratedColumns = database.sqlite.prepare('PRAGMA table_info(messages)').all();
  if (!migratedColumns.some((column) => column.name === 'client_id') || database.getMessage('msg_old', 'cnv_old')?.content !== 'before client id') throw new Error('Existing messages table did not migrate safely');
  const newMessage = { id: 'msg_new', conversationId: 'cnv_old', authorId: 'usr_old', content: 'after client id', clientId: 'migration-client-id', createdAt, sentAt: createdAt };
  database.insertMessageIdempotent(newMessage);
  database.close();
  database = await openDatabase(oldSchemaPaths);
  if (database.getMessage('msg_new', 'cnv_old')?.clientId !== 'migration-client-id') throw new Error('Persisted client id was lost after reopening SQLite');
  database.close();
  console.log(JSON.stringify({ migrated: true, attachmentUrl: true, readState: true, idempotent: true, clientIdSchema: true, clientIdReopen: true }));
} finally {
  await rm(directory, { recursive: true, force: true });
  await rm(schemaDirectory, { recursive: true, force: true });
}
