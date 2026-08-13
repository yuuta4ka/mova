import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import type { AudioSettings } from './audioSettings';

export interface MicrophonePipeline {
  stream: MediaStream;
  gain: GainNode | null;
  enhanced: boolean;
  close: () => void;
}

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;
let noiseSuppressorModule: Promise<typeof import('@sapphi-red/web-noise-suppressor')> | null = null;
const workletLoads = new WeakMap<AudioContext, Promise<void>>();

const loadRnnoiseBinary = () => {
  noiseSuppressorModule ||= import('@sapphi-red/web-noise-suppressor');
  rnnoiseBinary ||= noiseSuppressorModule.then(({ loadRnnoise }) => loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }));
  return rnnoiseBinary;
};

const loadRnnoiseWorklet = (context: AudioContext) => {
  let pending = workletLoads.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule(rnnoiseWorkletUrl);
    workletLoads.set(context, pending);
  }
  return pending;
};

const passthroughPipeline = (stream: MediaStream): MicrophonePipeline => ({
  stream,
  gain: null,
  enhanced: false,
  close: () => undefined,
});

export async function createMicrophonePipeline(sourceStream: MediaStream, settings: AudioSettings): Promise<MicrophonePipeline> {
  if (typeof AudioContext === 'undefined') return passthroughPipeline(sourceStream);
  let context: AudioContext | null = null;
  let rnnoise: (AudioNode & { destroy: () => void }) | null = null;
  try {
    context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
    const source = context.createMediaStreamSource(sourceStream);
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    gain.gain.value = settings.inputVolume / 100;

    let output: AudioNode = source;
    if (settings.noiseSuppressionMode === 'enhanced') {
      if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) throw new DOMException('AudioWorklet не поддерживается', 'NotSupportedError');
      const highPass = context.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 85;
      highPass.Q.value = 0.7;
      noiseSuppressorModule ||= import('@sapphi-red/web-noise-suppressor');
      const [wasmBinary, , { RnnoiseWorkletNode }] = await Promise.all([
        loadRnnoiseBinary(),
        loadRnnoiseWorklet(context),
        noiseSuppressorModule,
      ]);
      rnnoise = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
      output.connect(highPass);
      highPass.connect(rnnoise);
      output = rnnoise;
    }

    output.connect(gain);
    gain.connect(destination);
    await context.resume();
    const stream = destination.stream;
    const outputTrack = stream.getAudioTracks()[0];
    const sourceTrack = sourceStream.getAudioTracks()[0];
    if (!outputTrack || !sourceTrack) throw new DOMException('Не удалось создать обработанную аудиодорожку', 'NotReadableError');
    outputTrack.enabled = sourceTrack.enabled;
    let closed = false;
    return {
      stream,
      gain,
      enhanced: Boolean(rnnoise),
      close: () => {
        if (closed) return;
        closed = true;
        stream.getTracks().forEach((track) => track.stop());
        rnnoise?.destroy();
        source.disconnect();
        gain.disconnect();
        void context?.close().catch(() => undefined);
      },
    };
  } catch {
    rnnoise?.destroy();
    if (context?.state !== 'closed') void context?.close().catch(() => undefined);
    return passthroughPipeline(sourceStream);
  }
}
