// Detect digital silence, not the absence of speech. Observe the capture stream
// before Mova's noise gate, and reset after suspended/background sampling gaps.
export function createMicrophoneSilenceDetector(timeoutMs = 12_000) {
  let silentSince: number | null = null;
  let previousSample: number | null = null;
  return (samples: Float32Array, now: number, enabled: boolean): boolean => {
    const interrupted = previousSample !== null && now - previousSample > 1_500;
    previousSample = now;
    const hasSignal = samples.some((sample) => Math.abs(sample) > 0.000001);
    if (!enabled || interrupted || hasSignal) {
      silentSince = null;
      return false;
    }
    silentSince ??= now;
    return now - silentSince >= timeoutMs;
  };
}

export function monitorMicrophoneSignal(context: AudioContext, stream: MediaStream, enabled: () => boolean, onChange: (silent: boolean) => void) {
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const detect = createMicrophoneSilenceDetector();
  let previous = false;
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const silent = detect(samples, performance.now(), context.state === 'running' && enabled());
    if (silent !== previous) { previous = silent; onChange(silent); }
  }, 250);
  return () => {
    window.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    onChange(false);
  };
}
