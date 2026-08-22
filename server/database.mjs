import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const jsonParse = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const extensionByMime = {
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
};

function attachmentMediaMetadata(attachment, mime) {
  if (!String(mime).startsWith('audio/')) return {};
  const durationMs = Math.round(Number(attachment.durationMs || 0));
  const waveform = Array.isArray(attachment.waveform)
    ? attachment.waveform.slice(0, 80).map(Number).filter(Number.isFinite).map((value) => Math.round(Math.max(0.08, Math.min(1, value)) * 100) / 100)
    : [];
  return {
    ...(durationMs >= 300 && durationMs <= 2 * 60 * 60_000 ? { durationMs } : {}),
    ...(waveform.length >= 8 ? { waveform } : {}),
  };
}

function sniffImageMime(contents) {
  if (contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff) return 'image/jpeg';
  if (contents.subarray(0, 6).toString('ascii') === 'GIF87a' || contents.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (contents.subarray(0, 4).toString('ascii') === 'RIFF' && contents.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (contents.subarray(4, 12).toString('ascii').includes('ftypavif') || contents.subarray(4, 12).toString('ascii').includes('ftypavis')) return 'image/avif';
  return '';
}

function safeExtension(name, mime) {
  if (String(mime).startsWith('image/') && extensionByMime[mime]) return extensionByMime[mime];
  const candidate = extname(String(name || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(candidate)) return candidate;
  return extensionByMime[mime] || '.bin';
}

function rowUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    handle: row.handle,
    color: row.color,
    presence: row.presence,
    dndUntil: row.dnd_until,
    bio: row.bio || '',
    avatarDataUrl: row.avatar_url || '',
    bannerDataUrl: row.banner_url || '',
    activity: jsonParse(row.activity_json),
    lastActiveAt: row.last_active_at,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at || undefined,
    sessionVersion: Number(row.session_version || 1),
    createdAt: row.created_at,
  };
}

function rowEmailChallenge(row) {
  if (!row) return null;
  return {
    id: row.id,
    purpose: row.purpose,
    userId: row.user_id || null,
    email: row.email,
    codeHash: row.code_hash,
    payload: jsonParse(row.payload_json, {}),
    expiresAt: row.expires_at,
    attemptCount: Number(row.attempt_count || 0),
    consumedAt: row.consumed_at || null,
    createdAt: row.created_at,
  };
}

function rowMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    kind: row.kind || 'user',
    content: row.content || '',
    attachment: jsonParse(row.attachment_json),
    replyToId: row.reply_to_id || undefined,
    forwardedFrom: jsonParse(row.forward_json),
    call: jsonParse(row.call_json),
    friendRequest: jsonParse(row.friend_request_json),
    clientId: row.client_id || undefined,
    createdAt: row.created_at,
    sentAt: row.sent_at || row.created_at,
    editedAt: row.edited_at || undefined,
    pinnedAt: row.pinned_at || undefined,
    pinnedById: row.pinned_by_id || undefined,
  };
}

function rowConversation(row) {
  return row
    ? {
        id: row.id,
        kind: row.kind,
        title: row.title || '',
        avatarDataUrl: row.avatar_url || '',
        createdBy: row.created_by,
        createdAt: row.created_at,
      }
    : null;
}

export function resolveDataPaths(projectRoot) {
  const configured = process.env.MOVA_DATABASE_PATH ? resolve(process.env.MOVA_DATABASE_PATH) : null;
  const dataRoot = process.env.AMVERA ? '/data' : resolve(projectRoot, '.mova-data');
  const sqlitePath = configured ? (extname(configured).toLowerCase() === '.json' ? join(dirname(configured), `${basename(configured, extname(configured))}.sqlite`) : configured) : join(dataRoot, 'db.sqlite');
  const legacyJsonPath = configured && extname(configured).toLowerCase() === '.json' ? configured : join(dirname(sqlitePath), 'db.json');
  const uploadsPath = process.env.MOVA_UPLOADS_PATH ? resolve(process.env.MOVA_UPLOADS_PATH) : join(dirname(sqlitePath), 'uploads');
  return { sqlitePath, legacyJsonPath, uploadsPath };
}

