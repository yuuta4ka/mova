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
  now = Date.now(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  online = typeof navigator === 'undefined' ? true : navigator.onLine,
  language = typeof navigator === 'undefined' ? 'unknown' : navigator.language,
}: {
  state: string;
  startedAt: string | null;
  diagnostics: Record<string, CallDiagnosticPeerSnapshot>;
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
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}
