import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCallDiagnosticReport, copyDiagnosticReport } from './callDiagnostics';

describe('call diagnostic reports', () => {
  afterEach(() => { delete window.movaDesktopShell; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('creates a privacy-safe anonymized report with quality summary', () => {
    const report = buildCallDiagnosticReport({
      state: 'connected',
      startedAt: '2026-08-13T10:00:00.000Z',
      now: new Date('2026-08-13T10:01:05.000Z').getTime(),
      userAgent: 'MovaDesktop/0.1.6',
      online: true,
      language: 'ru',
      diagnostics: {
        'real-user-id': { quality: 'fair', candidateType: 'host → relay', roundTripTimeMs: 180, audioCodec: 'audio/opus', outboundAudioBitrateKbps: 48 },
      },
    });
    expect(report).toMatchObject({ call: { durationSeconds: 65, peerCount: 1, worstQuality: 'fair', turnUsed: true }, environment: { client: 'desktop' }, peers: [{ peer: 'peer-1', audioCodec: 'audio/opus' }] });
    expect(JSON.stringify(report)).not.toContain('real-user-id');
    expect(report.privacy.excluded).toContain('IP addresses');
  });

  it('copies formatted JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const report = buildCallDiagnosticReport({ state: 'connected', startedAt: null, diagnostics: {} });
    await copyDiagnosticReport(report);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"schemaVersion": 1'));
  });
  it('uses the native desktop clipboard when browser permission is denied', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(true);
    window.movaDesktopShell = { writeClipboardText } as unknown as NonNullable<Window['movaDesktopShell']>;
    const report = buildCallDiagnosticReport({ state: 'available', startedAt: null, diagnostics: {} });
    expect(await copyDiagnosticReport(report)).toBe('copied');
    expect(writeClipboardText).toHaveBeenCalledWith(expect.stringContaining('"state": "available"'));
  });
  it('downloads the report when both clipboard APIs are unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    const createObjectURL = vi.fn().mockReturnValue('blob:report');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const report = buildCallDiagnosticReport({ state: 'available', startedAt: null, diagnostics: {} });
    expect(await copyDiagnosticReport(report)).toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(document.querySelector('textarea')).toBeNull();
  });

});
