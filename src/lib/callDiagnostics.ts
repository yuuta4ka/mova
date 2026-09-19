export interface CallDiagnosticPeerSnapshot {
  connectionState?: string;
  iceConnectionState?: string;
  candidateType?: string;
  protocol?: string;
  roundTripTimeMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
  outboundAudioBitrateKbps?: number;
  inboundAudioBitrateKbps?: number;
  outboundVideoBitrateKbps?: number;
  inboundVideoBitrateKbps?: number;
  outboundVideoFramesPerSecond?: number;
  inboundVideoFramesPerSecond?: number;
  framesEncoded?: number;
  framesDecoded?: number;
  framesDropped?: number;
  freezeCount?: number;
  totalFreezesDurationMs?: number;
  audioCodec?: string;
  videoCodec?: string;
  screenQualityLimitationReason?: string;
  quality?: 'good' | 'fair' | 'poor';
  recovering?: boolean;
  updatedAt?: number;
}

export interface CallDiagnosticReport {
  schemaVersion: 1;
  generatedAt: string;
  call: {
    state: string;
    startedAt: string | null;
    durationSeconds: number | null;
    peerCount: number;
    worstQuality: 'good' | 'fair' | 'poor' | 'unknown';
    turnUsed: boolean;
    failure: string | null;
  };
  environment: {
    client: 'desktop' | 'browser' | 'standalone';
    online: boolean;
    language: string;
  };
  peers: Array<CallDiagnosticPeerSnapshot & { peer: string }>;
  privacy: {
    excluded: string[];
  };
}

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function buildCallDiagnosticReport({
  state,
  startedAt,
  diagnostics,
  error = '',
  now = Date.now(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  online = typeof navigator === 'undefined' ? true : navigator.onLine,
  language = typeof navigator === 'undefined' ? 'unknown' : navigator.language,
}: {
  state: string;
  startedAt: string | null;
  diagnostics: Record<string, CallDiagnosticPeerSnapshot>;
  error?: string;
  now?: number;
  userAgent?: string;
  online?: boolean;
  language?: string;
}): CallDiagnosticReport {
  const sourcePeers = Object.values(diagnostics);
  const qualityOrder = { good: 0, fair: 1, poor: 2 } as const;
  const qualities = sourcePeers.map((peer) => peer.quality).filter((quality): quality is keyof typeof qualityOrder => Boolean(quality));
  const worstQuality = qualities.length ? qualities.reduce((worst, quality) => qualityOrder[quality] > qualityOrder[worst] ? quality : worst, 'good') : 'unknown';
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const allowedKeys: Array<keyof CallDiagnosticPeerSnapshot> = [
    'connectionState', 'iceConnectionState', 'candidateType', 'protocol', 'roundTripTimeMs', 'jitterMs', 'packetLossPercent',
    'outboundAudioBitrateKbps', 'inboundAudioBitrateKbps', 'outboundVideoBitrateKbps', 'inboundVideoBitrateKbps',
    'outboundVideoFramesPerSecond', 'inboundVideoFramesPerSecond', 'framesEncoded', 'framesDecoded', 'framesDropped',
    'freezeCount', 'totalFreezesDurationMs', 'audioCodec', 'videoCodec', 'screenQualityLimitationReason', 'quality', 'recovering', 'updatedAt',
  ];
  const peers = sourcePeers.map((source, index) => {
    const snapshot: CallDiagnosticPeerSnapshot & { peer: string } = { peer: `peer-${index + 1}` };
    for (const key of allowedKeys) {
      const value = source[key];
      if (value !== undefined) (snapshot as unknown as Record<string, unknown>)[key] = typeof value === 'number' ? finite(value) : value;
    }
    return snapshot;
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    call: {
      state,
      startedAt,
      durationSeconds: Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((now - startedAtMs) / 1000)) : null,
      peerCount: peers.length,
      worstQuality,
      turnUsed: sourcePeers.some((peer) => peer.candidateType?.includes('relay')),
      failure: !error ? null : error.includes('Выбранный микрофон недоступен') ? 'microphone-unavailable' : error.includes('Нет доступа к микрофону') ? 'microphone-permission' : error.includes('Микрофон занят') ? 'microphone-busy' : 'other',
    },
    environment: {
      client: userAgent.includes('MovaDesktop/') ? 'desktop' : userAgent.includes('Mobile') || userAgent.includes('Standalone') ? 'standalone' : 'browser',
      online,
      language,
    },
    peers,
    privacy: {
      excluded: ['conversation IDs', 'user IDs', 'IP addresses', 'ICE candidate addresses', 'device names', 'media contents'],
    },
  };
}

export async function copyDiagnosticReport(report: CallDiagnosticReport) {
  const text = JSON.stringify(report, null, 2);
  try {
    if (window.movaDesktopShell?.writeClipboardText && await window.movaDesktopShell.writeClipboardText(text)) return 'copied' as const;
  } catch { /* Try the browser clipboard on older desktop shells. */ }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied' as const;
    }
  } catch { /* Permission denial must not hide the report. */ }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  try {
    textarea.select();
    if (document.execCommand?.('copy')) return 'copied' as const;
  } catch { /* Download is available even without clipboard permission. */ }
  finally { textarea.remove(); }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mova-call-report.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded' as const;
}
