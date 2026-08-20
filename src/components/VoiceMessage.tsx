import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import type { MessageAttachment } from '../lib/api';
import { normalizeVoiceWaveform } from '../lib/voiceWaveform';

const playbackRates = [1, 1.5, 2] as const;

export const isVoiceAttachment = (attachment?: MessageAttachment | null) => Boolean(attachment?.type?.startsWith('audio/') && attachment.durationMs);

export function formatVoiceDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const defaultWaveform = Array.from({ length: 28 }, (_, index) => 0.24 + ((index * 11) % 7) * 0.07);

export function normalizeVoiceMessageWaveform(values?: number[]) {
  const source = values?.filter(Number.isFinite);
  if (!source?.length) return defaultWaveform;
  const waveform = normalizeVoiceWaveform(source, defaultWaveform.length);
  const floor = Math.min(...waveform);
  const peak = Math.max(...waveform);
  const range = peak - floor;
  if (range < 0.04) return waveform.map(() => 0.24);
  return waveform.map((value) => Math.round((0.24 + ((value - floor) / range) * 0.76) * 100) / 100);
}

export function VoiceMessage({ attachment, unlistened = false, onListen }: { attachment: MessageAttachment; unlistened?: boolean; onListen?: () => void | Promise<void> }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Math.max(0, Number(attachment.durationMs || 0) / 1000));
  const [rateIndex, setRateIndex] = useState(0);
  const listenNotifiedRef = useRef(false);
  const waveform = useMemo(() => normalizeVoiceMessageWaveform(attachment.waveform), [attachment.waveform]);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = playbackRates[rateIndex];
  }, [rateIndex]);

  useEffect(() => () => {
    if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) audio.load();
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className="mova-voice-message" style={{ '--mova-voice-progress': progress } as CSSProperties}>
      <audio
        ref={audioRef}
        src={attachment.url || attachment.dataUrl}
        preload="auto"
        playsInline
        onLoadedMetadata={(event) => {
          const actualDuration = event.currentTarget.duration;
          if (Number.isFinite(actualDuration)) setDuration(actualDuration);
        }}
        onPlay={() => {
          setPlaying(true);
          if (!unlistened || !onListen || listenNotifiedRef.current) return;
          listenNotifiedRef.current = true;
          void Promise.resolve(onListen()).catch(() => {
            listenNotifiedRef.current = false;
          });
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button type="button" className="mova-voice-message__play" aria-label={playing ? 'Приостановить голосовое сообщение' : 'Воспроизвести голосовое сообщение'} onClick={() => void toggle()}>
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <div className="mova-voice-message__content">
        <div className="mova-voice-message__waveform" aria-hidden="true">
          {waveform.map((height, index) => (
            <i key={index} className={index / waveform.length <= progress ? 'is-played' : ''} style={{ '--mova-wave-height': height } as CSSProperties} />
          ))}
          <input
            type="range"
            min="0"
            max={Math.max(duration, 0.1)}
            step="0.01"
            value={Math.min(currentTime, duration || 0)}
            aria-label="Перемотать голосовое сообщение"
            onChange={(event) => {
              const next = Number(event.target.value);
              setCurrentTime(next);
              if (audioRef.current) audioRef.current.currentTime = next;
            }}
          />
        </div>
        <span className="mova-voice-message__footer">
          <span className="mova-voice-message__time">{formatVoiceDuration((currentTime || duration) * 1000)}</span>
          {unlistened && <i className="mova-voice-message__unlistened" role="img" aria-label="Голосовое сообщение ещё не прослушано" title="Ещё не прослушано" />}
        </span>
      </div>
      <button
        type="button"
        className="mova-voice-message__speed"
        aria-label={`Скорость воспроизведения ${playbackRates[rateIndex]}×`}
        onClick={() => setRateIndex((index) => (index + 1) % playbackRates.length)}
      >
        {playbackRates[rateIndex]}×
      </button>
    </div>
  );
}
