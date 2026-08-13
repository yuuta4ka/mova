import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '../lib/api';
import { normalizeVoiceWaveform } from '../lib/voiceWaveform';

const waveformSize = 40;
const liveWaveformSize = 96;

export { normalizeVoiceWaveform } from '../lib/voiceWaveform';

export type VoiceRecorderState = 'idle' | 'requesting' | 'recording' | 'stopping';

export interface VoiceRecording {
  attachment: MessageAttachment;
  durationMs: number;
  waveform: number[];
}

const supportedMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  return candidates.find((type) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type)) || '';
};

const extensionForMime = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm');

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось подготовить запись'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });

export function useVoiceRecorder() {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>(() => Array(liveWaveformSize).fill(0.12));
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const samplesRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const finishRef = useRef<{ resolve: (recording: VoiceRecording | null) => void; discard: boolean } | null>(null);

  const stopTimers = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (analyserFrameRef.current !== null) window.cancelAnimationFrame(analyserFrameRef.current);
    timerRef.current = null;
    analyserFrameRef.current = null;
  }, []);

  const releaseMedia = useCallback(() => {
    stopTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, [stopTimers]);

  const reset = useCallback(() => {
    releaseMedia();
    recorderRef.current = null;
    chunksRef.current = [];
    samplesRef.current = [];
    setDurationMs(0);
    setLiveWaveform(Array(liveWaveformSize).fill(0.12));
    setState('idle');
  }, [releaseMedia]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Запись голоса не поддерживается на этом устройстве');
      return;
    }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      samplesRef.current = [];
      startedAtRef.current = performance.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError('Не удалось записать голосовое сообщение');
        finishRef.current?.resolve(null);
        finishRef.current = null;
        reset();
      };
      recorder.onstop = async () => {
        const pending = finishRef.current;
        finishRef.current = null;
        const recordedDuration = Math.max(0, Math.round(performance.now() - startedAtRef.current));
        const chunks = chunksRef.current;
        const waveform = normalizeVoiceWaveform(samplesRef.current);
        const actualMime = recorder.mimeType || chunks[0]?.type || mimeType || 'audio/webm';
        releaseMedia();
        recorderRef.current = null;
        chunksRef.current = [];
        samplesRef.current = [];
        setState('idle');
        setDurationMs(0);
        if (!pending || pending.discard || !chunks.length || recordedDuration < 300) {
          pending?.resolve(null);
          return;
        }
        try {
          const blob = new Blob(chunks, { type: actualMime });
          const dataUrl = await blobToDataUrl(blob);
          pending.resolve({
            durationMs: recordedDuration,
            waveform,
            attachment: {
              name: `Голосовое сообщение.${extensionForMime(actualMime)}`,
              type: actualMime,
              size: blob.size,
              dataUrl,
              durationMs: recordedDuration,
              waveform,
            },
          });
        } catch (recordingError) {
          setError(recordingError instanceof Error ? recordingError.message : 'Не удалось подготовить запись');
          pending.resolve(null);
        }
      };

      try {
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const context = new AudioContextClass();
          const source = context.createMediaStreamSource(stream);
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.72;
          source.connect(analyser);
          audioContextRef.current = context;
          const values = new Uint8Array(analyser.frequencyBinCount);
          const sample = () => {
            analyser.getByteTimeDomainData(values);
            let squareTotal = 0;
            for (const value of values) squareTotal += ((value - 128) / 128) ** 2;
            const nextLevel = Math.max(0.12, Math.min(1, Math.sqrt(squareTotal / values.length) * 3.3));
            if (!samplesRef.current.length || performance.now() - startedAtRef.current >= samplesRef.current.length * 90) {
              samplesRef.current.push(nextLevel);
              setLiveWaveform((values) => [...values.slice(-(liveWaveformSize - 1)), nextLevel]);
            }
            analyserFrameRef.current = window.requestAnimationFrame(sample);
          };
          sample();
        }
      } catch {
        // Recording still works when Web Audio metering is unavailable.
      }

      recorder.start(200);
      setState('recording');
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.max(0, Math.round(performance.now() - startedAtRef.current));
        setDurationMs(elapsed);
      }, 100);
    } catch (recordingError) {
      reset();
      const permissionDenied = recordingError instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(recordingError.name);
      setError(permissionDenied ? 'Разрешите Mova доступ к микрофону' : 'Не удалось включить микрофон');
    }
  }, [reset, releaseMedia, state]);

  const finish = useCallback((discard = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      reset();
      return Promise.resolve(null);
    }
    setState('stopping');
    return new Promise<VoiceRecording | null>((resolve) => {
      finishRef.current = { resolve, discard };
      recorder.stop();
    });
  }, [reset]);

  const cancel = useCallback(() => finish(true), [finish]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    finishRef.current?.resolve(null);
    finishRef.current = null;
    releaseMedia();
  }, [releaseMedia]);

  return { state, durationMs, liveWaveform, error, start, finish, cancel, clearError: () => setError('') };
}
