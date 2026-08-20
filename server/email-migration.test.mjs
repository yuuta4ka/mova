// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.mjs';

const cleanup = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('email verification migration', () => {
  it('keeps accounts created before email verification unverified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mova-email-migration-'));
    cleanup.push(root);
    const dataPath = join(root, 'data');
    await mkdir(dataPath, { recursive: true });
    const sqlitePath = join(dataPath, 'db.sqlite');
    const legacy = new DatabaseSync(sqlitePath);
    legacy.exec(`
      CREATE TABLE users (
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
    `);
    legacy.prepare('INSERT INTO users(id,name,email,handle,color,password_hash,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('legacy-user', 'Старый пользователь', 'legacy@mova.test', '@legacy', '#74DCCB', 'salt:hash', '2026-08-01T00:00:00.000Z');
    legacy.close();

    const database = await openDatabase({
      sqlitePath,
      legacyJsonPath: join(dataPath, 'db.json'),
      uploadsPath: join(dataPath, 'uploads'),
    });
    const user = database.getUserById('legacy-user');
    expect(user.emailVerifiedAt).toBeUndefined();

    user.bio = 'Профиль обновлён';
    database.updateUser(user);
    expect(database.getUserById('legacy-user').emailVerifiedAt).toBeUndefined();
    database.close();
  });

  it('repairs the early migration without unconfirming genuinely verified or new accounts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mova-email-repair-'));
    cleanup.push(root);
    const dataPath = join(root, 'data');
    await mkdir(dataPath, { recursive: true });
    const sqlitePath = join(dataPath, 'db.sqlite');
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
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
    `);
    const insert = sqlite.prepare('INSERT INTO users(id,name,email,handle,color,password_hash,email_verified_at,created_at) VALUES(?,?,?,?,?,?,?,?)');
    insert.run('auto-verified-legacy', 'Старый пользователь', 'old@mova.test', '@old', '#74DCCB', 'salt:hash', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert.run('confirmed-legacy', 'Подтвердивший пользователь', 'confirmed@mova.test', '@confirmed', '#74DCCB', 'salt:hash', '2026-08-20T19:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert.run('new-user', 'Новый пользователь', 'new@mova.test', '@new', '#74DCCB', 'salt:hash', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
    sqlite.close();

    const paths = {
      sqlitePath,
      legacyJsonPath: join(dataPath, 'db.json'),
      uploadsPath: join(dataPath, 'uploads'),
    };
    const database = await openDatabase(paths);
    expect(database.getUserById('auto-verified-legacy').emailVerifiedAt).toBeUndefined();
    expect(database.getUserById('confirmed-legacy').emailVerifiedAt).toBe('2026-08-20T19:00:00.000Z');
    expect(database.getUserById('new-user').emailVerifiedAt).toBe('2026-08-21T00:00:00.000Z');

    database.sqlite.prepare('UPDATE users SET email_verified_at=created_at WHERE id=?').run('auto-verified-legacy');
    database.close();
    const reopened = await openDatabase(paths);
    expect(reopened.getUserById('auto-verified-legacy').emailVerifiedAt).toBe('2026-08-01T00:00:00.000Z');
    reopened.close();
  });
});
