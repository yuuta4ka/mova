import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FastForward, Pause, Play, Rewind, Volume2, VolumeX, X } from 'lucide-react';
import type { MessageAttachment } from '../lib/api';
import { normalizeVoiceWaveform } from '../lib/voiceWaveform';
import { useAnimatedPresence } from './Primitives';

const playbackRates = [0.5, 1, 1.5, 2] as const;

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

export interface VoicePlaybackItem {
  id: string;
  attachment: MessageAttachment;
  authorName: string;
  createdAt: string;
  onListen?: () => void | Promise<void>;
}

export interface VoiceMessagePlayerController {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  active: VoicePlaybackItem | null;
  open: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  volume: number;
  muted: boolean;
  toggle: (item: VoicePlaybackItem) => Promise<void>;
  seekItem: (item: VoicePlaybackItem, seconds: number) => void;
  seek: (seconds: number) => void;
  skip: (seconds: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMuted: () => void;
  close: () => void;
  onLoadedMetadata: (audio: HTMLAudioElement) => void;
  onPlay: () => void;
  onPause: () => void;
  onTimeUpdate: (audio: HTMLAudioElement) => void;
  onEnded: () => void;
}

const attachmentSource = (attachment: MessageAttachment) => attachment.url || attachment.dataUrl || '';
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const formatPlaybackRate = (rate: number) => Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
const voicePopoverPointerMargin = 44;

function pointerDistanceFromVoicePopover(root: HTMLElement | null, clientX: number, clientY: number) {
  if (!root) return Number.POSITIVE_INFINITY;
  const popup = root.querySelector<HTMLElement>('.mova-voice-player__volume-menu,.mova-voice-player__speed-menu');
  const rectangles = [root.getBoundingClientRect(), popup?.getBoundingClientRect()].filter((rect): rect is DOMRect => Boolean(rect));
  const left = Math.min(...rectangles.map((rect) => rect.left));
  const right = Math.max(...rectangles.map((rect) => rect.right));
  const top = Math.min(...rectangles.map((rect) => rect.top));
  const bottom = Math.max(...rectangles.map((rect) => rect.bottom));
  const horizontalDistance = clientX < left ? left - clientX : clientX > right ? clientX - right : 0;
  const verticalDistance = clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0;
  return Math.hypot(horizontalDistance, verticalDistance);
}

export function formatVoiceMessageDate(createdAt: string, now = new Date()) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfMessageDay) / 86_400_000);
  const day = dayDifference === 0
    ? 'Сегодня'
    : dayDifference === 1
      ? 'Вчера'
      : new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${day} в ${time}`;
}

export function useVoiceMessagePlayer(): VoiceMessagePlayerController {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<VoicePlaybackItem | null>(null);
  const playingRef = useRef(false);
  const listenedRef = useRef(new Set<string>());
  const [active, setActive] = useState<VoicePlaybackItem | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [volume, setVolumeState] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = window.localStorage.getItem('mova-voice-message-volume');
    if (stored === null) return 1;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1;
  });
  const [muted, setMuted] = useState(false);

  const updatePlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  const notifyListened = useCallback(() => {
    const item = activeRef.current;
    if (!item?.onListen || listenedRef.current.has(item.id)) return;
    listenedRef.current.add(item.id);
    void Promise.resolve(item.onListen()).catch(() => listenedRef.current.delete(item.id));
  }, []);

  const prepare = useCallback((item: VoicePlaybackItem) => {
    const audio = audioRef.current;
    if (!audio) return null;
    const changed = activeRef.current?.id !== item.id;
    activeRef.current = item;
    setActive(item);
    setOpen(true);
    if (changed) {
      audio.pause();
      audio.src = attachmentSource(item.attachment);
      audio.dataset.voiceMessageId = item.id;
      audio.load();
      setCurrentTime(0);
      setDuration(Math.max(0, Number(item.attachment.durationMs || 0) / 1000));
    }
    audio.playbackRate = rate;
    audio.volume = volume;
    audio.muted = muted;
    return audio;
  }, [muted, rate, volume]);

  const toggle = useCallback(async (item: VoicePlaybackItem) => {
    const sameItem = activeRef.current?.id === item.id;
    const audio = prepare(item);
    if (!audio) return;
    if (sameItem && playingRef.current) {
      audio.pause();
      updatePlaying(false);
      return;
    }
    try {
      await audio.play();
      updatePlaying(true);
      notifyListened();
    } catch {
      updatePlaying(false);
    }
  }, [notifyListened, prepare, updatePlaying]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    const next = clamp(seconds, 0, duration || Number.MAX_SAFE_INTEGER);
    if (audio) {
      try {
        audio.currentTime = next;
      } catch {
        // Metadata can still be loading; the controlled time is applied on the next interaction.
      }
    }
    setCurrentTime(next);
  }, [duration]);

  const seekItem = useCallback((item: VoicePlaybackItem, seconds: number) => {
    prepare(item);
    const nextDuration = Math.max(0, Number(item.attachment.durationMs || 0) / 1000);
    const next = clamp(seconds, 0, nextDuration || Number.MAX_SAFE_INTEGER);
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = next;
      } catch {
        // See seek(): mobile browsers can reject early seeking before metadata arrives.
      }
    }
    setCurrentTime(next);
  }, [prepare]);

  const skip = useCallback((seconds: number) => seek(currentTime + seconds), [currentTime, seek]);

  const setRate = useCallback((nextRate: number) => {
    const normalized = playbackRates.includes(nextRate as (typeof playbackRates)[number]) ? nextRate : 1;
    setRateState(normalized);
    if (audioRef.current) audioRef.current.playbackRate = normalized;
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    const normalized = clamp(nextVolume, 0, 1);
    setVolumeState(normalized);
    setMuted(false);
    if (typeof window !== 'undefined') window.localStorage.setItem('mova-voice-message-volume', String(normalized));
    if (audioRef.current) {
      audioRef.current.volume = normalized;
      audioRef.current.muted = false;
    }
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      if (audioRef.current) audioRef.current.muted = next;
      return next;
    });
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
    activeRef.current = null;
    updatePlaying(false);
    setOpen(false);
    setCurrentTime(0);
    setDuration(0);
  }, [updatePlaying]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  return {
    audioRef,
    active,
    open,
    playing,
    currentTime,
    duration,
    rate,
    volume,
    muted,
    toggle,
    seekItem,
    seek,
    skip,
    setRate,
    setVolume,
    toggleMuted,
    close,
    onLoadedMetadata: (audio) => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    },
    onPlay: () => {
      updatePlaying(true);
      notifyListened();
    },
    onPause: () => updatePlaying(false),
    onTimeUpdate: (audio) => setCurrentTime(audio.currentTime),
    onEnded: close,
  };
}

export function VoicePlaybackAudio({ player }: { player: VoiceMessagePlayerController }) {
  return (
    <audio
      ref={player.audioRef}
      className="mova-voice-player__audio"
      preload="auto"
      playsInline
      aria-hidden="true"
      onLoadedMetadata={(event) => player.onLoadedMetadata(event.currentTarget)}
      onPlay={player.onPlay}
      onPause={player.onPause}
      onTimeUpdate={(event) => player.onTimeUpdate(event.currentTarget)}
      onEnded={player.onEnded}
    />
  );
}

export function VoiceMessagePlayerBar({ player }: { player: VoiceMessagePlayerController }) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [displayTime, setDisplayTime] = useState(player.currentTime);
  const volumeMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const presence = useAnimatedPresence(player.open, 220);
  const progress = player.duration > 0 ? clamp(displayTime / player.duration, 0, 1) : 0;

  useEffect(() => {
    setDisplayTime(player.currentTime);
  }, [player.active?.id]);

  useEffect(() => {
    if (!player.playing) setDisplayTime(player.currentTime);
  }, [player.currentTime, player.playing]);

  useEffect(() => {
    if (!player.playing || typeof window.requestAnimationFrame !== 'function') return;

    let frameId = 0;
    const updateProgress = () => {
      const nextTime = player.audioRef.current?.currentTime;
      if (typeof nextTime === 'number' && Number.isFinite(nextTime)) setDisplayTime(nextTime);
      frameId = window.requestAnimationFrame(updateProgress);
    };
    frameId = window.requestAnimationFrame(updateProgress);

    return () => window.cancelAnimationFrame(frameId);
  }, [player.active?.id, player.audioRef, player.playing]);

  useEffect(() => {
    if (!speedOpen && !volumeOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (speedOpen && !speedMenuRef.current?.contains(event.target as Node)) setSpeedOpen(false);
      if (volumeOpen && !volumeMenuRef.current?.contains(event.target as Node)) setVolumeOpen(false);
    };
    const closeWhenPointerLeaves = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (speedOpen && pointerDistanceFromVoicePopover(speedMenuRef.current, event.clientX, event.clientY) > voicePopoverPointerMargin) setSpeedOpen(false);
      if (volumeOpen && pointerDistanceFromVoicePopover(volumeMenuRef.current, event.clientX, event.clientY) > voicePopoverPointerMargin) setVolumeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSpeedOpen(false);
      setVolumeOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('pointermove', closeWhenPointerLeaves, { passive: true });
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('pointermove', closeWhenPointerLeaves);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [speedOpen, volumeOpen]);

  useEffect(() => {
    if (player.open) return;
    setSpeedOpen(false);
    setVolumeOpen(false);
  }, [player.open]);

  if (!presence.mounted || !player.active) return null;
  const rateLabel = formatPlaybackRate(player.rate);

  return (
    <section
      className={`mova-voice-player${presence.state === 'closing' ? ' is-closing' : ''}`}
      aria-label={presence.state === 'open' ? 'Проигрыватель голосового сообщения' : undefined}
      aria-hidden={presence.state === 'closing' || undefined}
      style={{ '--mova-voice-progress': progress, '--mova-voice-volume': `${player.volume * 100}%` } as CSSProperties}
    >
      <div className="mova-voice-player__transport">
        <button type="button" aria-label="Назад на 10 секунд" onClick={() => player.skip(-10)}><Rewind size={22} fill="currentColor" /></button>
        <button type="button" aria-label={player.playing ? 'Приостановить голосовое сообщение' : 'Продолжить голосовое сообщение'} onClick={() => void player.toggle(player.active!)}>
          {player.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button type="button" aria-label="Вперёд на 10 секунд" onClick={() => player.skip(10)}><FastForward size={22} fill="currentColor" /></button>
      </div>
      <div className="mova-voice-player__identity">
        <strong>{player.active.authorName}</strong>
        <small>{formatVoiceDuration(displayTime * 1000)} • {formatVoiceMessageDate(player.active.createdAt)}</small>
      </div>
      <div className="mova-voice-player__actions">
        <div
          ref={volumeMenuRef}
          className={`mova-voice-player__volume${volumeOpen ? ' is-open' : ''}`}
          onPointerEnter={() => setVolumeOpen(true)}
          onFocusCapture={() => setVolumeOpen(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setVolumeOpen(false);
          }}
        >
          <button type="button" className={player.muted ? 'is-muted' : ''} aria-label={player.muted ? 'Включить звук голосового сообщения' : 'Выключить звук голосового сообщения'} aria-pressed={player.muted} aria-expanded={volumeOpen} onClick={player.toggleMuted}>
            {player.muted ? <VolumeX size={21} /> : <Volume2 size={21} />}
          </button>
          <div className="mova-voice-player__volume-menu" aria-hidden={!volumeOpen}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={player.volume}
              aria-label="Громкость голосового сообщения"
              onChange={(event) => player.setVolume(Number(event.target.value))}
            />
          </div>
        </div>
        <div ref={speedMenuRef} className="mova-voice-player__speed-wrap">
          <button type="button" className={speedOpen ? 'is-open' : ''} aria-label={`Скорость голосового сообщения ${rateLabel}X`} aria-haspopup="menu" aria-expanded={speedOpen} onClick={() => setSpeedOpen((open) => !open)}>{rateLabel}X</button>
          {speedOpen && (
            <div className="mova-voice-player__speed-menu" role="menu" aria-label="Скорость воспроизведения">
              {playbackRates.map((option) => (
                <button
                  type="button"
                  key={option}
                  role="menuitemradio"
                  aria-checked={player.rate === option}
                  className={player.rate === option ? 'is-selected' : ''}
                  onClick={() => {
                    player.setRate(option);
                    setSpeedOpen(false);
                  }}
                >
                  {formatPlaybackRate(option)}x
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="mova-voice-player__close" aria-label="Закрыть голосовое сообщение" onClick={player.close}><X size={22} /></button>
      </div>
      <input
        className="mova-voice-player__progress"
        type="range"
        min="0"
        max={Math.max(player.duration, 0.1)}
        step="0.01"
        value={Math.min(displayTime, player.duration || 0)}
        aria-label="Перемотать воспроизводимое голосовое сообщение"
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          setDisplayTime(nextTime);
          player.seek(nextTime);
        }}
      />
    </section>
  );
}

interface VoiceMessageProps {
  attachment: MessageAttachment;
  messageId?: string;
  authorName?: string;
  createdAt?: string;
  player?: VoiceMessagePlayerController;
  unlistened?: boolean;
  onListen?: () => void | Promise<void>;
}

export function VoiceMessage({ attachment, messageId, authorName = '', createdAt = '', player, unlistened = false, onListen }: VoiceMessageProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [localDuration, setLocalDuration] = useState(Math.max(0, Number(attachment.durationMs || 0) / 1000));
  const [localRate, setLocalRate] = useState(1);
  const listenNotifiedRef = useRef(false);
  const waveform = useMemo(() => normalizeVoiceMessageWaveform(attachment.waveform), [attachment.waveform]);
  const item = useMemo<VoicePlaybackItem>(() => ({
    id: messageId || attachment.url || attachment.dataUrl || attachment.name,
    attachment,
    authorName,
    createdAt,
    onListen,
  }), [attachment, authorName, createdAt, messageId, onListen]);
  const sharedPlayer = player?.open && player.active?.id === item.id ? player : undefined;
  const playing = sharedPlayer ? sharedPlayer.playing : localPlaying;
  const currentTime = sharedPlayer ? sharedPlayer.currentTime : localCurrentTime;
  const duration = sharedPlayer ? sharedPlayer.duration : localDuration;
  const rate = player ? player.rate : localRate;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = localRate;
  }, [localRate]);

  useEffect(() => () => {
    if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
  }, []);

  const toggle = async () => {
    if (player) {
      await player.toggle(item);
      return;
    }
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
      setLocalPlaying(false);
    }
  };

  const cycleRate = () => {
    const currentIndex = playbackRates.indexOf(rate as (typeof playbackRates)[number]);
    const nextRate = playbackRates[(Math.max(0, currentIndex) + 1) % playbackRates.length];
    if (player) player.setRate(nextRate);
    else setLocalRate(nextRate);
  };

  return (
    <div className="mova-voice-message" style={{ '--mova-voice-progress': progress } as CSSProperties}>
      {!player && (
        <audio
          ref={audioRef}
          src={attachmentSource(attachment)}
          preload="auto"
          playsInline
          onLoadedMetadata={(event) => {
            const actualDuration = event.currentTarget.duration;
            if (Number.isFinite(actualDuration)) setLocalDuration(actualDuration);
          }}
          onPlay={() => {
            setLocalPlaying(true);
            if (!unlistened || !onListen || listenNotifiedRef.current) return;
            listenNotifiedRef.current = true;
            void Promise.resolve(onListen()).catch(() => {
              listenNotifiedRef.current = false;
            });
          }}
          onPause={() => setLocalPlaying(false)}
          onTimeUpdate={(event) => setLocalCurrentTime(event.currentTarget.currentTime)}
          onEnded={() => {
            setLocalPlaying(false);
            setLocalCurrentTime(0);
          }}
        />
      )}
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
              if (player) player.seekItem(item, next);
              else {
                setLocalCurrentTime(next);
                if (audioRef.current) audioRef.current.currentTime = next;
              }
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
        aria-label={`Скорость воспроизведения ${formatPlaybackRate(rate)}×`}
        onClick={cycleRate}
      >
        {formatPlaybackRate(rate)}×
      </button>
    </div>
  );
}
