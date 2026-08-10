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
};

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
    call: jsonParse(row.call_json),
    createdAt: row.created_at,
    sentAt: row.sent_at || row.created_at,
    editedAt: row.edited_at || undefined,
  };
}

function rowConversation(row) {
  return row
    ? {
        id: row.id,
        kind: row.kind,
        title: row.title || '',
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
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      call_json TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      edited_at TEXT
    );
    CREATE TABLE IF NOT EXISTS uploads (
      file_name TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      attached_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      purpose TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_cleanup ON uploads(purpose, created_at);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id);
  `);
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
      this.sqlite.prepare('INSERT INTO uploads(file_name,owner_id,created_at,purpose) VALUES(?,?,?,?)').run(fileName, ownerId, new Date().toISOString(), purpose);
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
      const upload = this.sqlite.prepare('SELECT owner_id, attached_message_id FROM uploads WHERE file_name=?').get(fileName);
      if (!upload || (ownerId && upload.owner_id && upload.owner_id !== ownerId) || upload.attached_message_id) throw Object.assign(new Error('Загрузка недоступна'), { statusCode: 403 });
      return {
        name: String(attachment.name || 'Файл').slice(0, 180),
        type: String(attachment.type || 'application/octet-stream').slice(0, 120),
        size: Number(attachment.size || 0),
        url: attachment.url,
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

  async cleanupOrphanUploads(maxAgeMs = 24 * 60 * 60_000) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = this.sqlite
      .prepare(`SELECT file_name FROM uploads WHERE created_at<? AND (
        (purpose='pending' AND attached_message_id IS NULL) OR
        (purpose='profile' AND NOT EXISTS (
          SELECT 1 FROM users WHERE avatar_url='/uploads/' || uploads.file_name OR banner_url='/uploads/' || uploads.file_name
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

  insertUser(user) {
    this.sqlite
      .prepare(`INSERT INTO users(id,name,email,handle,color,presence,dnd_until,bio,avatar_url,banner_url,activity_json,last_active_at,password_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(user.id, user.name, user.email, user.handle, user.color, user.presence || 'online', user.dndUntil || null, user.bio || '', user.avatarDataUrl || '', user.bannerDataUrl || '', user.activity ? JSON.stringify(user.activity) : null, user.lastActiveAt || null, user.passwordHash, user.createdAt);
  }

  updateUser(user) {
    this.sqlite
      .prepare(`UPDATE users SET name=?, email=?, handle=?, color=?, presence=?, dnd_until=?, bio=?, avatar_url=?, banner_url=?, activity_json=?, last_active_at=?, password_hash=? WHERE id=?`)
      .run(user.name, user.email, user.handle, user.color, user.presence, user.dndUntil || null, user.bio || '', user.avatarDataUrl || '', user.bannerDataUrl || '', user.activity ? JSON.stringify(user.activity) : null, user.lastActiveAt || null, user.passwordHash, user.id);
  }

  isMember(userId, conversationId) {
    return Boolean(this.sqlite.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND conversation_id = ?').get(userId, conversationId));
  }

  memberIds(conversationId) {
    return this.sqlite.prepare('SELECT user_id FROM memberships WHERE conversation_id = ?').all(conversationId).map((row) => row.user_id);
  }

  members(conversationId) {
    return this.sqlite.prepare('SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.conversation_id=? ORDER BY m.joined_at').all(conversationId).map(rowUser);
  }

  insertConversation(conversation) {
    this.sqlite.prepare('INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES(?,?,?,?,?)').run(conversation.id, conversation.kind, conversation.title || '', conversation.createdBy, conversation.createdAt);
  }

  insertMembership(membership) {
    this.sqlite.prepare('INSERT OR IGNORE INTO memberships(conversation_id,user_id,joined_at) VALUES(?,?,?)').run(membership.conversationId, membership.userId, membership.joinedAt);
  }

  createConversation(conversation, userIds) {
    this.transaction(() => {
      this.insertConversation(conversation);
      const joinedAt = new Date().toISOString();
      for (const userId of userIds) this.insertMembership({ conversationId: conversation.id, userId, joinedAt });
    });
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

  insertMessage(message) {
    this.transaction(() => {
      this.sqlite
        .prepare(`INSERT INTO messages(id,conversation_id,author_id,kind,content,attachment_json,reply_to_id,call_json,created_at,sent_at,edited_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(message.id, message.conversationId, message.authorId, message.kind || 'user', message.content || '', message.attachment ? JSON.stringify(message.attachment) : null, message.replyToId || null, message.call ? JSON.stringify(message.call) : null, message.createdAt, message.sentAt || message.createdAt, message.editedAt || null);
      if (message.attachment?.url?.startsWith('/uploads/')) this.sqlite.prepare("UPDATE uploads SET attached_message_id=?, purpose='message' WHERE file_name=?").run(message.id, message.attachment.url.slice('/uploads/'.length));
    });
  }

  updateMessage(message) {
    this.sqlite.prepare('UPDATE messages SET content=?, edited_at=? WHERE id=? AND conversation_id=?').run(message.content, message.editedAt || null, message.id, message.conversationId);
  }

  getMessage(messageId, conversationId) {
    return rowMessage(this.sqlite.prepare('SELECT * FROM messages WHERE id=? AND conversation_id=?').get(messageId, conversationId));
  }

  lastMessage(conversationId) {
    return rowMessage(this.sqlite.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(conversationId));
  }

  messages(conversationId, limit = 200) {
    return this.sqlite
      .prepare('SELECT * FROM (SELECT messages.*, rowid AS sequence FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, sequence')
      .all(conversationId, limit)
      .map(rowMessage);
  }

  readStates(conversationId) {
    return this.sqlite.prepare('SELECT user_id, last_read_at FROM memberships WHERE conversation_id=? AND last_read_at IS NOT NULL').all(conversationId).map((row) => ({ userId: row.user_id, readAt: row.last_read_at }));
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
