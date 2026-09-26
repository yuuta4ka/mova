// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { collectStatistics, PublicStatistics } from './public-statistics.mjs';

let directory;
let db;
let service;
afterEach(async () => {
  await service?.stop();
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'mova-statistics-'));
  const path = join(directory, 'db.sqlite');
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id TEXT); CREATE TABLE messages(kind TEXT, call_json TEXT);");
  return path;
}

it('counts existing history, excluding service messages and malformed call durations', async () => {
  const path = await fixture();
  expect(collectStatistics(path)).toMatchObject({ users: 0, messages: 0, callSeconds: 0 });
  db.exec("INSERT INTO users VALUES ('old-user'), ('second-user'); INSERT INTO messages VALUES ('user', NULL), ('user', NULL), ('friend_request', NULL);");
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?)');
  for (const durationSeconds of [3600, 90, -30, '600', null]) {
    insert.run('call', JSON.stringify({ status: 'completed', durationSeconds, startedAt: '2025-01-01T00:00:00Z' }));
  }
  insert.run('call', '{broken');
  insert.run('call', JSON.stringify({ status: 'missed', durationSeconds: 100 }));
  expect(collectStatistics(path)).toMatchObject({ users: 2, messages: 2, callSeconds: 3690 });
});

it('serves one cached snapshot during writes, deduplicates scans and retains it on failure', async () => {
  const path = await fixture();
  const onError = vi.fn();
  service = new PublicStatistics(path, onError);
  service.start();
  const worker = service.worker;
  for (let i = 0; i < 100; i++) service.refresh();
  expect(service.worker).toBe(worker);
  await vi.waitFor(() => expect(service.snapshot?.messages).toBe(0));
  await vi.waitFor(() => expect(service.worker).toBeNull());
  const cached = service.snapshot;
  db.exec("INSERT INTO messages VALUES ('user', NULL), ('user', NULL), ('user', NULL)");
  for (let i = 0; i < 1000; i++) expect(service.snapshot).toBe(cached);
  service.refresh();
  await vi.waitFor(() => expect(service.snapshot?.messages).toBe(3));
  await vi.waitFor(() => expect(service.worker).toBeNull());
  db.exec('DROP TABLE messages');
  service.refresh();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  expect(service.snapshot.messages).toBe(3);
});
