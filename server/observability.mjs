import { randomBytes } from 'node:crypto';

const durationBucketsMs = [25, 50, 100, 250, 500, 1_000, 2_500, 5_000];
const sensitiveKey = /authorization|cookie|credential|password|secret|token|candidate|address|email/i;

const labelValue = (value) => String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
const labels = (values) => {
  const entries = Object.entries(values);
  return entries.length ? `{${entries.map(([key, value]) => `${key}="${labelValue(value)}"`).join(',')}}` : '';
};

export function requestId(value) {
  const candidate = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{8,100}$/.test(candidate) ? candidate : randomBytes(12).toString('hex');
}

export function routeName(pathname) {
  if (pathname === '/metrics') return '/metrics';
  if (pathname.startsWith('/uploads/')) return '/uploads/:file';
  if (!pathname.startsWith('/api/')) return pathname === '/' ? '/' : '/static';
  return pathname
    .replace(/\/api\/conversations\/[^/]+\/messages\/[^/]+\/(pin|forward|listened|context)$/, '/api/conversations/:conversationId/messages/:messageId/$1')
    .replace(/\/api\/conversations\/[^/]+\/messages\/[^/]+$/, '/api/conversations/:conversationId/messages/:messageId')
    .replace(/\/api\/conversations\/[^/]+\/members\/[^/]+$/, '/api/conversations/:conversationId/members/:userId')
    .replace(/\/api\/conversations\/[^/]+\/(messages|read|members)$/, '/api/conversations/:conversationId/$1')
    .replace(/\/api\/conversations\/[^/]+$/, '/api/conversations/:conversationId')
    .replace(/\/api\/(friends|blocks)\/[^/]+(\/reject)?$/, '/api/$1/:userId$2');
}

export function redact(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 8).join('\n') };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? '[redacted]' : redact(item, depth + 1)]));
}

export function createLogger({ service = 'mova-api', instanceId = '', writer = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const write = (level, event, fields = {}) => writer(JSON.stringify({ timestamp: new Date().toISOString(), level, service, instanceId, event, ...redact(fields) }));
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

export class MovaMetrics {
  constructor() {
    this.http = new Map();
    this.ws = new Map();
    this.rejections = new Map();
    this.backups = { success: 0, failed: 0, lastSuccessTimestamp: 0 };
  }

  recordHttp({ method, route, status, durationMs }) {
    const key = JSON.stringify([method, route, String(status)]);
    const item = this.http.get(key) || { method, route, status: String(status), count: 0, sum: 0, buckets: durationBucketsMs.map(() => 0) };
    item.count += 1;
    item.sum += durationMs;
    durationBucketsMs.forEach((bucket, index) => {
      if (durationMs <= bucket) item.buckets[index] += 1;
    });
    this.http.set(key, item);
  }

  recordWebSocket(type) {
    const normalized = /^[a-z][a-z0-9:_-]{0,49}$/i.test(String(type || '')) ? String(type) : 'unknown';
    this.ws.set(normalized, (this.ws.get(normalized) || 0) + 1);
  }

  recordRejection(kind) {
    const normalized = /^[a-z][a-z0-9:_-]{0,49}$/i.test(String(kind || '')) ? String(kind) : 'unknown';
    this.rejections.set(normalized, (this.rejections.get(normalized) || 0) + 1);
  }

  recordBackup(success) {
    if (success) {
      this.backups.success += 1;
      this.backups.lastSuccessTimestamp = Date.now() / 1000;
    } else this.backups.failed += 1;
  }

  render(gauges = {}) {
    const httpItems = [...this.http.values()];
    const httpRequests = httpItems.reduce((total, item) => total + item.count, 0);
    const httpErrors = httpItems.reduce((total, item) => total + (Number(item.status) >= 500 ? item.count : 0), 0);
    const httpDuration = httpItems.reduce((total, item) => total + item.sum, 0);
    const rejected = [...this.rejections.values()].reduce((total, count) => total + count, 0);
    const websocketMessages = [...this.ws.values()].reduce((total, count) => total + count, 0);
    const lines = [
      '# HELP mova_http_requests_total HTTP responses by normalized route and status.',
      '# TYPE mova_http_requests_total counter',
      `mova_http_requests_total ${httpRequests}`,
      `mova_http_errors_total ${httpErrors}`,
      `mova_http_rejected_total ${rejected}`,
      `mova_http_request_duration_average_ms ${httpRequests ? (httpDuration / httpRequests).toFixed(3) : 0}`,
      '# HELP mova_http_request_duration_ms Request duration histogram.',
      '# TYPE mova_http_request_duration_ms histogram',
    ];
    for (const item of this.http.values()) {
      const base = { method: item.method, route: item.route, status: item.status };
      lines.push(`mova_http_requests_total${labels(base)} ${item.count}`);
      item.buckets.forEach((count, index) => lines.push(`mova_http_request_duration_ms_bucket${labels({ ...base, le: durationBucketsMs[index] })} ${count}`));
      lines.push(`mova_http_request_duration_ms_bucket${labels({ ...base, le: '+Inf' })} ${item.count}`);
      lines.push(`mova_http_request_duration_ms_sum${labels(base)} ${item.sum.toFixed(3)}`);
      lines.push(`mova_http_request_duration_ms_count${labels(base)} ${item.count}`);
    }
    lines.push('# HELP mova_websocket_messages_total Accepted WebSocket messages by event type.', '# TYPE mova_websocket_messages_total counter', `mova_websocket_messages_total ${websocketMessages}`);
    for (const [type, count] of this.ws) lines.push(`mova_websocket_messages_total${labels({ type })} ${count}`);
    lines.push('# HELP mova_rejections_total Rejected operations by kind.', '# TYPE mova_rejections_total counter');
    for (const [kind, count] of this.rejections) lines.push(`mova_rejections_total${labels({ kind })} ${count}`);
    lines.push(
      '# HELP mova_backups_total Backup attempts by result.',
      '# TYPE mova_backups_total counter',
      `mova_backups_total${labels({ result: 'success' })} ${this.backups.success}`,
      `mova_backups_total${labels({ result: 'failed' })} ${this.backups.failed}`,
      '# HELP mova_backup_last_success_timestamp_seconds Last successful backup time.',
      '# TYPE mova_backup_last_success_timestamp_seconds gauge',
      `mova_backup_last_success_timestamp_seconds ${this.backups.lastSuccessTimestamp}`,
    );
    for (const [name, value] of Object.entries(gauges)) {
      if (!/^mova_[a-z0-9_]+$/.test(name) || !Number.isFinite(Number(value))) continue;
      lines.push(`# TYPE ${name} gauge`, `${name} ${Number(value)}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
