import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

export const STATISTICS_INTERVAL_MS = 15 * 60_000;

// A separate read-only WAL connection keeps full-history scans off the API thread.
export function collectStatistics(sqlitePath) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 1000; BEGIN');
    const { users } = db.prepare('SELECT COUNT(*) AS users FROM users').get();
    const { messages, callSeconds } = db.prepare(`
      SELECT COALESCE(SUM(kind = 'user'), 0) AS messages,
        COALESCE(SUM(CASE WHEN kind = 'call' AND json_valid(call_json) THEN
          CASE WHEN json_extract(call_json, '$.status') = 'completed'
            AND json_type(call_json, '$.durationSeconds') IN ('integer', 'real')
            AND json_extract(call_json, '$.durationSeconds') >= 0
          THEN CAST(json_extract(call_json, '$.durationSeconds') AS INTEGER) ELSE 0 END
        ELSE 0 END), 0) AS callSeconds
      FROM messages
    `).get();
    db.exec('COMMIT');
    return { users, messages, callSeconds, updatedAt: new Date().toISOString() };
  } finally {
    db.close();
  }
}

if (!isMainThread) parentPort.postMessage(collectStatistics(workerData.sqlitePath));

export class PublicStatistics {
  snapshot = null;
  worker = null;
  timer = null;
  timeout = null;

  constructor(sqlitePath, onError = () => {}) {
    this.sqlitePath = sqlitePath;
    this.onError = onError;
  }

  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), STATISTICS_INTERVAL_MS);
    this.timer.unref();
  }

  refresh() {
    if (this.worker) return; // Never queue work because of traffic or a slow scan.
    const worker = new Worker(new URL(import.meta.url), { workerData: { sqlitePath: this.sqlitePath } });
    this.worker = worker;
    this.timeout = setTimeout(() => {
      this.onError(new Error('Public statistics scan timed out'));
      void worker.terminate();
    }, 60_000);
    this.timeout.unref();
    worker.once('message', (snapshot) => { this.snapshot = Object.freeze(snapshot); });
    worker.once('error', (error) => this.onError(error));
    worker.once('exit', () => {
      clearTimeout(this.timeout);
      this.timeout = null;
      this.worker = null;
    });
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.timeout);
    this.timer = null;
    return this.worker?.terminate();
  }
}