export async function openDatabase(paths) {
  await mkdir(dirname(paths.sqlitePath), { recursive: true });
  await mkdir(paths.uploadsPath, { recursive: true });
  const sqlite = new DatabaseSync(paths.sqlitePath);
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      presence TEXT NOT NULL DEFAULT 'online',
      dnd_until TEXT,
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      banner_url TEXT NOT NULL DEFAULT '',
      activity_json TEXT,
      last_active_at TEXT,
      password_hash TEXT NOT NULL,
      email_verified_at TEXT,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_challenges (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      payload_json TEXT,
      expires_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      last_read_message_id TEXT,
      last_read_at TEXT,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL DEFAULT '',
      attachment_json TEXT,
      reply_to_id TEXT REFERENCES messages(id),
      forward_json TEXT,
      call_json TEXT,
      friend_request_json TEXT,
      client_id TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      edited_at TEXT,
      pinned_at TEXT,
      pinned_by_id TEXT REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS message_deletions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS voice_message_listens (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listened_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS uploads (
      file_name TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      attached_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      purpose TEXT NOT NULL DEFAULT 'pending',
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS friendships (
      user_low_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_low_id, user_high_id)
    );
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_cleanup ON uploads(purpose, created_at);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id);
    CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_voice_message_listens_user ON voice_message_listens(user_id, listened_at);
    CREATE INDEX IF NOT EXISTS idx_friendships_requested_by ON friendships(requested_by, status);
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id, blocker_id);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_email_challenges_lookup ON email_challenges(purpose, email, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_challenges_cleanup ON email_challenges(expires_at, consumed_at);
  `);
  const userColumns = sqlite.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'email_verified_at')) sqlite.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  if (!userColumns.some((column) => column.name === 'session_version')) sqlite.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1');
  const membershipColumns = sqlite.prepare('PRAGMA table_info(memberships)').all();
  if (!membershipColumns.some((column) => column.name === 'role')) sqlite.exec("ALTER TABLE memberships ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  sqlite.exec(`UPDATE memberships SET role='owner'
    WHERE role!='owner' AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id=memberships.conversation_id AND c.kind='group' AND c.created_by=memberships.user_id
    )`);
  const legacyEmailResetKey = 'legacy_email_verification_reset_2026_08_20';
  const emailVerificationLaunchAt = '2026-08-20T18:50:12.460Z';
  if (!sqlite.prepare('SELECT 1 FROM metadata WHERE key=?').get(legacyEmailResetKey)) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite
        .prepare('UPDATE users SET email_verified_at=NULL WHERE created_at < ? AND email_verified_at=created_at')
        .run(emailVerificationLaunchAt);
      sqlite.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run(legacyEmailResetKey, new Date().toISOString());
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  sqlite.exec('UPDATE users SET session_version=COALESCE(session_version, 1)');
  const messageColumns = sqlite.prepare('PRAGMA table_info(messages)').all();
  if (!messageColumns.some((column) => column.name === 'client_id')) sqlite.exec('ALTER TABLE messages ADD COLUMN client_id TEXT');
  if (!messageColumns.some((column) => column.name === 'friend_request_json')) sqlite.exec('ALTER TABLE messages ADD COLUMN friend_request_json TEXT');
  if (!messageColumns.some((column) => column.name === 'forward_json')) sqlite.exec('ALTER TABLE messages ADD COLUMN forward_json TEXT');
  if (!messageColumns.some((column) => column.name === 'pinned_at')) sqlite.exec('ALTER TABLE messages ADD COLUMN pinned_at TEXT');
  if (!messageColumns.some((column) => column.name === 'pinned_by_id')) sqlite.exec('ALTER TABLE messages ADD COLUMN pinned_by_id TEXT REFERENCES users(id)');
  const uploadColumns = sqlite.prepare('PRAGMA table_info(uploads)').all();
  if (!uploadColumns.some((column) => column.name === 'original_name')) sqlite.exec("ALTER TABLE uploads ADD COLUMN original_name TEXT NOT NULL DEFAULT ''");
  if (!uploadColumns.some((column) => column.name === 'mime_type')) sqlite.exec("ALTER TABLE uploads ADD COLUMN mime_type TEXT NOT NULL DEFAULT ''");
  if (!uploadColumns.some((column) => column.name === 'size')) sqlite.exec('ALTER TABLE uploads ADD COLUMN size INTEGER NOT NULL DEFAULT 0');
  const conversationColumns = sqlite.prepare('PRAGMA table_info(conversations)').all();
  if (!conversationColumns.some((column) => column.name === 'avatar_url')) sqlite.exec("ALTER TABLE conversations ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''");
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_author_client ON messages(author_id, client_id) WHERE client_id IS NOT NULL');
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_saved_owner ON conversations(created_by) WHERE kind='saved'");
  const database = new MovaDatabase(sqlite, paths);
  await database.migrateLegacyJson();
  return database;
}

export class MovaDatabase {
  constructor(sqlite, paths) {
    this.sqlite = sqlite;
    this.paths = paths;
  }

  close() {
    this.sqlite.close();
  }

  transaction(operation) {
    if (this.sqlite.isTransaction) return operation();
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  metadata(key) {
    return this.sqlite.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value || null;
  }

  setMetadata(key, value) {
    this.sqlite.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run(key, value);
  }

  savePushSubscription(userId, subscription) {
    const endpoint = String(subscription?.endpoint || '');
    if (!endpoint) throw Object.assign(new Error('Некорректная push-подписка'), { statusCode: 400 });
    const now = new Date().toISOString();
    this.sqlite
      .prepare(`INSERT INTO push_subscriptions(endpoint,user_id,subscription_json,created_at,updated_at)
        VALUES(?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,updated_at=excluded.updated_at`)
      .run(endpoint, userId, JSON.stringify(subscription), now, now);
    return endpoint;
  }

  pushSubscriptions(userId) {
    return this.sqlite
      .prepare('SELECT subscription_json FROM push_subscriptions WHERE user_id=? ORDER BY updated_at DESC')
      .all(userId)
      .flatMap((row) => {
        const subscription = jsonParse(row.subscription_json);
        return subscription?.endpoint ? [subscription] : [];
      });
  }

  deletePushSubscription(endpoint, userId) {
    return this.sqlite.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?${userId ? ' AND user_id=?' : ''}`).run(...(userId ? [endpoint, userId] : [endpoint])).changes > 0;
  }

  count(table) {
    if (!['users', 'conversations', 'memberships', 'messages'].includes(table)) throw new Error('Unknown table');
    return Number(this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  }

  stats() {
    return {
      users: this.count('users'),
      conversations: this.count('conversations'),
      memberships: this.count('memberships'),
      messages: this.count('messages'),
    };
  }

  getUpload(fileName) {
    const row = this.sqlite.prepare('SELECT file_name, original_name, mime_type, size FROM uploads WHERE file_name=?').get(fileName);
    if (!row) return null;
    return {
      fileName: row.file_name,
      originalName: row.original_name || '',
      type: row.mime_type || '',
      size: Number(row.size || 0),
    };
  }

  async storeDataUrl(dataUrl, name = 'file', ownerId = null, purpose = 'pending') {
    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
    if (!match) throw Object.assign(new Error('Некорректное содержимое файла'), { statusCode: 400 });
    const mime = match[1].toLowerCase();
    const contents = Buffer.from(match[2], 'base64');
    return this.storeBuffer(contents, name, mime, ownerId, purpose);
  }

  async storeBuffer(contents, name, mime, ownerId = null, purpose = 'pending') {
    if (!Buffer.isBuffer(contents) || !contents.length) throw Object.assign(new Error('Файл пуст'), { statusCode: 400 });
    if (contents.length > 8_000_000) throw Object.assign(new Error('Файл должен быть меньше 8 МБ'), { statusCode: 413 });
    if (String(mime).startsWith('image/')) {
      const detected = sniffImageMime(contents);
      if (!detected) throw Object.assign(new Error('Неподдерживаемый или повреждённый формат изображения'), { statusCode: 400 });
      mime = detected;
    }
    const fileName = `${Date.now().toString(36)}-${randomBytes(12).toString('hex')}${safeExtension(name, mime)}`;
    const filePath = join(this.paths.uploadsPath, fileName);
    await writeFile(filePath, contents, { flag: 'wx' });
    try {
      this.sqlite.prepare('INSERT INTO uploads(file_name,owner_id,created_at,purpose,original_name,mime_type,size) VALUES(?,?,?,?,?,?,?)')
        .run(fileName, ownerId, new Date().toISOString(), purpose, String(name || 'Файл').slice(0, 180), String(mime || 'application/octet-stream').slice(0, 120), contents.length);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    return {
      name: String(name || 'Файл').slice(0, 180),
      type: String(mime || 'application/octet-stream').slice(0, 120),
      size: contents.length,
      url: `/uploads/${fileName}`,
    };
  }

  async normalizeAttachment(attachment, ownerId = null) {
    if (!attachment) return null;
    if (attachment.url?.startsWith('/uploads/')) {
      const fileName = attachment.url.slice('/uploads/'.length);
      const upload = this.sqlite.prepare('SELECT owner_id, attached_message_id, original_name, mime_type, size FROM uploads WHERE file_name=?').get(fileName);
      if (!upload || (ownerId && upload.owner_id && upload.owner_id !== ownerId) || upload.attached_message_id) throw Object.assign(new Error('Загрузка недоступна'), { statusCode: 403 });
      return {
        name: String(upload.original_name || attachment.name || 'Файл').slice(0, 180),
        type: String(upload.mime_type || attachment.type || 'application/octet-stream').slice(0, 120),
        size: Number(upload.size || attachment.size || 0),
        url: attachment.url,
        ...attachmentMediaMetadata(attachment, attachment.type),
      };
    }
    if (!attachment.dataUrl) throw Object.assign(new Error('Сначала загрузите файл'), { statusCode: 400 });
    return this.storeDataUrl(attachment.dataUrl, attachment.name, ownerId);
  }

  async normalizeProfileImage(value, name, ownerId = null) {
    if (!value) return '';
    if (String(value).startsWith('/uploads/')) {
      const fileName = String(value).slice('/uploads/'.length);
      const upload = this.sqlite.prepare('SELECT owner_id, purpose FROM uploads WHERE file_name=?').get(fileName);
      if (!upload || (ownerId && upload.owner_id && upload.owner_id !== ownerId) || !['profile', 'pending'].includes(upload.purpose)) throw Object.assign(new Error('Изображение профиля недоступно'), { statusCode: 403 });
      this.sqlite.prepare("UPDATE uploads SET purpose='profile' WHERE file_name=?").run(fileName);
      return String(value);
    }
    if (!String(value).startsWith('data:image/')) throw Object.assign(new Error('Некорректное изображение профиля'), { statusCode: 400 });
    return (await this.storeDataUrl(value, name, ownerId, 'profile')).url;
  }

  async normalizeConversationImage(value, name, ownerId = null) {
    if (!value) return '';
    if (String(value).startsWith('/uploads/')) {
      const fileName = String(value).slice('/uploads/'.length);
      const upload = this.sqlite.prepare('SELECT owner_id, purpose FROM uploads WHERE file_name=?').get(fileName);
      if (!upload || (ownerId && upload.owner_id && upload.owner_id !== ownerId) || !['conversation', 'pending'].includes(upload.purpose)) throw Object.assign(new Error('Изображение группы недоступно'), { statusCode: 403 });
      this.sqlite.prepare("UPDATE uploads SET purpose='conversation' WHERE file_name=?").run(fileName);
      return String(value);
    }
    if (!String(value).startsWith('data:image/')) throw Object.assign(new Error('Некорректное изображение группы'), { statusCode: 400 });
    return (await this.storeDataUrl(value, name, ownerId, 'conversation')).url;
  }

  async cleanupOrphanUploads(maxAgeMs = 24 * 60 * 60_000) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = this.sqlite
      .prepare(`SELECT file_name FROM uploads WHERE created_at<? AND (
        (purpose='pending' AND attached_message_id IS NULL) OR
        (purpose='profile' AND NOT EXISTS (
          SELECT 1 FROM users WHERE avatar_url='/uploads/' || uploads.file_name OR banner_url='/uploads/' || uploads.file_name
        )) OR
        (purpose='conversation' AND NOT EXISTS (
          SELECT 1 FROM conversations WHERE avatar_url='/uploads/' || uploads.file_name
        ))
      )`)
      .all(cutoff);
    for (const row of rows) {
      await unlink(join(this.paths.uploadsPath, row.file_name)).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      this.sqlite.prepare('DELETE FROM uploads WHERE file_name=?').run(row.file_name);
    }
    return rows.length;
  }

  async migrateLegacyJson() {
    if (this.count('users') || this.sqlite.prepare("SELECT value FROM metadata WHERE key = 'legacy_migrated'").get()) return;
    let legacy;
    try {
      legacy = JSON.parse(await readFile(this.paths.legacyJsonPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('Legacy database was preserved but could not be imported:', error.message);
      this.sqlite.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('legacy_migrated', ?)").run(new Date().toISOString());
      return;
    }

    const users = [];
    for (const user of legacy.users || []) {
      users.push({
        ...user,
        avatarDataUrl: await this.normalizeProfileImage(user.avatarDataUrl, `${user.id}-avatar`),
        bannerDataUrl: await this.normalizeProfileImage(user.bannerDataUrl, `${user.id}-banner`),
      });
    }
    const messages = [];
    for (const message of legacy.messages || []) {
      messages.push({ ...message, attachment: await this.normalizeAttachment(message.attachment) });
    }

    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      for (const user of users) this.insertUser(user);
      for (const conversation of legacy.conversations || []) this.insertConversation(conversation);
      for (const membership of legacy.memberships || []) this.insertMembership(membership);
      for (const message of messages) this.insertMessage(message);
      for (const message of legacy.messages || []) {
        for (const receipt of message.readBy || []) {
          const current = this.sqlite.prepare('SELECT last_read_at FROM memberships WHERE conversation_id = ? AND user_id = ?').get(message.conversationId, receipt.userId);
          if (!current?.last_read_at || current.last_read_at < receipt.readAt) {
            this.sqlite.prepare('UPDATE memberships SET last_read_message_id = ?, last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(message.id, receipt.readAt, message.conversationId, receipt.userId);
          }
        }
      }
      this.sqlite.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('legacy_migrated', ?)").run(new Date().toISOString());
      this.sqlite.exec('COMMIT');
      console.log(`Migrated legacy database from ${this.paths.legacyJsonPath}: ${users.length} users, ${messages.length} messages`);
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  getUserById(userId) {
    return rowUser(this.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  }

  getUserByEmail(email) {
    return rowUser(this.sqlite.prepare('SELECT * FROM users WHERE email = ?').get(email));
  }

  getUserByHandle(handle) {
    return rowUser(this.sqlite.prepare('SELECT * FROM users WHERE handle = ?').get(handle));
  }

  listUsers(exceptUserId = '') {
    return this.sqlite.prepare('SELECT * FROM users WHERE id != ? ORDER BY name COLLATE NOCASE').all(exceptUserId).map(rowUser);
  }

  relationship(viewerId, otherUserId) {
    if (!viewerId || !otherUserId) return 'none';
    if (viewerId === otherUserId) return 'self';
    const block = this.sqlite
      .prepare(`SELECT blocker_id FROM user_blocks
        WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1`)
      .get(viewerId, otherUserId, otherUserId, viewerId);
    if (block) return block.blocker_id === viewerId ? 'blocked' : 'blocked_by';
    const [userLowId, userHighId] = [viewerId, otherUserId].sort();
    const friendship = this.sqlite.prepare('SELECT requested_by,status FROM friendships WHERE user_low_id=? AND user_high_id=?').get(userLowId, userHighId);
    if (!friendship) return 'none';
    if (friendship.status === 'accepted') return 'friend';
    if (friendship.status !== 'pending') return 'none';
    return friendship.requested_by === viewerId ? 'outgoing' : 'incoming';
  }

  areFriends(firstUserId, secondUserId) {
    return this.relationship(firstUserId, secondUserId) === 'friend';
  }

  isBlockedEither(firstUserId, secondUserId) {
    const relationship = this.relationship(firstUserId, secondUserId);
    return relationship === 'blocked' || relationship === 'blocked_by';
  }

  requestFriend(requesterId, otherUserId) {
    const [userLowId, userHighId] = [requesterId, otherUserId].sort();
    const now = new Date().toISOString();
    const existing = this.sqlite.prepare('SELECT requested_by,status,updated_at FROM friendships WHERE user_low_id=? AND user_high_id=?').get(userLowId, userHighId);
    if (!existing) {
      this.sqlite.prepare(`INSERT INTO friendships(user_low_id,user_high_id,requested_by,status,created_at,updated_at)
        VALUES(?,?,?,'pending',?,?)`).run(userLowId, userHighId, requesterId, now, now);
      return { relationship: 'outgoing', created: true };
    }
    if (existing.status === 'accepted') return { relationship: 'friend', created: false };
    if (existing.status === 'pending') return { relationship: existing.requested_by === requesterId ? 'outgoing' : 'incoming', created: false };
    const retryAtMs = new Date(existing.updated_at).getTime() + 24 * 60 * 60_000;
    if (existing.status === 'declined' && existing.requested_by === requesterId && retryAtMs > Date.now()) {
      return { relationship: 'none', created: false, retryAt: new Date(retryAtMs).toISOString() };
    }
    this.sqlite.prepare(`UPDATE friendships SET requested_by=?,status='pending',created_at=?,updated_at=?
      WHERE user_low_id=? AND user_high_id=?`).run(requesterId, now, now, userLowId, userHighId);
    return { relationship: 'outgoing', created: true };
  }

  acceptFriend(userId, requesterId) {
    const [userLowId, userHighId] = [userId, requesterId].sort();
    this.sqlite.prepare(`UPDATE friendships SET status='accepted',updated_at=?
      WHERE user_low_id=? AND user_high_id=? AND status='pending' AND requested_by=?`).run(new Date().toISOString(), userLowId, userHighId, requesterId);
    return this.relationship(userId, requesterId);
  }

  rejectFriend(userId, requesterId) {
    const [userLowId, userHighId] = [userId, requesterId].sort();
    const result = this.sqlite.prepare(`UPDATE friendships SET status='declined',updated_at=?
      WHERE user_low_id=? AND user_high_id=? AND status='pending' AND requested_by=?`).run(new Date().toISOString(), userLowId, userHighId, requesterId);
    return result.changes > 0;
  }

  removeFriend(firstUserId, secondUserId) {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    this.sqlite.prepare('DELETE FROM friendships WHERE user_low_id=? AND user_high_id=?').run(userLowId, userHighId);
  }

  blockUser(blockerId, blockedId) {
    this.transaction(() => {
      const [userLowId, userHighId] = [blockerId, blockedId].sort();
      this.sqlite.prepare("DELETE FROM friendships WHERE user_low_id=? AND user_high_id=? AND status!='declined'").run(userLowId, userHighId);
      this.sqlite.prepare('INSERT OR IGNORE INTO user_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(blockerId, blockedId, new Date().toISOString());
    });
  }

  unblockUser(blockerId, blockedId) {
    this.sqlite.prepare('DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?').run(blockerId, blockedId);
  }

  insertUser(user) {
    this.sqlite
      .prepare(`INSERT INTO users(id,name,email,handle,color,presence,dnd_until,bio,avatar_url,banner_url,activity_json,last_active_at,password_hash,email_verified_at,session_version,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(user.id, user.name, user.email, user.handle, user.color, user.presence || 'online', user.dndUntil || null, user.bio || '', user.avatarDataUrl || '', user.bannerDataUrl || '', user.activity ? JSON.stringify(user.activity) : null, user.lastActiveAt || null, user.passwordHash, user.emailVerifiedAt || null, Number(user.sessionVersion || 1), user.createdAt);
  }

  updateUser(user) {
    this.sqlite
      .prepare(`UPDATE users SET name=?, email=?, handle=?, color=?, presence=?, dnd_until=?, bio=?, avatar_url=?, banner_url=?, activity_json=?, last_active_at=?, password_hash=?, email_verified_at=?, session_version=? WHERE id=?`)
      .run(user.name, user.email, user.handle, user.color, user.presence, user.dndUntil || null, user.bio || '', user.avatarDataUrl || '', user.bannerDataUrl || '', user.activity ? JSON.stringify(user.activity) : null, user.lastActiveAt || null, user.passwordHash, user.emailVerifiedAt || null, Number(user.sessionVersion || 1), user.id);
  }

  clearGameActivities() {
    return this.sqlite.prepare('UPDATE users SET activity_json=NULL WHERE activity_json IS NOT NULL').run().changes;
  }

  createEmailChallenge(challenge) {
    this.transaction(() => {
      this.sqlite.prepare(`DELETE FROM email_challenges WHERE purpose=? AND consumed_at IS NULL AND (email=? OR (? IS NOT NULL AND user_id=?))`).run(challenge.purpose, challenge.email, challenge.userId || null, challenge.userId || null);
      this.sqlite.prepare(`INSERT INTO email_challenges(id,purpose,user_id,email,code_hash,payload_json,expires_at,attempt_count,consumed_at,created_at)
        VALUES(?,?,?,?,?,?,?,0,NULL,?)`).run(challenge.id, challenge.purpose, challenge.userId || null, challenge.email, challenge.codeHash, challenge.payload ? JSON.stringify(challenge.payload) : null, challenge.expiresAt, challenge.createdAt);
    });
    return challenge;
  }

  getEmailChallenge(challengeId) {
    return rowEmailChallenge(this.sqlite.prepare('SELECT * FROM email_challenges WHERE id=?').get(challengeId));
  }

  latestPendingEmailChallenge(purpose, email) {
    return rowEmailChallenge(this.sqlite.prepare('SELECT * FROM email_challenges WHERE purpose=? AND email=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1').get(purpose, email));
  }

  incrementEmailChallengeAttempts(challengeId, consume = false) {
    this.sqlite.prepare(`UPDATE email_challenges SET attempt_count=attempt_count+1${consume ? ', consumed_at=COALESCE(consumed_at, ?)' : ''} WHERE id=?`).run(...(consume ? [new Date().toISOString(), challengeId] : [challengeId]));
  }

  consumeEmailChallenge(challengeId, consumedAt = new Date().toISOString()) {
    return this.sqlite.prepare('UPDATE email_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(consumedAt, challengeId).changes > 0;
  }

  deleteEmailChallenge(challengeId) {
    this.sqlite.prepare('DELETE FROM email_challenges WHERE id=?').run(challengeId);
  }

  cleanupEmailChallenges(nowMs = Date.now()) {
    const now = new Date(nowMs).toISOString();
    const consumedCutoff = new Date(nowMs - 24 * 60 * 60_000).toISOString();
    return this.sqlite.prepare('DELETE FROM email_challenges WHERE expires_at<? OR (consumed_at IS NOT NULL AND consumed_at<?)').run(now, consumedCutoff).changes;
  }

  updateLastActiveAt(userId, lastActiveAt) {
    this.sqlite.prepare('UPDATE users SET last_active_at=? WHERE id=?').run(lastActiveAt, userId);
  }

  isMember(userId, conversationId) {
    return Boolean(this.sqlite.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND conversation_id = ?').get(userId, conversationId));
  }

  memberIds(conversationId) {
    return this.sqlite.prepare('SELECT user_id FROM memberships WHERE conversation_id = ?').all(conversationId).map((row) => row.user_id);
  }

  memberRoles(conversationId) {
    return Object.fromEntries(this.sqlite.prepare('SELECT user_id, role FROM memberships WHERE conversation_id = ?').all(conversationId).map((row) => [row.user_id, row.role || 'member']));
  }

  membershipRole(userId, conversationId) {
    return this.sqlite.prepare('SELECT role FROM memberships WHERE user_id = ? AND conversation_id = ?').get(userId, conversationId)?.role || null;
  }

  isGroupAdmin(userId, conversationId) {
    return ['owner', 'admin'].includes(this.membershipRole(userId, conversationId));
  }

  members(conversationId) {
    return this.sqlite.prepare("SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.conversation_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at").all(conversationId).map(rowUser);
  }

  insertConversation(conversation) {
    this.sqlite.prepare('INSERT INTO conversations(id,kind,title,avatar_url,created_by,created_at) VALUES(?,?,?,?,?,?)').run(conversation.id, conversation.kind, conversation.title || '', conversation.avatarDataUrl || '', conversation.createdBy, conversation.createdAt);
  }

  insertMembership(membership) {
    this.sqlite.prepare('INSERT OR IGNORE INTO memberships(conversation_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(membership.conversationId, membership.userId, membership.role || 'member', membership.joinedAt);
  }

  createConversation(conversation, userIds) {
    this.transaction(() => {
      this.insertConversation(conversation);
      const joinedAt = new Date().toISOString();
      for (const userId of userIds) this.insertMembership({ conversationId: conversation.id, userId, role: conversation.kind === 'group' && userId === conversation.createdBy ? 'owner' : 'member', joinedAt });
    });
  }

  addMembers(conversationId, userIds) {
    const joinedAt = new Date().toISOString();
    this.transaction(() => {
      for (const userId of userIds) this.insertMembership({ conversationId, userId, role: 'member', joinedAt });
    });
  }

  removeMember(conversationId, userId) {
    return this.sqlite.prepare('DELETE FROM memberships WHERE conversation_id=? AND user_id=?').run(conversationId, userId).changes > 0;
  }

  setMemberRole(conversationId, userId, role) {
    return this.sqlite.prepare("UPDATE memberships SET role=? WHERE conversation_id=? AND user_id=? AND role!='owner'").run(role, conversationId, userId).changes > 0;
  }

  async setConversationDetails(conversationId, title, avatarDataUrl) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;
    this.sqlite.prepare('UPDATE conversations SET title=?, avatar_url=? WHERE id=?').run(title, avatarDataUrl, conversationId);
    const previousFileName = conversation.avatarDataUrl?.startsWith('/uploads/') ? conversation.avatarDataUrl.slice('/uploads/'.length) : '';
    const nextFileName = avatarDataUrl?.startsWith('/uploads/') ? avatarDataUrl.slice('/uploads/'.length) : '';
    if (previousFileName && previousFileName !== nextFileName) {
      this.sqlite.prepare("DELETE FROM uploads WHERE file_name=? AND purpose='conversation'").run(previousFileName);
      await unlink(join(this.paths.uploadsPath, previousFileName)).catch(() => undefined);
    }
    return this.getConversation(conversationId);
  }

  async deleteConversation(conversationId) {
    const conversation = this.getConversation(conversationId);
    const avatarFileName = conversation?.avatarDataUrl?.startsWith('/uploads/') ? conversation.avatarDataUrl.slice('/uploads/'.length) : '';
    const uploads = this.sqlite.prepare('SELECT file_name FROM uploads WHERE attached_message_id IN (SELECT id FROM messages WHERE conversation_id=?)').all(conversationId);
    const deleted = this.transaction(() => {
      this.sqlite.prepare('DELETE FROM uploads WHERE attached_message_id IN (SELECT id FROM messages WHERE conversation_id=?)').run(conversationId);
      if (avatarFileName) this.sqlite.prepare("DELETE FROM uploads WHERE file_name=? AND purpose='conversation'").run(avatarFileName);
      return this.sqlite.prepare('DELETE FROM conversations WHERE id=?').run(conversationId).changes > 0;
    });
    if (deleted) await Promise.all([...new Set([...uploads.map((row) => row.file_name), avatarFileName].filter(Boolean))].map((fileName) => unlink(join(this.paths.uploadsPath, fileName)).catch(() => undefined)));
    return deleted;
  }

  getConversation(conversationId) {
    return rowConversation(this.sqlite.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId));
  }

  listConversations(userId) {
    return this.sqlite
      .prepare(`SELECT c.* FROM conversations c JOIN memberships m ON m.conversation_id=c.id WHERE m.user_id=?
        ORDER BY COALESCE((SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC, rowid DESC LIMIT 1), c.created_at) DESC`)
      .all(userId)
      .map(rowConversation);
  }

  findDirectConversation(firstUserId, secondUserId) {
    return rowConversation(
      this.sqlite
        .prepare(`SELECT c.* FROM conversations c
          JOIN memberships a ON a.conversation_id=c.id AND a.user_id=?
          JOIN memberships b ON b.conversation_id=c.id AND b.user_id=?
          WHERE c.kind='direct' AND (SELECT COUNT(*) FROM memberships WHERE conversation_id=c.id)=2 LIMIT 1`)
        .get(firstUserId, secondUserId),
    );
  }

  findSavedConversation(userId) {
    return rowConversation(this.sqlite.prepare("SELECT * FROM conversations WHERE kind='saved' AND created_by=? LIMIT 1").get(userId));
  }

  insertMessage(message) {
    this.transaction(() => {
      this.sqlite
        .prepare(`INSERT INTO messages(id,conversation_id,author_id,kind,content,attachment_json,reply_to_id,forward_json,call_json,friend_request_json,client_id,created_at,sent_at,edited_at,pinned_at,pinned_by_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(message.id, message.conversationId, message.authorId, message.kind || 'user', message.content || '', message.attachment ? JSON.stringify(message.attachment) : null, message.replyToId || null, message.forwardedFrom ? JSON.stringify(message.forwardedFrom) : null, message.call ? JSON.stringify(message.call) : null, message.friendRequest ? JSON.stringify(message.friendRequest) : null, message.clientId || null, message.createdAt, message.sentAt || message.createdAt, message.editedAt || null, message.pinnedAt || null, message.pinnedById || null);
      if (message.attachment?.url?.startsWith('/uploads/')) this.sqlite.prepare("UPDATE uploads SET attached_message_id=?, purpose='message' WHERE file_name=?").run(message.id, message.attachment.url.slice('/uploads/'.length));
    });
  }

  insertMessageIdempotent(message) {
    try {
      this.insertMessage(message);
      return { message, created: true };
    } catch (error) {
      const existing = message.clientId ? this.getMessageByClientId(message.authorId, message.clientId) : null;
      if (existing) return { message: existing, created: false };
      throw error;
    }
  }

  updateMessage(message) {
    this.sqlite.prepare('UPDATE messages SET content=?, edited_at=? WHERE id=? AND conversation_id=?').run(message.content, message.editedAt || null, message.id, message.conversationId);
  }

  setMessagePinned(messageId, conversationId, pinnedById, pinnedAt) {
    const result = this.sqlite
      .prepare('UPDATE messages SET pinned_at=?, pinned_by_id=? WHERE id=? AND conversation_id=?')
      .run(pinnedAt || null, pinnedAt ? pinnedById : null, messageId, conversationId);
    return result.changes ? this.getMessage(messageId, conversationId) : null;
  }

  hideMessage(messageId, conversationId, userId, deletedAt = new Date().toISOString()) {
    if (!this.getMessage(messageId, conversationId)) return false;
    this.sqlite.prepare('INSERT OR REPLACE INTO message_deletions(message_id,user_id,deleted_at) VALUES(?,?,?)').run(messageId, userId, deletedAt);
    return true;
  }

  hideMessageForEveryone(messageId, conversationId, deletedAt = new Date().toISOString()) {
    if (!this.getMessage(messageId, conversationId)) return [];
    const memberIds = this.memberIds(conversationId);
    this.transaction(() => {
      const hide = this.sqlite.prepare('INSERT OR REPLACE INTO message_deletions(message_id,user_id,deleted_at) VALUES(?,?,?)');
      memberIds.forEach((userId) => hide.run(messageId, userId, deletedAt));
    });
    return memberIds;
  }

  updatePendingFriendRequest(conversationId, requestedBy, status) {
    const rows = this.sqlite.prepare("SELECT * FROM messages WHERE conversation_id=? AND kind='friend_request' ORDER BY created_at DESC, rowid DESC").all(conversationId);
    const row = rows.find((item) => {
      const request = jsonParse(item.friend_request_json);
      return request?.requestedBy === requestedBy && request.status === 'pending';
    });
    if (!row) return null;
    const friendRequest = { ...jsonParse(row.friend_request_json), status, respondedAt: new Date().toISOString() };
    this.sqlite.prepare('UPDATE messages SET friend_request_json=? WHERE id=?').run(JSON.stringify(friendRequest), row.id);
    return rowMessage({ ...row, friend_request_json: JSON.stringify(friendRequest) });
  }

  getMessage(messageId, conversationId) {
    return rowMessage(this.sqlite.prepare('SELECT * FROM messages WHERE id=? AND conversation_id=?').get(messageId, conversationId));
  }

  isMessageVisibleTo(messageId, conversationId, userId) {
    return Boolean(this.sqlite.prepare(`SELECT 1 FROM messages
      WHERE id=? AND conversation_id=?
        AND NOT EXISTS (SELECT 1 FROM message_deletions hidden WHERE hidden.message_id=messages.id AND hidden.user_id=?)`).get(messageId, conversationId, userId));
  }

  getMessageByClientId(authorId, clientId) {
    return rowMessage(this.sqlite.prepare('SELECT * FROM messages WHERE author_id=? AND client_id=?').get(authorId, clientId));
  }

  lastMessage(conversationId, viewerId) {
    const hiddenFilter = viewerId ? ' AND NOT EXISTS (SELECT 1 FROM message_deletions hidden WHERE hidden.message_id=messages.id AND hidden.user_id=?)' : '';
    return rowMessage(
      this.sqlite
        .prepare(`SELECT * FROM messages WHERE conversation_id=?${hiddenFilter} ORDER BY created_at DESC, rowid DESC LIMIT 1`)
        .get(...(viewerId ? [conversationId, viewerId] : [conversationId])),
    );
  }

  messages(conversationId, limit = 200) {
    return this.sqlite
      .prepare('SELECT * FROM (SELECT messages.*, rowid AS sequence FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, sequence')
      .all(conversationId, limit)
      .map(rowMessage);
  }

  messagePage(conversationId, { limit = 80, before, viewerId } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 80));
    const conditions = ['messages.conversation_id=?'];
    const parameters = [conversationId];
    if (viewerId) {
      conditions.push('NOT EXISTS (SELECT 1 FROM message_deletions hidden WHERE hidden.message_id=messages.id AND hidden.user_id=?)');
      parameters.push(viewerId);
    }
    if (before) {
      conditions.push('(messages.created_at<? OR (messages.created_at=? AND messages.id<?))');
      parameters.push(before.createdAt, before.createdAt, before.id);
    }
    parameters.push(safeLimit + 1);
    const rows = this.sqlite.prepare(`SELECT messages.* FROM messages WHERE ${conditions.join(' AND ')} ORDER BY messages.created_at DESC, messages.id DESC LIMIT ?`).all(...parameters);
    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit);
    const oldest = page.at(-1);
    return {
      messages: page.reverse().map(rowMessage),
      hasMore,
      nextCursor: hasMore && oldest ? Buffer.from(JSON.stringify({ v: 1, createdAt: oldest.created_at, id: oldest.id })).toString('base64url') : null,
    };
  }

  messageContext(conversationId, messageId, { radius = 40, viewerId } = {}) {
    const target = this.sqlite.prepare('SELECT id, created_at FROM messages WHERE id=? AND conversation_id=?').get(messageId, conversationId);
    if (!target || (viewerId && !this.isMessageVisibleTo(messageId, conversationId, viewerId))) return null;
    const hiddenFilter = viewerId
      ? ' AND NOT EXISTS (SELECT 1 FROM message_deletions hidden WHERE hidden.message_id=messages.id AND hidden.user_id=?)'
      : '';
    const safeRadius = Math.max(1, Math.min(100, Number(radius) || 40));
    const beforeParameters = viewerId
      ? [conversationId, target.created_at, target.created_at, target.id, viewerId, safeRadius + 1]
      : [conversationId, target.created_at, target.created_at, target.id, safeRadius + 1];
    const afterParameters = viewerId
      ? [conversationId, target.created_at, target.created_at, target.id, viewerId, safeRadius]
      : [conversationId, target.created_at, target.created_at, target.id, safeRadius];
    const before = this.sqlite.prepare(`SELECT messages.* FROM messages
      WHERE conversation_id=? AND (created_at<? OR (created_at=? AND id<=?))${hiddenFilter}
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(...beforeParameters).reverse();
    const after = this.sqlite.prepare(`SELECT messages.* FROM messages
      WHERE conversation_id=? AND (created_at>? OR (created_at=? AND id>?))${hiddenFilter}
      ORDER BY created_at, id LIMIT ?`).all(...afterParameters);
    return [...before, ...after].map(rowMessage);
  }

  readStates(conversationId) {
    return this.sqlite.prepare('SELECT user_id, last_read_at FROM memberships WHERE conversation_id=? AND last_read_at IS NOT NULL').all(conversationId).map((row) => ({ userId: row.user_id, readAt: row.last_read_at }));
  }

  voiceListens(messageId) {
    return this.sqlite.prepare('SELECT user_id, listened_at FROM voice_message_listens WHERE message_id=? ORDER BY listened_at').all(messageId).map((row) => ({ userId: row.user_id, listenedAt: row.listened_at }));
  }

  markVoiceListened(messageId, userId, listenedAt) {
    return this.sqlite.prepare('INSERT OR IGNORE INTO voice_message_listens(message_id,user_id,listened_at) VALUES(?,?,?)').run(messageId, userId, listenedAt).changes > 0;
  }

  unreadCount(conversationId, userId) {
    const row = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM messages m
      JOIN memberships membership ON membership.conversation_id=m.conversation_id AND membership.user_id=?
      WHERE m.conversation_id=? AND m.author_id!=? AND (membership.last_read_at IS NULL OR m.created_at>membership.last_read_at)`).get(userId, conversationId, userId);
    return Number(row?.count || 0);
  }

  markRead(conversationId, userId, throughMessageId, readAt) {
    const target = this.sqlite.prepare('SELECT created_at FROM messages WHERE id=? AND conversation_id=?').get(throughMessageId, conversationId);
    if (!target) return null;
    const membership = this.sqlite.prepare('SELECT last_read_message_id FROM memberships WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
    const previous = membership?.last_read_message_id ? this.sqlite.prepare('SELECT created_at FROM messages WHERE id=? AND conversation_id=?').get(membership.last_read_message_id, conversationId) : null;
    const rows = this.sqlite
      .prepare(`SELECT id FROM messages WHERE conversation_id=? AND author_id!=? AND created_at<=? AND (? IS NULL OR created_at>?) ORDER BY created_at`)
      .all(conversationId, userId, target.created_at, previous?.created_at || null, previous?.created_at || null);
    this.sqlite.prepare('UPDATE memberships SET last_read_message_id=?, last_read_at=? WHERE conversation_id=? AND user_id=?').run(throughMessageId, readAt, conversationId, userId);
    return rows.map((row) => row.id);
  }
}
