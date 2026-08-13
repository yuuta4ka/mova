import { describe, expect, it } from 'vitest';
import { MovaMetrics, createLogger, redact, requestId, routeName } from './observability.mjs';

describe('server observability', () => {
  it('normalizes high-cardinality paths and untrusted request ids', () => {
    expect(routeName('/api/conversations/chat-123/messages/message-456')).toBe('/api/conversations/:conversationId/messages/:messageId');
    expect(routeName('/uploads/private-file.png')).toBe('/uploads/:file');
    expect(requestId('valid-request-123')).toBe('valid-request-123');
    expect(requestId('bad id')).toMatch(/^[a-f0-9]{24}$/);
  });

  it('redacts credentials and structured logger fields', () => {
    expect(redact({ token: 'secret', nested: { email: 'user@example.test', safe: 4 } })).toEqual({ token: '[redacted]', nested: { email: '[redacted]', safe: 4 } });
    const lines = [];
    const logger = createLogger({ instanceId: 'instance-test', writer: (line) => lines.push(JSON.parse(line)) });
    logger.error('request.failed', { authorization: 'Bearer secret', error: new Error('boom') });
    expect(lines[0]).toMatchObject({ level: 'error', event: 'request.failed', instanceId: 'instance-test', authorization: '[redacted]', error: { message: 'boom' } });
  });

  it('renders labeled counters, cumulative duration buckets, gauges and backup status', () => {
    const metrics = new MovaMetrics();
    metrics.recordHttp({ method: 'GET', route: '/api/me', status: 200, durationMs: 40 });
    metrics.recordHttp({ method: 'GET', route: '/api/me', status: 200, durationMs: 300 });
    metrics.recordWebSocket('voice:join');
    metrics.recordRejection('rate_limit');
    metrics.recordBackup(true);
    const output = metrics.render({ mova_websocket_connections: 2 });
    expect(output).toContain('mova_http_requests_total{method="GET",route="/api/me",status="200"} 2');
    expect(output).toContain('mova_http_request_duration_ms_bucket{method="GET",route="/api/me",status="200",le="50"} 1');
    expect(output).toContain('mova_http_request_duration_ms_bucket{method="GET",route="/api/me",status="200",le="500"} 2');
    expect(output).toContain('mova_websocket_messages_total{type="voice:join"} 1');
    expect(output).toContain('mova_websocket_connections 2');
  });
});
