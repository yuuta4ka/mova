import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, AtSign, Ban, Bell, BellOff, Check, CheckCheck, ChevronDown, ChevronUp, Clock, FileText, Gamepad2, HeadphoneOff, Headphones, Info, LogOut, Maximize2, Menu, MessageCircle, Mic, MicOff, Minimize2, MonitorUp, Moon, MoreHorizontal, MoreVertical, Palette, Paperclip, Pencil, Phone, PhoneCall, PhoneOff, Plus, Reply, RotateCcw, Search, Send, Settings, Smile, Sparkles, Trash2, Upload, Users, Video, VideoOff, Volume2, X } from 'lucide-react';
import { api, realtime, session, type AppConversation, type AppMessage, type AppUser, type MessageAttachment, type RealtimeEvent } from './lib/api';
import { isJoinedCallState, normalizeCallState, useVoiceCall, type ScreenShareQuality } from './hooks/useVoiceCall';
import { Avatar, Button, ConfirmDialog, DialogSurface, IconButton, PopoverSurface, StatusIndicator, useToast } from './components/Primitives';
import { AppleEmoji, isEmojiOnlyText } from './components/AppleEmoji';
import { EmojiPicker } from './components/EmojiPicker';
import { buildMediaGallery, MediaViewer } from './components/MediaViewer';
import { defaultAudioSettings, loadAudioSettings, saveAudioSettings, type AudioSettings } from './lib/audioSettings';
import { defaultScreenShareSettings, loadScreenShareSettings, saveScreenShareSettings, type ScreenShareSettings } from './lib/screenShareSettings';
import { backgroundPresets, defaultBackgroundColor, loadBackgroundColor, saveBackgroundColor } from './lib/backgroundSettings';
import { accentPresets, defaultAccentColor, loadAccentColor, saveAccentColor } from './lib/accentSettings';
import { requestMessageNotificationPermission, showMessageNotification } from './lib/messageNotifications';
import { fileToDataUrl, prepareImageDataUrl } from './lib/imageCompression';
import { getMessageStructure } from './lib/messageGrouping';

const avatarStatus = (presence: AppUser['presence'], isOnline?: boolean) => (isOnline === false ? 'offline' : presence);
const attachmentSource = (attachment?: MessageAttachment | null) => attachment?.url || attachment?.dataUrl || '';
const activityTime = (startedAt?: string) => {
  if (!startedAt) return '';
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes} мин.`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч. ${minutes % 60} мин.`;
};
const russianCount = (value: number, one: string, few: string, many: string) => {
  const tens = value % 100;
  const units = value % 10;
  return tens >= 11 && tens <= 19 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many;
};
export const formatPresenceStatus = (user?: AppUser, now = Date.now()) => {
  if (!user) return 'не в сети';
  const online = user.isOnline ?? user.presence === 'online';
  if (online) return user.presence === 'idle' ? 'отошёл(ла)' : user.presence === 'dnd' ? 'не беспокоить' : 'в сети';
  if (!user.lastActiveAt) return 'был(а) недавно';
  const elapsed = Math.max(0, now - new Date(user.lastActiveAt).getTime());
  if (elapsed < 60_000) return 'был(а) только что';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `был(а) ${minutes} ${russianCount(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `был(а) ${hours} ${russianCount(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(hours / 24);
  return `был(а) ${days} ${russianCount(days, 'день', 'дня', 'дней')} назад`;
};
const messageSoundUrl = new URL('../sound-message.mp3', import.meta.url).href;
const loadedImageSources = new Set<string>();

function CachedImage({ src, alt, className = '', onLoad }: { src: string; alt: string; className?: string; onLoad?: () => void }) {
  const [loaded, setLoaded] = useState(() => loadedImageSources.has(src));
  useEffect(() => setLoaded(loadedImageSources.has(src)), [src]);
  return (
    <span className={`mova-cached-image ${loaded ? 'is-loaded' : 'is-loading'} ${className}`.trim()}>
      {!loaded && <i className="mova-image-skeleton" aria-hidden="true" />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => {
          loadedImageSources.add(src);
          setLoaded(true);
          onLoad?.();
        }}
      />
    </span>
  );
}

function ConversationListSkeleton() {
  return <div className="mova-conversation-skeleton" aria-label="Загружаем чаты">{Array.from({ length: 7 }, (_, index) => <i key={index}><b /><span><b /><b /></span></i>)}</div>;
}

function MessageListSkeleton() {
  return <div className="mova-message-skeleton" aria-label="Загружаем сообщения">{Array.from({ length: 6 }, (_, index) => <i className={index % 3 === 1 ? 'is-own' : ''} key={index}><b /><span /></i>)}</div>;
}

const messageUrlPattern = /https?:\/\/[^\s<>"']+/giu;
const urlTrailingPunctuation = /[.,!?;:…]/u;
const messageUrlDisplayMaxLength = 48;
const trimUrlPunctuation = (candidate: string) => {
  let url = candidate;
  let trailing = '';
  while (url && urlTrailingPunctuation.test(url.at(-1) || '')) {
    trailing = `${url.at(-1)}${trailing}`;
    url = url.slice(0, -1);
  }
  for (const [opening, closing] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ]) {
    while (url.endsWith(closing) && url.split(closing).length > url.split(opening).length) {
      trailing = `${closing}${trailing}`;
      url = url.slice(0, -1);
    }
  }
  return { url, trailing };
};
const displayMessageUrl = (url: string) => {
  const parsed = new URL(url);
  const hostname = parsed.host.replace(/^www\./iu, '');
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  const complete = `${hostname}${path}${parsed.search}${parsed.hash}`;
  if (complete.length <= messageUrlDisplayMaxLength) return complete;

  const suffix = parsed.search ? '?…' : parsed.hash ? '#…' : '…';
  const availablePathLength = messageUrlDisplayMaxLength - hostname.length - suffix.length;
  if (availablePathLength <= 0) return `${hostname}${suffix}`;
  if (path.length <= availablePathLength) return `${hostname}${path}${suffix}`;
  const pathEllipsis = parsed.search || parsed.hash ? '…' : '';
  return `${hostname}${path.slice(0, Math.max(0, availablePathLength - pathEllipsis.length))}${pathEllipsis}${suffix}`;
};

function MessageText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(messageUrlPattern)) {
    const start = match.index;
    const candidate = match[0];
    if (start > cursor) parts.push(<AppleEmoji text={text.slice(cursor, start)} key={`text-${cursor}`} />);
    const { url, trailing } = trimUrlPunctuation(candidate);
    let linkable = false;
    try {
      const parsed = new URL(url);
      linkable = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      linkable = false;
    }
    if (linkable) {
      parts.push(
        <a className="mova-message-link" href={url} target="_blank" rel="noopener noreferrer" title={url} key={`link-${start}`}>
          {displayMessageUrl(url)}
        </a>,
      );
      if (trailing) parts.push(<AppleEmoji text={trailing} key={`trailing-${start}`} />);
    } else {
      parts.push(<AppleEmoji text={candidate} key={`text-${start}`} />);
    }
    cursor = start + candidate.length;
  }
  if (cursor < text.length) parts.push(<AppleEmoji text={text.slice(cursor)} key={`text-${cursor}`} />);
  return <>{parts}</>;
}

interface ClientCache<T> {
  value: T;
  updatedAt: number;
}
const CLIENT_CACHE_TTL = 60_000;
const conversationCache = new Map<string, ClientCache<AppConversation[]>>();
const userCache = new Map<string, ClientCache<AppUser[]>>();
const messageCache = new Map<string, ClientCache<AppMessage[]>>();
const isFresh = <T,>(entry?: ClientCache<T>) => Boolean(entry && Date.now() - entry.updatedAt < CLIENT_CACHE_TTL);
const messageCacheKey = (userId: string, conversationId: string) => `${userId}:${conversationId}`;
const conversationActivityAt = (conversation: AppConversation) => new Date(conversation.lastMessage?.createdAt || conversation.createdAt).getTime();
export const sortConversationsByActivity = (items: AppConversation[]) => [...items].sort((left, right) => conversationActivityAt(right) - conversationActivityAt(left));
export const updateConversationLastMessage = (items: AppConversation[], message: AppMessage, onlyIfCurrent = false) => {
  const { author: _author, ...lastMessage } = message;
  return sortConversationsByActivity(
    items.map((conversation) =>
      conversation.id === message.conversationId && (!onlyIfCurrent || conversation.lastMessage?.id === message.id)
        ? { ...conversation, lastMessage }
        : conversation,
    ),
  );
};
export const reconcileClientMessage = (items: AppMessage[], message: AppMessage) => {
  const matchingClientId = message.clientId ? items.findIndex((item) => item.clientId === message.clientId) : -1;
  if (matchingClientId >= 0) return items.map((item, index) => (index === matchingClientId ? message : item));
  if (items.some((item) => item.id === message.id)) return items.map((item) => (item.id === message.id ? message : item));
  return [...items, message];
};
const preferredConversation = (items: AppConversation[]) => {
  const preferred = sessionStorage.getItem('mova-active-call') || sessionStorage.getItem('mova-pending-call') || localStorage.getItem('mova-selected-conversation');
  return (preferred && items.some((item) => item.id === preferred) ? preferred : items[0]?.id) || null;
};
const conversationTypingLabel = (conversation: AppConversation, currentUserId: string, typingUserIds: string[]) => {
  const typingUsers = conversation.members.filter((member) => member.id !== currentUserId && typingUserIds.includes(member.id));
  return typingUsers.length === 1
    ? `${typingUsers[0].name} печатает…`
    : typingUsers.length === 2
      ? `${typingUsers[0].name} и ${typingUsers[1].name} печатают…`
      : typingUsers.length > 2
        ? `${typingUsers[0].name}, ${typingUsers[1].name} и ещё ${typingUsers.length - 2} печатают…`
        : '';
};
type MobileNavigationView = 'list' | 'chat';
const mobileNavigationQuery = '(max-width: 760px), (orientation: landscape) and (max-height: 520px) and (max-width: 960px)';
const mobileHistoryKey = 'movaMobileNavigation';
const readMobileHistory = () => {
  const state = window.history.state;
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[mobileHistoryKey];
  if (!value || typeof value !== 'object') return null;
  const view = (value as { view?: unknown }).view;
  const conversationId = (value as { conversationId?: unknown }).conversationId;
  return view === 'list' || view === 'chat'
    ? { view, conversationId: typeof conversationId === 'string' ? conversationId : null }
    : null;
};
const mobileHistoryState = (view: MobileNavigationView, conversationId?: string | null) => ({
  ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
  [mobileHistoryKey]: { view, conversationId: conversationId || null },
});
function useMobileNavigationViewport() {
  const matches = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(mobileNavigationQuery).matches);
  const [mobile, setMobile] = useState(matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(mobileNavigationQuery);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return mobile;
}
const clearClientCache = () => {
  conversationCache.clear();
  userCache.clear();
  messageCache.clear();
  loadedImageSources.clear();
};

function MessageStatus({ message, conversation, onRetry, retrying = false }: { message: AppMessage; conversation: AppConversation; onRetry?: () => void; retrying?: boolean }) {
  if (message.deliveryState === 'sending')
    return (
      <span className="mova-message-status-slot">
        <span className="mova-message-status is-sending" role="img" aria-label="Отправляется" title="Отправляется">
          <Clock size={13} aria-hidden="true" />
        </span>
      </span>
    );
  if (message.deliveryState === 'failed' && onRetry)
    return (
      <span className="mova-message-status-slot has-retry">
        <span className="mova-message-status is-failed" role="img" aria-label="Не отправлено" title="Не отправлено">
          <X size={12} aria-hidden="true" />
        </span>
        <button
          type="button"
          className="mova-message-retry"
          aria-label="Повторить"
          title="Повторить отправку"
          disabled={retrying}
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      </span>
    );
  if (message.deliveryState === 'failed')
    return (
      <span className="mova-message-status-slot">
        <span className="mova-message-status is-failed" role="img" aria-label="Не отправлено" title="Не отправлено">
          <X size={12} aria-hidden="true" />
        </span>
      </span>
    );
  if (!message.sentAt) return null;
  const recipients = conversation.members.filter((member) => member.id !== message.authorId);
  const readCount = recipients.filter((member) => message.readBy?.some((receipt) => receipt.userId === member.id)).length;
  const allRead = recipients.length > 0 && readCount === recipients.length;
  const label = allRead ? (recipients.length === 1 ? 'Прочитано' : 'Прочитано всеми') : readCount ? `Прочитано: ${readCount} из ${recipients.length}` : 'Отправлено';
  return (
    <span className="mova-message-status-slot">
      <span className={`mova-message-status ${allRead ? 'is-read' : readCount ? 'is-partially-read' : 'is-sent'}`} role="img" aria-label={label} title={label}>
        {readCount ? <CheckCheck size={13} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
      </span>
    </span>
  );
}

const editableHandle = (handle: string) => handle.replace(/^@+/, '');
const profileBioLimit = 240;
const profileBioMinHeight = 96;
const profileBioMaxHeight = 224;
const readableProfileError = (message: string) => {
  if (message === 'Юзернейм начинается с @ и содержит 3–24 латинских символа')
    return 'Имя пользователя должно содержать 3–24 латинских символа, цифры, точку или подчёркивание.';
  if (message === 'Этот юзернейм уже занят') return 'Это имя пользователя уже занято';
  return message;
};

export function ProfileEditor({ user, open, onClose, onSaved }: { user: AppUser; open: boolean; onClose: () => void; onSaved: (user: AppUser) => void }) {
  const [form, setForm] = useState({
    name: user.name,
    handle: editableHandle(user.handle),
    bio: user.bio || '',
    avatarDataUrl: user.avatarDataUrl || '',
    bannerDataUrl: user.bannerDataUrl || '',
  });
  const [loading, setLoading] = useState(false);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const showError = (message: string) => toast.push(readableProfileError(message), 'danger');
  const resizeBio = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const contentHeight = Math.max(profileBioMinHeight, textarea.scrollHeight);
    textarea.style.height = `${Math.min(contentHeight, profileBioMaxHeight)}px`;
    textarea.style.overflowY = contentHeight > profileBioMaxHeight ? 'auto' : 'hidden';
  }, []);
  useEffect(() => {
    if (open) {
      setForm({
        name: user.name,
        handle: editableHandle(user.handle),
        bio: user.bio || '',
        avatarDataUrl: user.avatarDataUrl || '',
        bannerDataUrl: user.bannerDataUrl || '',
      });
    }
  }, [open, user]);
  useEffect(() => resizeBio(bioRef.current), [form.bio, open, resizeBio]);
  const selectProfileImage = async (file: File | undefined, field: 'avatarDataUrl' | 'bannerDataUrl') => {
    if (!file) return;
    if (file.size > 30_000_000) return showError('Фотография должна быть меньше 30 МБ');
    try {
      const options = field === 'avatarDataUrl' ? { maxDimension: 1024, maxBytes: 650_000, quality: 0.94, skipBelowBytes: 120_000 } : { maxDimension: 2560, maxBytes: 1_600_000, quality: 0.94, skipBelowBytes: 180_000 };
      const prepared = await prepareImageDataUrl(file, options);
      setForm((current) => ({ ...current, [field]: prepared.dataUrl }));
    } catch (imageError) {
      showError(imageError instanceof Error ? imageError.message : 'Не удалось обработать фотографию');
    }
  };
  const save = async () => {
    setLoading(true);
    try {
      const result = await api.updateProfile({
        name: form.name,
        handle: `@${form.handle}`,
        bio: form.bio,
        avatarDataUrl: form.avatarDataUrl,
        bannerDataUrl: form.bannerDataUrl,
        activity: user.activity || null,
      });
      onSaved(result.user);
      onClose();
    } catch (profileError) {
      showError(profileError instanceof Error ? profileError.message : 'Не удалось сохранить профиль');
    } finally {
      setLoading(false);
    }
  };
  return (
    <DialogSurface open={open} onClose={onClose} className="mova-glass-card mova-profile-editor" labelledBy="profile-title">
        <header>
          <div>
            <h2 id="profile-title">Редактировать профиль</h2>
            <p>Так вас видят другие пользователи Mova</p>
          </div>
          <IconButton data-dialog-close label="Закрыть" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="mova-profile-preview">
          <div className="mova-profile-banner" style={form.bannerDataUrl ? { backgroundImage: `url(${form.bannerDataUrl})` } : undefined}>
            <label>
              <Upload size={14} />
              Изменить шапку
              <input
                type="file"
                accept="image/*"
                onChange={(event) => void selectProfileImage(event.target.files?.[0], 'bannerDataUrl')}
              />
            </label>
          </div>
          <div className="mova-profile-avatar-edit">
            <Avatar name={form.name || user.name} src={form.avatarDataUrl} color={user.color} size="xl" />
            <label aria-label="Изменить аватар">
              <Pencil size={14} />
              <input
                type="file"
                accept="image/*"
                onChange={(event) => void selectProfileImage(event.target.files?.[0], 'avatarDataUrl')}
              />
            </label>
          </div>
          <div className="mova-profile-preview__identity">
            <strong><AppleEmoji text={form.name || user.name} /></strong>
            <span>@{form.handle || 'username'}</span>
          </div>
        </div>
        <div className="mova-profile-form">
          <label>
            <span>Имя</span>
            <span className="mova-control-shell"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Как к вам обращаться" /></span>
          </label>
          <label>
            <span>Имя пользователя</span>
            <div className="mova-profile-username-field mova-control-shell">
              <span aria-hidden="true">@</span>
              <input aria-label="Имя пользователя" value={form.handle} onChange={(event) => setForm({ ...form, handle: editableHandle(event.target.value).toLowerCase() })} placeholder="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </div>
          </label>
          <label className="is-wide">
            <span className="mova-profile-bio-heading">
              <span>О себе</span>
              <span className={`mova-profile-bio-counter${form.bio.length >= profileBioLimit * 0.8 ? ' is-near-limit' : ''}${form.bio.length >= profileBioLimit ? ' is-at-limit' : ''}`} aria-live="polite">
                {form.bio.length} / {profileBioLimit}{form.bio.length >= profileBioLimit ? ' · лимит' : ''}
              </span>
            </span>
            <span className="mova-control-shell mova-control-shell--textarea"><textarea
              ref={bioRef}
              className="mova-profile-bio"
              aria-label="О себе"
              value={form.bio}
              onChange={(event) => {
                const bio = event.target.value.slice(0, profileBioLimit);
                setForm({ ...form, bio });
                resizeBio(event.currentTarget);
              }}
              placeholder="Пара слов о себе"
              maxLength={profileBioLimit}
            /></span>
          </label>
        </div>
        <footer>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={loading} onClick={save}>
            Сохранить профиль
          </Button>
        </footer>
    </DialogSurface>
  );
}

function SettingsModal({ user, open, onClose, onEditProfile }: { user: AppUser; open: boolean; onClose: () => void; onEditProfile: () => void }) {
  const [section, setSection] = useState<'profile' | 'appearance' | 'audio' | 'screen'>('audio');
  const [settings, setSettings] = useState<AudioSettings>(defaultAudioSettings);
  const [screenSettings, setScreenSettings] = useState<ScreenShareSettings>(defaultScreenShareSettings);
  const [backgroundColor, setBackgroundColor] = useState(defaultBackgroundColor);
  const [accentColor, setAccentColor] = useState(defaultAccentColor);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const testStream = useRef<MediaStream | null>(null);
  const testContext = useRef<AudioContext | null>(null);
  const animation = useRef<number | null>(null);
  const outputSelectionSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const stopTest = useCallback(() => {
    if (animation.current) cancelAnimationFrame(animation.current);
    animation.current = null;
    testStream.current?.getTracks().forEach((track) => track.stop());
    testStream.current = null;
    void testContext.current?.close();
    testContext.current = null;
    setTesting(false);
    setLevel(0);
  }, []);
  const refreshDevices = useCallback(async (askPermission = false) => {
    if (!navigator.mediaDevices) return setDeviceError('Устройства недоступны в этом браузере');
    try {
      setDeviceError('');
      if (askPermission) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((device) => device.kind === 'audioinput'));
      setOutputs(devices.filter((device) => device.kind === 'audiooutput'));
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Нет доступа к аудиоустройствам');
    }
  }, []);
  useEffect(() => {
    if (open) {
      setSettings(loadAudioSettings());
      setScreenSettings(loadScreenShareSettings());
      setBackgroundColor(loadBackgroundColor());
      setAccentColor(loadAccentColor());
      void refreshDevices(false);
    } else stopTest();
  }, [open, refreshDevices, stopTest]);
  useEffect(() => () => stopTest(), [stopTest]);
  const startTest = async () => {
    if (testing) return stopTest();
    try {
      setDeviceError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(settings.inputDeviceId !== 'default' ? { deviceId: { exact: settings.inputDeviceId } } : {}),
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
        },
      });
      testStream.current = stream;
      const context = new AudioContext();
      testContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const gain = context.createGain();
      gain.gain.value = settings.inputVolume / 100;
      context.createMediaStreamSource(stream).connect(gain).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setTesting(true);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setLevel(Math.min(100, Math.round((data.reduce((sum, value) => sum + value, 0) / data.length) * 1.6)));
        animation.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Не удалось включить микрофон');
    }
  };
  const testOutput = async () => {
    try {
      const context = new AudioContext();
      const setSinkId = (context as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (settings.outputDeviceId !== 'default' && setSinkId) await setSinkId.call(context, settings.outputDeviceId);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 520;
      gain.gain.value = Math.min(2, settings.outputVolume / 100) * 0.12;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.45);
      window.setTimeout(() => void context.close(), 700);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Не удалось воспроизвести звук');
    }
  };
  const save = () => {
    saveAudioSettings(settings);
    saveScreenShareSettings(screenSettings);
    saveBackgroundColor(backgroundColor);
    saveAccentColor(accentColor);
    stopTest();
    onClose();
  };
  return (
    <DialogSurface open={open} onClose={onClose} className="mova-settings" labelledBy="settings-title">
        <aside>
          <div>
            <img src="/mova-logo.png" alt="" />
            <strong>Настройки</strong>
          </div>
          <button type="button" className={section === 'profile' ? 'is-active' : ''} onClick={() => setSection('profile')}>
            <Pencil size={17} />
            Профиль
          </button>
          <button type="button" className={section === 'appearance' ? 'is-active' : ''} onClick={() => setSection('appearance')}>
            <Palette size={17} />
            Оформление
          </button>
          <button type="button" className={section === 'audio' ? 'is-active' : ''} onClick={() => setSection('audio')}>
            <Headphones size={17} />
            Голос и звук
          </button>
          <button type="button" className={section === 'screen' ? 'is-active' : ''} onClick={() => setSection('screen')}>
            <MonitorUp size={17} />
            Демонстрация
          </button>
        </aside>
        <main>
          <header>
            <div>
              <h2 id="settings-title">{section === 'profile' ? 'Профиль' : section === 'appearance' ? 'Оформление' : section === 'screen' ? 'Демонстрация экрана' : 'Голос и звук'}</h2>
              <p>{section === 'profile' ? 'Отображение вашего аккаунта' : section === 'appearance' ? 'Цвет фона и акцента' : section === 'screen' ? 'Качество при включении демонстрации' : 'Устройства и обработка голоса'}</p>
            </div>
            <IconButton data-dialog-close label="Закрыть настройки" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </header>
          {section === 'profile' ? (
            <div className="mova-settings-profile">
              <div className="mova-settings-profile__banner" style={user.bannerDataUrl ? { backgroundImage: `url(${user.bannerDataUrl})` } : undefined} />
              <Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="xl" status={avatarStatus(user.presence)} />
              <h3><AppleEmoji text={user.name} /></h3>
              <span>{user.handle}</span>
              {user.bio && <p>{user.bio}</p>}
              <Button
                leadingIcon={<Pencil size={16} />}
                onClick={() => {
                  onClose();
                  onEditProfile();
                }}
              >
                Настроить профиль
              </Button>
            </div>
          ) : section === 'appearance' ? (
            <BackgroundDefaults color={backgroundColor} onChange={setBackgroundColor} accentColor={accentColor} onAccentChange={setAccentColor} />
          ) : section === 'screen' ? (
            <ScreenShareDefaults settings={screenSettings} onChange={setScreenSettings} />
          ) : (
            <div className="mova-audio-settings">
              <section>
                <h3>
                  <Mic size={18} />
                  Микрофон
                </h3>
                <label>
                  <span>Устройство ввода</span>
                  <select
                    value={settings.inputDeviceId}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        inputDeviceId: event.target.value,
                      })
                    }
                  >
                    <option value="default">Системный микрофон</option>
                    {inputs
                      .filter((device) => device.deviceId !== 'default')
                      .map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Микрофон ${index + 1}`}
                        </option>
                      ))}
                  </select>
                </label>
                <RangeSetting label="Громкость микрофона" value={settings.inputVolume} onChange={(inputVolume) => setSettings({ ...settings, inputVolume })} />
                <div className="mova-mic-test">
                  <Button variant={testing ? 'danger' : 'secondary'} size="sm" onClick={() => void startTest()}>
                    {testing ? 'Остановить тест' : 'Проверить микрофон'}
                  </Button>
                  <i>
                    <span style={{ width: `${level}%` }} />
                  </i>
                </div>
              </section>
              <section>
                <h3>
                  <Headphones size={18} />
                  Вывод звука
                </h3>
                <label>
                  <span>Наушники или динамики</span>
                  <select
                    value={settings.outputDeviceId}
                    disabled={!outputSelectionSupported}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        outputDeviceId: event.target.value,
                      })
                    }
                  >
                    <option value="default">Системное устройство</option>
                    {outputs
                      .filter((device) => device.deviceId !== 'default')
                      .map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Устройство ${index + 1}`}
                        </option>
                      ))}
                  </select>
                </label>
                {!outputSelectionSupported && <small>Выбор выхода не поддерживается этим браузером — используется системное устройство.</small>}
                <RangeSetting label="Громкость собеседников" value={settings.outputVolume} onChange={(outputVolume) => setSettings({ ...settings, outputVolume })} />
                <RangeSetting label="Громкость системных звуков" value={settings.systemVolume} max={100} onChange={(systemVolume) => setSettings({ ...settings, systemVolume })} />
                <Button variant="secondary" size="sm" leadingIcon={<Volume2 size={15} />} onClick={() => void testOutput()}>
                  Проверить звук
                </Button>
              </section>
              <section>
                <h3>
                  <Sparkles size={18} />
                  Обработка голоса
                </h3>
                <ToggleSetting label="Шумоподавление" description="Убирает постоянный фоновый шум" checked={settings.noiseSuppression} onChange={(noiseSuppression) => setSettings({ ...settings, noiseSuppression })} />
                <ToggleSetting label="Эхоподавление" description="Не даёт звуку из наушников вернуться в микрофон" checked={settings.echoCancellation} onChange={(echoCancellation) => setSettings({ ...settings, echoCancellation })} />
                <ToggleSetting label="Автоматическое усиление" description="Выравнивает слишком тихий и громкий голос" checked={settings.autoGainControl} onChange={(autoGainControl) => setSettings({ ...settings, autoGainControl })} />
              </section>
              <Button variant="ghost" size="sm" onClick={() => void refreshDevices(true)}>
                Обновить список устройств
              </Button>
              {deviceError && <div className="mova-auth-error">{deviceError}</div>}
            </div>
          )}
          <footer>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={save}>Сохранить настройки</Button>
          </footer>
        </main>
    </DialogSurface>
  );
}

function BackgroundDefaults({ color, onChange, accentColor, onAccentChange }: { color: string; onChange: (color: string) => void; accentColor: string; onAccentChange: (color: string) => void }) {
  return (
    <div className="mova-background-settings">
      <section>
        <div className="mova-background-preview" style={{ '--mova-preview-color': color, '--mova-preview-accent': accentColor } as CSSProperties}>
          <i /><i /><span /><span />
        </div>
        <h3>Цвет фона</h3>
        <p>Цвет применяется к основному окну и фону переписки.</p>
        <div className="mova-background-presets">
          {backgroundPresets.map((preset) => (
            <button key={preset} type="button" className={color.toLowerCase() === preset ? 'is-active' : ''} style={{ backgroundColor: preset }} aria-label={`Цвет ${preset}`} aria-pressed={color.toLowerCase() === preset} onClick={() => onChange(preset)}>
              {color.toLowerCase() === preset && <Check size={16} />}
            </button>
          ))}
          <label aria-label="Выбрать свой цвет">
            <Palette size={17} />
            <input type="color" value={color} onChange={(event) => onChange(event.target.value)} />
          </label>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(defaultBackgroundColor)}>Вернуть стандартный цвет</Button>
        <div className="mova-appearance-divider" />
        <h3>Акцентный цвет</h3>
        <p>Используется для ваших сообщений, активных элементов и кнопок.</p>
        <div className="mova-accent-presets">
          {accentPresets.map((preset) => (
            <button key={preset} type="button" className={accentColor.toLowerCase() === preset ? 'is-active' : ''} style={{ backgroundColor: preset }} aria-label={`Акцент ${preset}`} aria-pressed={accentColor.toLowerCase() === preset} onClick={() => onAccentChange(preset)}>
              {accentColor.toLowerCase() === preset && <Check size={16} />}
            </button>
          ))}
          <label aria-label="Выбрать свой акцентный цвет">
            <Palette size={17} />
            <input type="color" value={accentColor} onChange={(event) => onAccentChange(event.target.value)} />
          </label>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onAccentChange(defaultAccentColor)}>Вернуть стандартный акцент</Button>
      </section>
    </div>
  );
}

function ScreenShareDefaults({ settings, onChange }: { settings: ScreenShareSettings; onChange: (settings: ScreenShareSettings) => void }) {
  const resolution = `${settings.width}x${settings.height}`;
  return (
    <div className="mova-audio-settings mova-screen-defaults">
      <section>
        <h3>
          <MonitorUp size={18} />
          Качество по умолчанию
        </h3>
        <p>Эти параметры применятся сразу после включения демонстрации экрана.</p>
        <label>
          <span>Разрешение</span>
          <select
            value={resolution}
            onChange={(event) => {
              const [width, height] = event.target.value.split('x').map(Number);
              onChange({ ...settings, width, height });
            }}
          >
            <option value="1280x720">720p — экономия трафика</option>
            <option value="1920x1080">1080p — оптимально</option>
            <option value="2560x1440">1440p — высокая чёткость</option>
          </select>
        </label>
        <label>
          <span>Частота кадров</span>
          <select value={settings.frameRate} onChange={(event) => onChange({ ...settings, frameRate: Number(event.target.value) })}>
            <option value={15}>15 FPS — минимум трафика</option>
            <option value={30}>30 FPS — плавно</option>
            <option value={60}>60 FPS — максимум плавности</option>
          </select>
        </label>
        <small>Итоговое качество также зависит от выбранного окна, браузера и скорости сети.</small>
      </section>
    </div>
  );
}

function RangeSetting({ label, value, max = 200, onChange }: { label: string; value: number; max?: number; onChange: (value: number) => void }) {
  return (
    <label className="mova-range-setting">
      <span>
        {label}
        <b>{value}%</b>
      </span>
      <input type="range" min="0" max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="mova-toggle-setting">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}

function AccountMenu({ user, open, onClose, onEdit, onSettings, onUpdated, onLogout }: { user: AppUser; open: boolean; onClose: () => void; onEdit: () => void; onSettings: () => void; onUpdated: (user: AppUser) => void; onLogout: () => void }) {
  const [dndOpen, setDndOpen] = useState(false);
  const [, setActivityTick] = useState(0);
  useEffect(() => {
    if (!open || !user.activity) return;
    const timer = window.setInterval(() => setActivityTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [open, user.activity]);
  const setPresence = async (presence: AppUser['presence'], duration?: number | 'forever') => {
    const dndUntil = presence === 'dnd' ? (duration === 'forever' || !duration ? 'forever' : new Date(Date.now() + duration).toISOString()) : null;
    const result = await api.updatePresence(presence, dndUntil);
    onUpdated(result.user);
    onClose();
  };
  const durations: Array<[string, number | 'forever']> = [
    ['15 минут', 15 * 60000],
    ['1 час', 60 * 60000],
    ['8 часов', 8 * 3600000],
    ['24 часа', 24 * 3600000],
    ['3 дня', 3 * 86400000],
    ['Навсегда', 'forever'],
  ];
  return (
    <PopoverSurface open={open} className="mova-account-menu mova-glass-card" ariaLabel="Меню аккаунта">
      <div className="mova-account-profile">
        {user.bannerDataUrl && <div style={{ backgroundImage: `url(${user.bannerDataUrl})` }} />}
        <Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="lg" status={avatarStatus(user.presence)} />
        <span>
          <strong><AppleEmoji text={user.name} /></strong>
          <small>{user.handle}</small>
        </span>
      </div>
      {user.activity && (
        <div className="mova-current-activity">
          <Gamepad2 size={16} />
          <span>
            <strong>{user.activity.name}</strong>
            <small>уже {activityTime(user.activity.startedAt)}</small>
          </span>
        </div>
      )}
      <button type="button" onClick={() => void setPresence('online')}>
        <StatusIndicator status="online" inline />
        <span>В сети</span>
        {user.presence === 'online' && <Check size={14} />}
      </button>
      <button type="button" onClick={() => void setPresence('idle')}>
        <StatusIndicator status="idle" inline />
        <span>Отошёл</span>
        {user.presence === 'idle' && <Check size={14} />}
      </button>
      <button type="button" onClick={() => setDndOpen(!dndOpen)}>
        <StatusIndicator status="dnd" inline />
        <span>Не беспокоить</span>
        <ChevronDown size={14} />
      </button>
      {dndOpen && (
        <div className="mova-dnd-options">
          {durations.map(([label, duration]) => (
            <button type="button" key={label} onClick={() => void setPresence('dnd', duration)}>
              <Clock size={13} />
              {label}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => void setPresence('invisible')}>
        <StatusIndicator status="invisible" inline />
        <span>Невидимый</span>
        {user.presence === 'invisible' && <Check size={14} />}
      </button>
      <div className="mova-account-menu__divider" />
      <button
        type="button"
        onClick={() => {
          onSettings();
          onClose();
        }}
      >
        <Settings size={15} />
        <span>Настройки</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onEdit();
          onClose();
        }}
      >
        <Pencil size={15} />
        <span>Редактировать профиль</span>
      </button>
      <button type="button" onClick={onLogout}>
        <LogOut size={15} />
        <span>Выйти</span>
      </button>
    </PopoverSurface>
  );
}

function AuthScreen({ onAuth }: { onAuth: (user: AppUser) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = mode === 'register' ? await api.register(form) : await api.login(form);
      session.set(result.token);
      onAuth(result.user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="mova-auth">
      <div className="mova-auth__aurora" />
      <section className="mova-auth__panel">
        <div className="mova-glass-card mova-auth-card">
          <header>
            <img className="mova-auth-logo" src="/mova-logo.png" alt="" />
            <h1>Mova</h1>
            <p>{mode === 'register' ? 'Создайте аккаунт' : 'Войдите в свой аккаунт'}</p>
          </header>
          <div className="mova-auth-tabs" role="tablist" aria-label="Вход или регистрация">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); }}>Вход</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); }}>Регистрация</button>
          </div>
          <form onSubmit={submit}>
            {mode === 'register' && (
              <label>
                <span>Имя</span>
                <input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ваше имя" autoComplete="name" />
              </label>
            )}
            <label>
              <span>Почта</span>
              <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" autoComplete="email" />
            </label>
            <label>
              <span>Пароль</span>
              <input required minLength={8} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Не менее 8 символов" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
            </label>
            {error && <div className="mova-auth-error">{error}</div>}
            <Button type="submit" size="lg" loading={loading}>
              {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
            </Button>
          </form>
          <footer>Продолжая, вы соглашаетесь с правилами сервиса.</footer>
        </div>
      </section>
    </main>
  );
}

function ConversationAvatar({ conversation, currentUser }: { conversation: AppConversation; currentUser: AppUser }) {
  if (conversation.kind === 'group')
    return (
      <span className="mova-real-group-avatar">
        <Users size={19} />
      </span>
    );
  const person = conversation.members.find((member) => member.id !== currentUser.id) ?? currentUser;
  return <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} status={avatarStatus(person.presence, person.isOnline)} size="lg" />;
}

function CreateConversation({ open, users, onClose, onCreated }: { open: boolean; users: AppUser[]; onClose: () => void; onCreated: (conversation: AppConversation) => void }) {
  const [kind, setKind] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (open) {
      setKind('direct');
      setTitle('');
      setSelected([]);
      setMemberQuery('');
      setError('');
    }
  }, [open]);
  const create = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.createConversation({
        kind,
        title,
        memberIds: kind === 'direct' ? selected.slice(0, 1) : selected,
      });
      onCreated(result.conversation);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Не удалось создать чат');
    } finally {
      setLoading(false);
    }
  };
  const visibleUsers = users.filter((user) => `${user.name} ${user.handle}`.toLocaleLowerCase().includes(memberQuery.toLocaleLowerCase()));
  const selectedUsers = selected.map((id) => users.find((user) => user.id === id)).filter((user): user is AppUser => Boolean(user));
  return (
    <DialogSurface open={open} onClose={onClose} className="mova-glass-card mova-create-modal" labelledBy="create-title" initialFocus="first">
        <header>
          <div>
            <h2 id="create-title">Новый чат</h2>
            <p>{kind === 'direct' ? 'Выберите человека — и можно начинать' : 'Название и участники в одном окне'}</p>
          </div>
          <IconButton data-dialog-close label="Закрыть" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        <div className="mova-create-tabs" role="tablist" aria-label="Тип нового чата">
          <button
            type="button"
            className={kind === 'direct' ? 'is-active' : ''}
            onClick={() => {
              setKind('direct');
              setSelected((items) => items.slice(0, 1));
            }}
          >
            <MessageCircle size={17} />
            <span><strong>Личный</strong><small>Один на один</small></span>
          </button>
          <button type="button" className={kind === 'group' ? 'is-active' : ''} onClick={() => setKind('group')}>
            <Users size={17} />
            <span><strong>Группа</strong><small>Для нескольких людей</small></span>
          </button>
        </div>
        <div className="mova-create-fields">
          {kind === 'group' && (
            <label className="mova-create-name mova-control-shell">
              <Users size={17} />
              <input data-dialog-initial autoFocus value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Название группы" />
              <small>{title.trim().length}/80</small>
            </label>
          )}
          <label className="mova-create-search mova-control-shell">
            <Search size={17} />
            <input data-dialog-initial={kind === 'direct' || undefined} autoFocus={kind === 'direct'} value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Имя или @username" />
            {memberQuery && <button type="button" aria-label="Очистить поиск" onClick={() => setMemberQuery('')}><X size={14} /></button>}
          </label>
        </div>
        {kind === 'group' && selectedUsers.length > 0 && (
          <div className="mova-create-selected" aria-label="Выбранные участники">
            {selectedUsers.map((user) => (
              <button key={user.id} type="button" onClick={() => setSelected((items) => items.filter((id) => id !== user.id))}>
                <Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="xs" />
                <span><AppleEmoji text={user.name} /></span>
                <X size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="mova-create-members">
          <span>{kind === 'group' ? `Участники${selected.length ? ` · ${selected.length}` : ''}` : 'Люди'}</span>
          {users.length === 0 ? (
            <div className="mova-no-users">Других пользователей пока нет. Зарегистрируйте второй аккаунт в новой вкладке.</div>
          ) : visibleUsers.length === 0 ? (
            <div className="mova-no-users">Пользователь не найден</div>
          ) : (
            visibleUsers.map((user) => {
              const active = selected.includes(user.id);
              return (
                <button type="button" key={user.id} className={active ? 'is-active' : ''} onClick={() => setSelected((items) => (kind === 'direct' ? [user.id] : active ? items.filter((id) => id !== user.id) : [...items, user.id]))}>
                  <Avatar name={user.name} src={user.avatarDataUrl} color={user.color} status={avatarStatus(user.presence)} size="sm" />
                  <span>
                    <strong><AppleEmoji text={user.name} /></strong>
                    <small>{user.handle}</small>
                  </span>
                  <i>{active && <Check size={14} />}</i>
                </button>
              );
            })
          )}
        </div>
        {error && <div className="mova-auth-error">{error}</div>}
        <footer>
          <span>{kind === 'group' && selected.length ? `${selected.length} ${russianCount(selected.length, 'участник', 'участника', 'участников')}` : ''}</span>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button loading={loading} disabled={!selected.length || (kind === 'group' && title.trim().length < 2)} onClick={create}>
            {kind === 'group' ? 'Создать' : 'Открыть чат'}
          </Button>
        </footer>
    </DialogSurface>
  );
}

function LegacyVoiceCallBar({ conversation, currentUser, onOpenSettings = () => window.dispatchEvent(new Event('mova-open-settings')) }: { conversation: AppConversation; currentUser: AppUser; onOpenSettings?: () => void }) {
  const call = useVoiceCall(conversation.id, currentUser.id);
  const callState = normalizeCallState(call.state);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showSelf, setShowSelf] = useState(true);
  const [showNoVideo, setShowNoVideo] = useState(true);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  const [screenQuality, setScreenQuality] = useState<ScreenShareQuality>({
    width: 1920,
    height: 1080,
    frameRate: 30,
  });
  if (callState === 'idle')
    return (
      <Button variant="secondary" size="sm" aria-label="Позвонить" leadingIcon={<Phone size={16} />} onClick={call.call}>
        Позвонить
      </Button>
    );
  if (callState === 'incoming')
    return (
      <div className="mova-call-bar incoming">
        <span className="mova-call-pulse">
          <i />
          <Phone size={15} />
        </span>
        <span>
          <strong>Входящий звонок</strong>
          <small>{call.incomingFrom?.name || conversation.title}</small>
        </span>
        <IconButton label="Принять звонок" className="mova-accept-call" onClick={call.accept}>
          <Phone size={17} />
        </IconButton>
        <IconButton label="Отклонить звонок" className="mova-hangup" onClick={call.decline}>
          <PhoneOff size={17} />
        </IconButton>
      </div>
    );
  const ringing = callState === 'ringing';
  if (isJoinedCallState(callState)) {
    const localCamera = call.cameraStream;
    const localScreen = call.screenStream;
    const selfConnectionState: ParticipantConnectionState = callState === 'reconnecting' || callState === 'disconnected' ? 'reconnecting' : 'connected';
    const participantConnectionState = (userId: string): ParticipantConnectionState => call.reconnectingUsers[userId] ? 'reconnecting' : call.diagnostics[userId]?.connectionState === 'connected' ? 'connected' : 'connecting';
    const remoteTiles = call.remoteVideoStreams.map((item) => ({
      ...item,
      kind: call.remoteMedia[item.userId]?.screen === item.streamId ? ('screen' as const) : ('camera' as const),
    }));
    const remoteWithVideo = new Set(remoteTiles.map((item) => item.userId));
    return (
      <section className="mova-call-stage">
        <header>
          <span>
            <strong><AppleEmoji text={conversation.title} /></strong>
            <small>Голосовой разговор</small>
          </span>
        </header>
        <div className="mova-call-grid">
          {localScreen && <CallVideoTile participantId={currentUser.id} stream={localScreen} label="Ваш экран" kind="screen" muted={call.muted} deafened={call.deafened} connectionState={selfConnectionState} screenSharing />}
          {showSelf && (localCamera ? <CallVideoTile participantId={currentUser.id} stream={localCamera} label={`${currentUser.name} · вы`} mirrored kind="camera" muted={call.muted} deafened={call.deafened} connectionState={selfConnectionState} screenSharing={Boolean(localScreen)} /> : !localScreen && <CallAvatarTile participantId={currentUser.id} user={currentUser} label={`${currentUser.name} · вы`} muted={call.muted} deafened={call.deafened} connectionState={selfConnectionState} />)}
          {remoteTiles.map((tile) => {
            const user = conversation.members.find((member) => member.id === tile.userId);
            const voice = call.remoteVoiceStates[tile.userId];
            return <CallVideoTile key={`${tile.userId}-${tile.streamId}`} participantId={tile.userId} stream={tile.stream} label={`${user?.name || 'Участник'}${tile.kind === 'screen' ? ' · экран' : ''}`} kind={tile.kind} muted={voice?.muted} deafened={voice?.deafened} connectionState={participantConnectionState(tile.userId)} screenSharing={Boolean(call.remoteMedia[tile.userId]?.screen)} />;
          })}
          {showNoVideo &&
            call.participants
              .filter((id) => !remoteWithVideo.has(id))
              .map((id) => {
                const user = conversation.members.find((member) => member.id === id);
                const voice = call.remoteVoiceStates[id];
                return user ? <CallAvatarTile key={id} participantId={id} user={user} label={user.name} muted={voice?.muted} deafened={voice?.deafened} connectionState={participantConnectionState(id)} screenSharing={Boolean(call.remoteMedia[id]?.screen)} /> : null;
              })}
        </div>
        <div className="mova-call-controls">
          <button type="button" className={call.muted ? 'is-off' : ''} onClick={call.toggleMute} aria-label={call.muted ? 'Включить микрофон' : 'Выключить микрофон'}>
            {call.muted ? <MicOff size={21} /> : <Mic size={21} />}
            <span>Микрофон</span>
          </button>
          <button type="button" className={localCamera ? 'is-on' : ''} onClick={() => void call.toggleCamera()} aria-label={localCamera ? 'Выключить камеру' : 'Включить камеру'}>
            {localCamera ? <Video size={21} /> : <VideoOff size={21} />}
            <span>Камера</span>
          </button>
          <button type="button" className={localScreen ? 'is-on' : ''} onClick={() => void call.toggleScreen()} aria-label={localScreen ? 'Остановить демонстрацию' : 'Показать экран'}>
            <MonitorUp size={21} />
            <span>Экран</span>
          </button>
          <button type="button" className={moreOpen ? 'is-on' : ''} onClick={() => setMoreOpen(!moreOpen)} aria-label="Дополнительно">
            <MoreHorizontal size={21} />
            <span>Ещё</span>
          </button>
          <button type="button" className="is-hangup" onClick={call.leave} aria-label="Завершить звонок">
            <PhoneOff size={22} />
            <span>Завершить</span>
          </button>
        </div>
        {moreOpen && (
          <div className="mova-call-more">
            <label>
              <span>Табличный вид</span>
              <input type="checkbox" checked readOnly />
              <i />
            </label>
            <label>
              <span>Показывать мою камеру</span>
              <input type="checkbox" checked={showSelf} onChange={(event) => setShowSelf(event.target.checked)} />
              <i />
            </label>
            <label>
              <span>Показывать участников без видео</span>
              <input type="checkbox" checked={showNoVideo} onChange={(event) => setShowNoVideo(event.target.checked)} />
              <i />
            </label>
            <button type="button" onClick={call.toggleDeafen}>
              {call.deafened ? <Headphones size={18} /> : <Volume2 size={18} />}
              <span>{call.deafened ? 'Включить входящий звук' : 'Выключить входящий звук'}</span>
              {call.deafened && <Check size={16} />}
            </button>
            <div />
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onOpenSettings();
              }}
            >
              <Settings size={18} />
              <span>Настройки голоса и видео</span>
            </button>
          </div>
        )}
        {call.error && <div className="mova-call-error">{call.error}</div>}
      </section>
    );
  }
  return (
    <div className={`mova-call-bar ${callState}`}>
      <span className="mova-call-pulse">
        <i />
        <Phone size={15} />
      </span>
      <span>
        <strong>{ringing ? 'Вызываем…' : callState === 'connecting' ? 'Подключаем…' : 'Голосовой звонок'}</strong>
        <small>{call.error || (ringing ? conversation.title : `${call.participants.length + 1} в разговоре`)}</small>
      </span>
      <IconButton label="Завершить звонок" className="mova-hangup" onClick={ringing ? call.decline : call.leave}>
        <PhoneOff size={17} />
      </IconButton>
    </div>
  );
}

const formatCallDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .slice(hours ? 0 : 1)
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
};

function CallControlButton({ label, active = false, off = false, danger = false, badge, onClick, children }: { label: string; active?: boolean; off?: boolean; danger?: boolean; badge?: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`${active ? 'is-on ' : ''}${off ? 'is-off ' : ''}${danger ? 'is-hangup' : ''}`.trim()}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-tooltip={label}
      data-control-state={danger ? 'danger' : off ? 'off' : active ? 'active' : 'default'}
      aria-pressed={danger ? undefined : active}
    >
      <span className="mova-call-control-icon" aria-hidden="true">{children}</span>
      {badge ? <b className="mova-call-chat-unread" aria-hidden="true">{badge}</b> : null}
    </button>
  );
}

const screenAudioWarningPrefix = 'Экран демонстрируется без звука.';
const screenAudioToastText = 'Демонстрация без звука. Включите «Поделиться аудио» при выборе экрана.';
const isScreenAudioWarning = (error: string) => error.startsWith(screenAudioWarningPrefix);
type VoiceCallController = ReturnType<typeof useVoiceCall>;

function VoiceCallBar({ conversation, callConversation, currentUser, call, canvasOpen, stageHost, bannerHost, chatOpen, unreadCount, onToggleChat, onOpenCanvas, onMinimizeCanvas, onStartCall, onOpenSettings = () => window.dispatchEvent(new Event('mova-open-settings')) }: { conversation: AppConversation; callConversation: AppConversation; currentUser: AppUser; call: VoiceCallController; canvasOpen: boolean; stageHost: HTMLElement | null; bannerHost: HTMLElement | null; chatOpen: boolean; unreadCount: number; onToggleChat: () => void; onOpenCanvas: () => void; onMinimizeCanvas: () => void; onStartCall: (video: boolean) => void; onOpenSettings?: () => void }) {
  const callState = normalizeCallState(call.state);
  const sameConversation = conversation.id === callConversation.id;
  const [moreOpen, setMoreOpen] = useState(false);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  const [showSelf, setShowSelf] = useState(true);
  const [showNoVideo, setShowNoVideo] = useState(true);
  const [participantRailVisible, setParticipantRailVisible] = useState(true);
  const [screenAudioToast, setScreenAudioToast] = useState('');
  const [screenAudioToastVisible, setScreenAudioToastVisible] = useState(false);
  const [screenQuality, setScreenQuality] = useState<ScreenShareQuality>(() => loadScreenShareSettings());
  const [activeSeconds, setActiveSeconds] = useState(0);
  const screenAudioToastSession = useRef<MediaStream | null>(null);
  const screenAudioToastShown = useRef(false);
  const screenAudioToastHideTimer = useRef<number | null>(null);
  const screenAudioToastRemoveTimer = useRef<number | null>(null);
  const clearScreenAudioToastTimers = useCallback(() => {
    if (screenAudioToastHideTimer.current !== null) window.clearTimeout(screenAudioToastHideTimer.current);
    if (screenAudioToastRemoveTimer.current !== null) window.clearTimeout(screenAudioToastRemoveTimer.current);
    screenAudioToastHideTimer.current = null;
    screenAudioToastRemoveTimer.current = null;
  }, []);
  useEffect(() => {
    const update = (event: Event) => setScreenQuality((event as CustomEvent<ScreenShareSettings>).detail || loadScreenShareSettings());
    window.addEventListener('mova-screen-share-settings', update);
    return () => window.removeEventListener('mova-screen-share-settings', update);
  }, []);
  useEffect(() => {
    if (!call.screenStream) setScreenMenuOpen(false);
  }, [call.screenStream]);
  useEffect(() => {
    const stream = call.screenStream;
    if (!stream) {
      clearScreenAudioToastTimers();
      screenAudioToastSession.current = null;
      screenAudioToastShown.current = false;
      setScreenAudioToastVisible(false);
      setScreenAudioToast('');
      return;
    }
    if (screenAudioToastSession.current !== stream) {
      clearScreenAudioToastTimers();
      screenAudioToastSession.current = stream;
      screenAudioToastShown.current = false;
      setScreenAudioToastVisible(false);
      setScreenAudioToast('');
    }
    if (!isScreenAudioWarning(call.error) || screenAudioToastShown.current) return;
    screenAudioToastShown.current = true;
    setScreenAudioToast(screenAudioToastText);
    setScreenAudioToastVisible(true);
    screenAudioToastHideTimer.current = window.setTimeout(() => {
      setScreenAudioToastVisible(false);
      screenAudioToastHideTimer.current = null;
      screenAudioToastRemoveTimer.current = window.setTimeout(() => {
        setScreenAudioToast('');
        screenAudioToastRemoveTimer.current = null;
      }, 190);
    }, 6_000);
  }, [call.error, call.screenStream, clearScreenAudioToastTimers]);
  useEffect(() => () => clearScreenAudioToastTimers(), [clearScreenAudioToastTimers]);
  useEffect(() => {
    if (!moreOpen && !screenMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (moreOpen && target?.closest?.('.mova-call-more,[aria-label="Дополнительно"]')) return;
      if (screenMenuOpen && target?.closest?.('.mova-screen-menu,[aria-label="Настроить демонстрацию"]')) return;
      setMoreOpen(false);
      setScreenMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        setScreenMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen, screenMenuOpen]);
  useEffect(() => {
    const timeSource = call.startedAt || call.createdAt;
    if (!timeSource || !['connected', 'reconnecting', 'disconnected', 'available', 'ringing', 'incoming'].includes(callState)) {
      setActiveSeconds(0);
      return;
    }
    const started = new Date(timeSource).getTime();
    const update = () => setActiveSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [call.createdAt, call.startedAt, callState]);
  if (!sameConversation)
    return (
      <Button variant="secondary" size="sm" aria-label="Позвонить" leadingIcon={<Phone size={16} />} onClick={() => onStartCall(false)}>
        Позвонить
      </Button>
    );
  if (callState === 'idle')
    return (
      <Button variant="secondary" size="sm" aria-label="Позвонить" leadingIcon={<Phone size={16} />} onClick={() => onStartCall(false)}>
        Позвонить
      </Button>
    );
  if (callState === 'available' && call.joined) return null;
  if (callState === 'available')
    return bannerHost
      ? createPortal(
          <section className="mova-active-call-banner" aria-label={`Активный звонок с ${callConversation.title}`}>
            <span className="mova-active-call-banner__details">
              <strong><AppleEmoji text={callConversation.title} /></strong>
              <small><i aria-hidden="true" />Звонок идёт · {formatCallDuration(activeSeconds)}</small>
            </span>
            {call.error && <small className="mova-active-call-banner__error">Не удалось подключить микрофон</small>}
            <button type="button" title={call.error || undefined} aria-label={call.error ? `Повторить подключение. ${call.error}` : 'Подключиться к звонку'} onClick={() => { onOpenCanvas(); void call.accept(); }}>
              <Phone size={16} />
              <span>{call.error ? 'Повторить' : 'Подключиться'}</span>
            </button>
          </section>,
          bannerHost,
        )
      : null;
  if (!isJoinedCallState(callState)) return stageHost ? createPortal(<PendingCallStage state={callState} conversation={callConversation} currentUser={currentUser} caller={call.incomingFrom} error={call.error} onAccept={call.accept} onEnd={callState === 'ringing' || callState === 'incoming' ? call.decline : call.leave} />, stageHost) : null;

  if (!canvasOpen)
    return (
      <Button variant="secondary" size="sm" aria-label="Вернуться в звонок" leadingIcon={<Phone size={16} />} onClick={onOpenCanvas}>
        Вернуться
      </Button>
    );

  if (isJoinedCallState(callState)) {
    const localCamera = call.cameraStream;
    const localScreen = call.screenStream;
    const remoteTiles = call.remoteVideoStreams.map((item) => ({
      ...item,
      kind: call.remoteMedia[item.userId]?.screen === item.streamId ? ('screen' as const) : ('camera' as const),
    }));
    const screenTiles = remoteTiles.filter((tile) => tile.kind === 'screen');
    const cameraTiles = remoteTiles.filter((tile) => tile.kind === 'camera');
    const cameraTileByUser = new Map(cameraTiles.map((item) => [item.userId, item]));
    const hasScreen = Boolean(localScreen || screenTiles.length);
    const peerDiagnostics = Object.values(call.diagnostics || {});
    const callConnected = peerDiagnostics.some((peer) => peer.connectionState === 'connected');
    const microphoneSending = peerDiagnostics.some((peer) => peer.outboundAudioBytes > 0);
    const microphoneReceiving = peerDiagnostics.some((peer) => peer.inboundAudioBytes > 0);
    const networkQuality = !peerDiagnostics.length ? 'unknown' : peerDiagnostics.some((peer) => peer.quality === 'poor') ? 'poor' : peerDiagnostics.some((peer) => peer.quality === 'fair') ? 'fair' : 'good';
    const latency = peerDiagnostics.reduce<number | undefined>((maximum, peer) => (peer.roundTripTimeMs === undefined ? maximum : Math.max(maximum ?? 0, peer.roundTripTimeMs)), undefined);
    const latencyLabel = latency === undefined ? 'Измеряем задержку…' : `Задержка ${latency} мс`;
    const networkLabel = networkQuality === 'good' ? '4 полосы' : networkQuality === 'fair' ? '3 полосы' : networkQuality === 'poor' ? '1 полоса' : 'нет данных';
    const participantConnectionState = (userId: string): ParticipantConnectionState => {
      if (call.reconnectingUsers[userId]) return 'reconnecting';
      const connectionState = call.diagnostics[userId]?.connectionState;
      if (connectionState === 'connected') return 'connected';
      if (connectionState === 'disconnected' || connectionState === 'failed' || connectionState === 'closed') return 'reconnecting';
      return 'connecting';
    };
    const selfConnectionState: ParticipantConnectionState = callState === 'reconnecting' || callState === 'disconnected' ? 'reconnecting' : 'connected';
    const remoteParticipantIds = Array.from(new Set([...call.participants, ...cameraTiles.map((tile) => tile.userId)]))
      .map((userId, snapshotIndex) => ({ userId, snapshotIndex, connectionState: participantConnectionState(userId) }))
      .sort((left, right) => {
        const priority = ({ userId, connectionState }: { userId: string; connectionState: ParticipantConnectionState }) =>
          connectionState !== 'reconnecting' && call.speakingUsers[userId] ? 0 : connectionState === 'connected' ? 1 : connectionState === 'connecting' ? 2 : 3;
        return priority(left) - priority(right) || left.snapshotIndex - right.snapshotIndex;
      });
    const remoteParticipantTiles: ReactNode[] = [];
    const selfTile = showSelf
      ? localCamera ? (
          <CallVideoTile key="local-camera" participantId={currentUser.id} stream={localCamera} label={`${currentUser.name} · вы`} mirrored kind="camera" muted={call.muted} deafened={call.deafened} speaking={call.localSpeaking && microphoneSending} connectionState={selfConnectionState} screenSharing={Boolean(localScreen)} selfView />
        ) : (
          <CallAvatarTile key="local-avatar" participantId={currentUser.id} user={currentUser} label={`${currentUser.name} · вы`} muted={call.muted} deafened={call.deafened} speaking={call.localSpeaking && microphoneSending} connectionState={selfConnectionState} screenSharing={Boolean(localScreen)} selfView />
        )
      : null;
    remoteParticipantIds.forEach(({ userId, connectionState }) => {
      const user = callConversation.members.find((member) => member.id === userId);
      const voice = call.remoteVoiceStates[userId];
      const cameraTile = cameraTileByUser.get(userId);
      const screenSharing = Boolean(call.remoteMedia[userId]?.screen);
      if (!user || (!cameraTile && !showNoVideo)) return;
      const sharedProps = {
        participantId: userId,
        label: user.name,
        muted: voice?.muted,
        deafened: voice?.deafened,
        speaking: call.speakingUsers[userId],
        connectionState,
        camera: Boolean(cameraTile),
        screenSharing,
        volume: {
          label: `Громкость ${user.name}`,
          value: call.participantVolumes[userId] ?? 100,
          onChange: (value: number) => call.setParticipantVolume(userId, value),
        },
      };
      remoteParticipantTiles.push(cameraTile ? (
        <CallVideoTile key={`${userId}-${cameraTile.streamId}`} {...sharedProps} stream={cameraTile.stream} kind="camera" />
      ) : (
        <CallAvatarTile key={userId} {...sharedProps} user={user} />
      ));
    });
    const participantTiles = [...remoteParticipantTiles, ...(selfTile ? [selfTile] : [])];
    const participantRailTiles = [...(selfTile ? [selfTile] : []), ...remoteParticipantTiles];

    return stageHost
      ? createPortal(
          <section className="mova-call-stage" data-call-connected={callConnected} data-audio-sending={microphoneSending} data-audio-receiving={microphoneReceiving}>
            <header>
              <IconButton label="Свернуть звонок" className="mova-call-minimize" onClick={onMinimizeCanvas}>
                <Minimize2 size={18} />
              </IconButton>
              <div className="mova-call-header-tools">
                <div className={`mova-network-quality is-${networkQuality}`} aria-label={`Качество соединения: ${networkLabel}. ${latencyLabel}`} data-tooltip={latencyLabel}>
                  <span className="mova-network-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
              <span>
                <strong>{callConversation.title}</strong>
                <small>{formatCallDuration(activeSeconds)} · голосовой разговор</small>
              </span>
            </header>
            {hasScreen ? (
              <div className={`mova-call-grid has-screen${participantRailVisible ? '' : ' is-rail-collapsed'}`} data-call-layout="screen-share" data-participant-count={participantTiles.length} data-participant-layout={participantTiles.length >= 5 ? 'many' : participantTiles.length} data-participant-rail={participantRailVisible ? 'visible' : 'hidden'}>
                <div className="mova-call-screen-area">
                  {localScreen && <CallVideoTile participantId={currentUser.id} stream={localScreen} label="Ваш экран" kind="screen" muted={call.muted} deafened={call.deafened} connectionState={selfConnectionState} screenSharing />}
                  {screenTiles.map((tile) => {
                    const user = callConversation.members.find((member) => member.id === tile.userId);
                    const voice = call.remoteVoiceStates[tile.userId];
                    return (
                      <CallVideoTile
                        key={`${tile.userId}-${tile.streamId}`}
                        stream={tile.stream}
                        participantId={tile.userId}
                        label={`${user?.name || 'Участник'} · экран`}
                        kind="screen"
                        muted={voice?.muted}
                        deafened={voice?.deafened}
                        connectionState={participantConnectionState(tile.userId)}
                        screenSharing
                        volume={
                          user
                            ? {
                                label: `Громкость демонстрации ${user.name}`,
                                value: call.screenVolumes[tile.userId] ?? 100,
                                onChange: (value) => call.setScreenVolume(tile.userId, value),
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
                <div className={`mova-call-participant-rail${participantRailVisible ? '' : ' is-collapsed'}`}>
                  <button
                    type="button"
                    className="mova-call-participant-rail-toggle"
                    aria-label={participantRailVisible ? 'Скрыть участников' : 'Показать участников'}
                    aria-expanded={participantRailVisible}
                    onClick={() => setParticipantRailVisible((visible) => !visible)}
                  >
                    {participantRailVisible ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                  </button>
                  <div className="mova-call-participants" aria-hidden={!participantRailVisible}>{participantRailTiles}</div>
                </div>
              </div>
            ) : (
              <div className="mova-call-grid is-participants" data-call-layout="participants" data-participant-count={participantTiles.length} data-participant-layout={participantTiles.length >= 5 ? 'many' : participantTiles.length}>
                <div className="mova-call-primary-participant">{participantTiles[0]}</div>
                {remoteParticipantTiles.length > 1 && <div className="mova-call-secondary-participants">{remoteParticipantTiles.slice(1)}</div>}
                {selfTile && remoteParticipantTiles.length > 0 && <div className="mova-call-self-view">{selfTile}</div>}
              </div>
            )}
            <div className="mova-call-controls">
              <CallControlButton label={call.muted ? 'Включить микрофон' : 'Выключить микрофон'} off={call.muted} onClick={call.toggleMute}>
                {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
              </CallControlButton>
              <CallControlButton label={call.deafened ? 'Включить звук в наушниках' : 'Выключить звук в наушниках'} off={call.deafened} onClick={call.toggleDeafen}>
                {call.deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
              </CallControlButton>
              <CallControlButton label={localCamera ? 'Выключить камеру' : 'Включить камеру'} active={Boolean(localCamera)} off={!localCamera} onClick={() => void call.toggleCamera()}>
                {localCamera ? <Video size={22} /> : <VideoOff size={22} />}
              </CallControlButton>
              <CallControlButton
                label={localScreen ? 'Настроить демонстрацию' : 'Показать экран'}
                active={Boolean(localScreen)}
                onClick={() => {
                  if (localScreen) {
                    setScreenMenuOpen((open) => !open);
                    setMoreOpen(false);
                  } else void call.shareScreen(screenQuality);
                }}
              >
                <MonitorUp size={22} />
              </CallControlButton>
              <CallControlButton
                label={chatOpen ? 'Закрыть чат' : unreadCount ? `Открыть чат, непрочитанных сообщений: ${unreadCount}` : 'Открыть чат'}
                active={chatOpen}
                badge={!chatOpen && unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined}
                onClick={onToggleChat}
              >
                <MessageCircle size={22} />
              </CallControlButton>
              <CallControlButton
                label="Дополнительно"
                active={moreOpen}
                onClick={() => {
                  setMoreOpen((open) => !open);
                  setScreenMenuOpen(false);
                }}
              >
                <MoreHorizontal size={22} />
              </CallControlButton>
              <CallControlButton label="Выйти из звонка" danger onClick={call.leave}>
                <PhoneOff size={23} />
              </CallControlButton>
            </div>
            {screenMenuOpen && localScreen && (
              <ScreenShareMenu
                quality={screenQuality}
                onQualityChange={setScreenQuality}
                onApply={() => {
                  void call.updateScreenQuality(screenQuality);
                  setScreenMenuOpen(false);
                }}
                onChangeWindow={() => {
                  void call.shareScreen(screenQuality);
                  setScreenMenuOpen(false);
                }}
                onStop={() => {
                  void call.stopScreen();
                  setScreenMenuOpen(false);
                }}
              />
            )}
            {moreOpen && (
              <div className="mova-call-more">
                <label>
                  <span>Табличный вид</span>
                  <input type="checkbox" checked readOnly />
                  <i />
                </label>
                <label>
                  <span>Показывать мою камеру</span>
                  <input type="checkbox" checked={showSelf} onChange={(event) => setShowSelf(event.target.checked)} />
                  <i />
                </label>
                <label>
                  <span>Показывать участников без видео</span>
                  <input type="checkbox" checked={showNoVideo} onChange={(event) => setShowNoVideo(event.target.checked)} />
                  <i />
                </label>
                <button type="button" onClick={call.toggleDeafen}>
                  {call.deafened ? <Headphones size={18} /> : <Volume2 size={18} />}
                  <span>{call.deafened ? 'Включить входящий звук' : 'Выключить входящий звук'}</span>
                  {call.deafened && <Check size={16} />}
                </button>
                <div />
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenSettings();
                  }}
                >
                  <Settings size={18} />
                  <span>Настройки голоса и видео</span>
                </button>
              </div>
            )}
            {call.error && !isScreenAudioWarning(call.error) && <div className="mova-call-error">{call.error}</div>}
            {screenAudioToast && (
              <div className={`mova-call-toast${screenAudioToastVisible ? ' is-visible' : ' is-hiding'}`} role="status" aria-live="polite">
                {screenAudioToast}
              </div>
            )}
          </section>,
          stageHost,
        )
      : null;
  }
}

export function PendingCallStage({ state, conversation, currentUser, caller, error, onAccept, onEnd }: { state: 'ringing' | 'incoming' | 'connecting' | 'error'; conversation: AppConversation; currentUser: AppUser; caller: AppUser | null; error?: string; onAccept: () => void; onEnd: () => void }) {
  const other = conversation.members.find((member) => member.id !== currentUser.id);
  const person = state === 'incoming' ? caller || other : other;
  const incoming = state === 'incoming';
  const title = incoming ? person?.name || conversation.title : conversation.title;
  const eyebrow = incoming ? 'Входящий звонок' : state === 'ringing' ? 'Исходящий звонок' : state === 'connecting' ? 'Подключение' : 'Не удалось позвонить';
  const description = error || (incoming ? (conversation.kind === 'group' && person ? `${person.name} звонит в «${conversation.title}»` : 'Ответьте, чтобы начать разговор') : state === 'ringing' ? (conversation.kind === 'group' ? 'Ждём ответа участников…' : `Ждём, когда ${person?.name || 'собеседник'} ответит…`) : state === 'connecting' ? 'Собеседник ответил. Устанавливаем соединение…' : 'Попробуйте позвонить ещё раз');
  const meta = conversation.kind === 'direct' ? person?.handle : `${Math.max(1, conversation.members.length - 1)} ${conversation.members.length - 1 === 1 ? 'собеседник' : 'собеседника'}`;

  return (
    <section className={`mova-call-stage mova-call-pending is-${state}`} aria-live="polite" aria-label={eyebrow}>
      <header>
        <span>
          <strong>Голосовой звонок</strong>
          <small>{conversation.kind === 'group' ? conversation.title : 'Mova'}</small>
        </span>
      </header>
      <div className="mova-call-pending__content">
        <div className="mova-call-pending__avatar">
          <i aria-hidden="true" />
          {person ? <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} size="xl" initialsLength={1} /> : <ConversationAvatar conversation={conversation} currentUser={currentUser} />}
          <span>
            <Phone size={20} />
          </span>
        </div>
        <span className="mova-call-pending__status">
          <i aria-hidden="true" />
          {eyebrow}
        </span>
        <h1><AppleEmoji text={title} /></h1>
        {meta && <small>{meta}</small>}
        <p>{description}</p>
      </div>
      <div className="mova-call-pending__actions">
        {incoming && (
          <button type="button" className="is-accept" onClick={onAccept}>
            <span className="mova-call-action-icon"><Phone size={25} /></span>
            <span>Принять</span>
          </button>
        )}
        <button type="button" className="is-decline" onClick={onEnd}>
          <span className="mova-call-action-icon"><PhoneOff size={25} /></span>
          <span>{incoming ? 'Отклонить' : state === 'error' ? 'Закрыть' : 'Отменить'}</span>
        </button>
      </div>
    </section>
  );
}

function ScreenShareMenu({ quality, onQualityChange, onApply, onChangeWindow, onStop }: { quality: ScreenShareQuality; onQualityChange: (quality: ScreenShareQuality) => void; onApply: () => void; onChangeWindow: () => void; onStop: () => void }) {
  const resolution = `${quality.width}x${quality.height}`;
  return (
    <div className="mova-screen-menu" role="dialog" aria-label="Настройки демонстрации">
      <header>
        <strong>Демонстрация экрана</strong>
        <small>Настройте качество или выберите другое окно</small>
      </header>
      <div className="mova-screen-quality">
        <label>
          <span>Разрешение</span>
          <select
            value={resolution}
            onChange={(event) => {
              const [width, height] = event.target.value.split('x').map(Number);
              onQualityChange({ ...quality, width, height });
            }}
          >
            <option value="1280x720">720p</option>
            <option value="1920x1080">1080p</option>
            <option value="2560x1440">1440p</option>
          </select>
        </label>
        <label>
          <span>FPS</span>
          <select
            value={quality.frameRate}
            onChange={(event) =>
              onQualityChange({
                ...quality,
                frameRate: Number(event.target.value),
              })
            }
          >
            <option value={15}>15</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={onApply}>
        Применить качество
      </button>
      <button type="button" onClick={onChangeWindow}>
        Сменить окно
      </button>
      <div />
      <button type="button" className="is-danger" onClick={onStop}>
        Выключить демонстрацию
      </button>
    </div>
  );
}

interface CallVolumeControl {
  label: string;
  value: number;
  onChange: (value: number) => void;
}
function CallVolumeMenu({ control, point, onClose }: { control: CallVolumeControl; point: { x: number; y: number }; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [onClose]);
  const left = Math.min(point.x, Math.max(12, window.innerWidth - 286));
  const top = Math.min(point.y, Math.max(12, window.innerHeight - 116));
  return createPortal(
    <div ref={menuRef} className="mova-call-volume-menu" role="menu" aria-label={control.label} style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <span>
        <Volume2 size={17} />
        {control.label}
        <b>{control.value}%</b>
      </span>
      <input aria-label={control.label} type="range" min="0" max="200" step="1" value={control.value} onChange={(event) => control.onChange(Number(event.target.value))} />
      <small>ПКМ по плитке открывает эту настройку</small>
    </div>,
    document.body,
  );
}
const screenAspectRatioFallback = 16 / 10;
type ParticipantConnectionState = 'connecting' | 'connected' | 'reconnecting';
const participantConnectionLabels: Record<ParticipantConnectionState, string> = {
  connecting: 'Подключается',
  connected: 'Подключён',
  reconnecting: 'Переподключается',
};
const validMediaAspectRatio = (value: number) => Number.isFinite(value) && value >= 0.2 && value <= 5;
const streamAspectRatio = (stream: MediaStream) => {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const ratio = Number(settings?.aspectRatio) || (Number(settings?.width) / Number(settings?.height));
  return validMediaAspectRatio(ratio) ? ratio : screenAspectRatioFallback;
};
function CallTileShell({ className, participantId, label, muted, deafened, screen = false, screenSharing = false, speaking = false, connectionState, expandable = true, expanded, onExpandedChange, volume, mediaAspectRatio, children }: { className: string; participantId: string; label: string; muted?: boolean; deafened?: boolean; screen?: boolean; screenSharing?: boolean; speaking?: boolean; connectionState: ParticipantConnectionState; expandable?: boolean; expanded: boolean; onExpandedChange: (expanded: boolean) => void; volume?: CallVolumeControl; mediaAspectRatio?: number; children: ReactNode }) {
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [expandedUiVisible, setExpandedUiVisible] = useState(true);
  const [expandedClosing, setExpandedClosing] = useState(false);
  const autohideTimer = useRef<number | null>(null);
  const expandedCloseTimer = useRef<number | null>(null);
  const mobileCallLayout = typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 760px)').matches ?? false);
  const coarsePointer = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const clearAutohide = useCallback(() => {
    if (autohideTimer.current !== null) window.clearTimeout(autohideTimer.current);
    autohideTimer.current = null;
  }, []);
  const clearExpandedClose = useCallback(() => {
    if (expandedCloseTimer.current !== null) window.clearTimeout(expandedCloseTimer.current);
    expandedCloseTimer.current = null;
  }, []);
  const requestExpandedChange = useCallback((nextExpanded: boolean) => {
    clearExpandedClose();
    if (!nextExpanded && expanded && !reducedMotion) {
      setExpandedClosing(true);
      expandedCloseTimer.current = window.setTimeout(() => {
        setExpandedClosing(false);
        onExpandedChange(false);
        expandedCloseTimer.current = null;
      }, 190);
      return;
    }
    setExpandedClosing(false);
    onExpandedChange(nextExpanded);
  }, [clearExpandedClose, expanded, onExpandedChange, reducedMotion]);
  const scheduleAutohide = useCallback(() => {
    clearAutohide();
    if (!expanded || expandedClosing || coarsePointer) return;
    autohideTimer.current = window.setTimeout(() => {
      const openMenu = document.querySelector('.mova-call-more,.mova-screen-menu,.mova-call-volume-menu');
      const interactiveSurfaces = Array.from(document.querySelectorAll('.mova-call-controls,.mova-call-more,.mova-screen-menu,.mova-call-volume-menu,.mova-call-chat-header,.mova-real-composer'));
      if (openMenu || interactiveSurfaces.some((surface) => surface.contains(document.activeElement) || surface.matches(':hover'))) {
        scheduleAutohide();
        return;
      }
      setExpandedUiVisible(false);
      autohideTimer.current = null;
    }, 2_800);
  }, [clearAutohide, coarsePointer, expanded, expandedClosing]);
  const revealExpandedUi = useCallback(() => {
    if (!expanded) return;
    setExpandedUiVisible(true);
    scheduleAutohide();
  }, [expanded, scheduleAutohide]);
  useEffect(() => {
    if (!expanded) return;
    setExpandedUiVisible(true);
    scheduleAutohide();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestExpandedChange(false);
      else revealExpandedUi();
    };
    const handlePointerMove = () => revealExpandedUi();
    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as Element).closest('.mova-call-controls,.mova-call-more,.mova-screen-menu,.mova-call-volume-menu,.mova-call-chat-header,.mova-real-composer')) revealExpandedUi();
    };
    window.addEventListener('keydown', handleKey);
    if (!coarsePointer) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerdown', handlePointerDown);
    }
    return () => {
      clearAutohide();
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [clearAutohide, coarsePointer, expanded, requestExpandedChange, revealExpandedUi, scheduleAutohide]);
  useEffect(() => () => clearExpandedClose(), [clearExpandedClose]);
  const fullscreenLabel = expanded ? 'Закрыть полноэкранный режим' : screen ? 'Открыть демонстрацию на весь экран' : `Открыть ${label} на весь экран`;
  const openMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!volume) return;
    event.preventDefault();
    setMenuPoint({ x: event.clientX, y: event.clientY });
  };
  const tile = (
    <article
      className={`mova-call-tile ${className} ${speaking && !muted ? 'is-speaking' : ''} ${expanded ? `is-expanded ${expandedUiVisible ? 'is-ui-visible' : 'is-ui-hidden'}${expandedClosing ? ' is-exiting' : ''}` : ''}`}
      style={screen && mediaAspectRatio ? { '--mova-call-source-ratio': mediaAspectRatio } as CSSProperties : undefined}
      role={screen ? 'button' : undefined}
      tabIndex={screen ? 0 : undefined}
      aria-label={screen ? fullscreenLabel : undefined}
      data-speaking={speaking && !muted ? 'true' : undefined}
      data-participant-id={participantId}
      data-participant-connection={connectionState}
      data-self-view={className.includes('is-self') ? 'true' : undefined}
      data-source-aspect-ratio={screen && mediaAspectRatio ? String(mediaAspectRatio) : undefined}
      data-expanded-ui={expanded ? (expandedUiVisible ? 'visible' : 'hidden') : undefined}
      data-expanded-motion={expanded ? (reducedMotion ? 'reduced' : 'animated') : undefined}
      onClick={(event) => {
        if (!screen || !expandable || (event.target as Element).closest('button')) return;
        requestExpandedChange(!expanded);
      }}
      onDoubleClick={() => !screen && expandable && requestExpandedChange(!expanded)}
      onKeyDown={(event) => {
        if (screen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          requestExpandedChange(!expanded);
        }
      }}
      onContextMenu={openMenu}
      onFocusCapture={revealExpandedUi}
      onPointerDown={(event) => {
        if (screen || !expanded || (!coarsePointer && event.pointerType !== 'touch') || (event.target as Element).closest('button')) return;
        clearAutohide();
        setExpandedUiVisible((visible) => !visible);
      }}
    >
      {children}
      {connectionState !== 'connected' && (
        <span className={`mova-call-participant-state is-${connectionState}`} aria-label={participantConnectionLabels[connectionState]} title={participantConnectionLabels[connectionState]}>
          <i aria-hidden="true" />
          <b>{participantConnectionLabels[connectionState]}</b>
        </span>
      )}
      {expandable && !screen && (
        <button type="button" className="mova-call-fullscreen" aria-label={fullscreenLabel} onClick={() => requestExpandedChange(!expanded)}>
          {expanded ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </button>
      )}
      <CallTileLabel label={label} muted={muted} deafened={deafened} screen={screen} screenSharing={screenSharing} />
      {menuPoint && volume && <CallVolumeMenu control={volume} point={menuPoint} onClose={() => setMenuPoint(null)} />}
    </article>
  );
  return expanded && !mobileCallLayout ? createPortal(tile, document.body) : tile;
}
function CallVideoTile({ participantId, stream, label, kind, mirrored = false, muted, deafened, speaking = false, connectionState, screenSharing = false, selfView = false, volume }: { participantId: string; stream: MediaStream; label: string; kind: 'camera' | 'screen'; mirrored?: boolean; muted?: boolean; deafened?: boolean; speaking?: boolean; connectionState: ParticipantConnectionState; screenSharing?: boolean; selfView?: boolean; volume?: CallVolumeControl }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [sourceAspectRatio, setSourceAspectRatio] = useState(() => kind === 'screen' ? streamAspectRatio(stream) : undefined);
  const syncSourceAspectRatio = useCallback(() => {
    if (kind !== 'screen') return;
    const video = videoRef.current;
    const ratio = video && video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : streamAspectRatio(stream);
    setSourceAspectRatio(validMediaAspectRatio(ratio) ? ratio : screenAspectRatioFallback);
  }, [kind, stream]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
    syncSourceAspectRatio();
  }, [stream, expanded, syncSourceAspectRatio]);
  return (
    <CallTileShell className={`has-video is-${kind}${selfView ? ' is-self' : ''}`} participantId={participantId} label={label} muted={muted} deafened={deafened} screen={kind === 'screen'} screenSharing={screenSharing || kind === 'screen'} speaking={speaking} connectionState={connectionState} expandable={!selfView} expanded={expanded} onExpandedChange={setExpanded} volume={volume} mediaAspectRatio={sourceAspectRatio}>
      <video ref={videoRef} autoPlay playsInline muted className={mirrored ? 'is-mirrored' : ''} onLoadedMetadata={syncSourceAspectRatio} onResize={syncSourceAspectRatio} />
    </CallTileShell>
  );
}
function CallAvatarTile({ participantId, user, label, muted = false, deafened = false, speaking = false, connectionState, screenSharing = false, selfView = false, volume }: { participantId: string; user: AppUser; label: string; muted?: boolean; deafened?: boolean; speaking?: boolean; connectionState: ParticipantConnectionState; screenSharing?: boolean; selfView?: boolean; volume?: CallVolumeControl }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <CallTileShell className={`is-avatar${selfView ? ' is-self' : ''}`} participantId={participantId} label={label} muted={muted} deafened={deafened} screenSharing={screenSharing} speaking={speaking} connectionState={connectionState} expandable={!selfView} expanded={expanded} onExpandedChange={setExpanded} volume={volume}>
      <Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="xl" initialsLength={1} />
    </CallTileShell>
  );
}
function CallTileLabel({ label, muted, deafened, screen, screenSharing }: { label: string; muted?: boolean; deafened?: boolean; screen?: boolean; screenSharing?: boolean }) {
  const hasStatus = Boolean(muted || deafened || screen || screenSharing);
  return (
    <span className="mova-call-label">
      {hasStatus && (
        <span className="mova-call-label__statuses">
          {muted && <MicOff size={14} aria-label="Микрофон выключен" />}
          {deafened && <HeadphoneOff size={14} aria-label="Звук выключен" />}
          {(screen || screenSharing) && <MonitorUp size={14} aria-label="Демонстрация экрана включена" />}
        </span>
      )}
      {label}
    </span>
  );
}

interface RealMessagesProps {
  conversation: AppConversation;
  currentUser: AppUser;
  messages: AppMessage[];
  loading?: boolean;
  historyError?: boolean;
  typingUserIds?: string[];
  mobileActive?: boolean;
  onMobileBack?: () => void;
  onCallOpenChange?: (open: boolean) => void;
  onSend: (content: string, attachment?: MessageAttachment, replyToId?: string) => Promise<void>;
  onRetry?: (message: AppMessage) => Promise<void>;
  onRetryHistory?: () => void;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDeleteConversation?: () => void;
}

interface RealMessagesViewProps extends RealMessagesProps {
  voiceSession: VoiceCallController;
  voiceConversation: AppConversation;
  callCanvasOpen: boolean;
  onOpenCallCanvas: () => void;
  onMinimizeCallCanvas: () => void;
  onStartCall: (video: boolean) => void;
}

function RealMessagesView({ conversation, currentUser, messages, loading = false, historyError = false, typingUserIds = [], mobileActive = true, onMobileBack, onCallOpenChange, voiceSession, voiceConversation, callCanvasOpen, onOpenCallCanvas, onMinimizeCallCanvas, onStartCall, onSend, onRetry, onRetryHistory, onEdit, onDeleteConversation = () => undefined }: RealMessagesViewProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [profileInfoOpen, setProfileInfoOpen] = useState(false);
  const [, setPresenceTick] = useState(0);
  const [muted, setMuted] = useState(() => localStorage.getItem(`mova-muted-${conversation.id}`) === 'true');
  const [blocked, setBlocked] = useState(() => localStorage.getItem(`mova-blocked-${conversation.id}`) === 'true');
  const [selectingMessages, setSelectingMessages] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachment, setAttachment] = useState<MessageAttachment | undefined>();
  const [attachmentError, setAttachmentError] = useState('');
  const retryingMessagesRef = useRef(new Set<string>());
  const [retryingMessageIds, setRetryingMessageIds] = useState<Set<string>>(() => new Set());
  const [replyingTo, setReplyingTo] = useState<AppMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<AppMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: AppMessage; x: number; y: number } | null>(null);
  const [replyHighlightId, setReplyHighlightId] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [imagePreviewId, setImagePreviewId] = useState<string | null>(null);
  const [callStageHost, setCallStageHost] = useState<HTMLElement | null>(null);
  const [callBannerHost, setCallBannerHost] = useState<HTMLElement | null>(null);
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [callChatUnread, setCallChatUnread] = useState(0);
  const [callChatWidth, setCallChatWidth] = useState(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('mova-call-chat-width');
    const saved = stored === null ? NaN : Number(stored);
    return Number.isFinite(saved) ? Math.min(720, Math.max(320, saved)) : 420;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const composerSelection = useRef({ start: 0, end: 0 });
  const threadRef = useRef<HTMLElement>(null);
  const threadHeaderRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const messagesContainer = useRef<HTMLDivElement>(null);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const previousMessageCount = useRef(0);
  const positionedAtBottom = useRef(false);
  const dragDepth = useRef(0);
  const typingStopTimer = useRef<number | null>(null);
  const typingActive = useRef(false);
  const lastTypingSentAt = useRef(0);
  const replyHighlightTimer = useRef<number | null>(null);
  const replyScrollAnimation = useRef<number | null>(null);
  const knownCallMessageIds = useRef(new Set(messages.map((message) => message.id)));
  const other = conversation.members.find((member) => member.id !== currentUser.id);
  const messageStructure = useMemo(() => getMessageStructure(messages), [messages]);
  const mediaGallery = useMemo(() => buildMediaGallery(messages), [messages]);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchingMessages = useMemo(() => (normalizedSearch ? messages.filter((message) => message.content.toLocaleLowerCase().includes(normalizedSearch) || message.attachment?.name.toLocaleLowerCase().includes(normalizedSearch)).reverse() : []), [messages, normalizedSearch]);
  const activeMatchId = matchingMessages[activeMatchIndex]?.id || matchingMessages[0]?.id;
  const matchCount = matchingMessages.length;
  const status = conversation.kind === 'direct' ? formatPresenceStatus(other) : `${conversation.members.length} участников`;
  const typingLabel = conversationTypingLabel(conversation, currentUser.id, typingUserIds);
  const voiceState = normalizeCallState(voiceSession.state);
  const callOpen = callCanvasOpen && voiceConversation.id === conversation.id && voiceState !== 'idle' && voiceState !== 'available';

  useEffect(() => {
    if (mobileActive) return;
    setSearchOpen(false);
    setSearchQuery('');
    setDetailsOpen(false);
    setProfileInfoOpen(false);
    setEmojiOpen(false);
    setMessageMenu(null);
    setImagePreviewId(null);
  }, [mobileActive]);

  const announceTyping = useCallback(
    (active: boolean) => {
      if (typingStopTimer.current !== null) window.clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
      if (active) {
        const now = Date.now();
        if (!typingActive.current || now - lastTypingSentAt.current >= 3_000) {
          realtime.send({ type: 'typing', conversationId: conversation.id, active: true });
          lastTypingSentAt.current = now;
        }
        typingActive.current = true;
        typingStopTimer.current = window.setTimeout(() => announceTyping(false), 2_500);
      } else if (typingActive.current) {
        typingActive.current = false;
        realtime.send({ type: 'typing', conversationId: conversation.id, active: false });
      }
    },
    [conversation.id],
  );

  useEffect(
    () => () => {
      if (typingStopTimer.current !== null) window.clearTimeout(typingStopTimer.current);
      if (typingActive.current) realtime.send({ type: 'typing', conversationId: conversation.id, active: false });
      typingActive.current = false;
    },
    [conversation.id],
  );

  useEffect(() => {
    if (!messageMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMessageMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [messageMenu]);

  useLayoutEffect(() => {
    const input = composerInput.current;
    if (!input) return;
    input.style.height = '0px';
    const height = Math.min(120, Math.max(44, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [value, editingMessage]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    const header = threadHeaderRef.current;
    const composer = composerRef.current;
    if (!thread || !header || !composer) return;
    const updateOverlayMetrics = () => {
      const threadRect = thread.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      thread.style.setProperty('--mova-chat-header-overlay-height', `${Math.max(0, headerRect.bottom - threadRect.top)}px`);
      thread.style.setProperty('--mova-chat-composer-overlay-height', `${Math.max(0, threadRect.bottom - composerRect.top)}px`);
    };
    updateOverlayMetrics();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateOverlayMetrics);
    observer.observe(thread);
    observer.observe(header);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  const rememberComposerSelection = () => {
    const input = composerInput.current;
    if (!input) return;
    composerSelection.current = {
      start: input.selectionStart ?? value.length,
      end: input.selectionEnd ?? value.length,
    };
  };

  const closeEmojiPicker = (restoreFocus = false) => {
    setEmojiOpen(false);
    if (restoreFocus) window.setTimeout(() => emojiButton.current?.focus(), 0);
  };

  const insertEmoji = (selectedEmoji: string) => {
    const { start, end } = composerSelection.current;
    const safeStart = Math.min(value.length, Math.max(0, start));
    const safeEnd = Math.min(value.length, Math.max(safeStart, end));
    const nextValue = `${value.slice(0, safeStart)}${selectedEmoji}${value.slice(safeEnd)}`;
    const nextCursor = safeStart + selectedEmoji.length;
    setValue(nextValue);
    composerSelection.current = { start: nextCursor, end: nextCursor };
    if (!editingMessage) announceTyping(true);
    window.setTimeout(() => {
      const input = composerInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  const replyToMessage = (message: AppMessage) => {
    setMessageMenu(null);
    setReplyingTo(message);
    setEditingMessage(null);
    setValue('');
    window.setTimeout(() => composerInput.current?.focus(), 0);
  };
  const editOwnMessage = (message: AppMessage) => {
    setMessageMenu(null);
    setEditingMessage(message);
    setReplyingTo(null);
    setAttachment(undefined);
    setValue(message.content);
    window.setTimeout(() => {
      const input = composerInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(message.content.length, message.content.length);
    }, 0);
  };

  const jumpToMessage = useCallback((messageId: string) => {
    const messageElement = messageElements.current.get(messageId);
    const container = messagesContainer.current;
    if (!messageElement || !container) return;
    if (replyScrollAnimation.current !== null) window.cancelAnimationFrame(replyScrollAnimation.current);
    if (replyHighlightTimer.current !== null) window.clearTimeout(replyHighlightTimer.current);
    setReplyHighlightId(messageId);
    replyHighlightTimer.current = window.setTimeout(() => {
      setReplyHighlightId(null);
      replyHighlightTimer.current = null;
    }, 2_200);
    const containerRect = container.getBoundingClientRect();
    const messageRect = messageElement.getBoundingClientRect();
    const start = container.scrollTop;
    const target = Math.max(0, start + messageRect.top - containerRect.top - (container.clientHeight - messageRect.height) / 2);
    const distance = target - start;
    if (Math.abs(distance) < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      container.scrollTop = target;
      return;
    }
    const startedAt = performance.now();
    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / 190);
      const eased = 1 - (1 - progress) ** 3;
      container.scrollTop = start + distance * eased;
      if (progress < 1) replyScrollAnimation.current = window.requestAnimationFrame(animate);
      else replyScrollAnimation.current = null;
    };
    replyScrollAnimation.current = window.requestAnimationFrame(animate);
  }, []);

  useEffect(
    () => () => {
      if (replyHighlightTimer.current !== null) window.clearTimeout(replyHighlightTimer.current);
      if (replyScrollAnimation.current !== null) window.cancelAnimationFrame(replyScrollAnimation.current);
    },
    [],
  );

  useEffect(() => {
    if (!searchOpen && !detailsOpen && !profileInfoOpen && !emojiOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (searchOpen && target.closest('.mova-chat-search-panel,[aria-label="Поиск"]')) return;
      if (detailsOpen && target.closest('.mova-chat-actions-menu,[aria-label="Подробнее"]')) return;
      if (profileInfoOpen && target.closest('.mova-contact-info,.mova-chat-identity')) return;
      if (emojiOpen && target.closest('.mova-emoji-picker,[aria-label="Эмодзи"]')) return;
      setSearchOpen(false);
      setDetailsOpen(false);
      setProfileInfoOpen(false);
      closeEmojiPicker();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (emojiOpen) {
        event.stopPropagation();
        setEmojiOpen(false);
        window.setTimeout(() => emojiButton.current?.focus(), 0);
        return;
      }
      setSearchOpen(false);
      setDetailsOpen(false);
      setProfileInfoOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailsOpen, emojiOpen, profileInfoOpen, searchOpen]);

  useEffect(() => {
    if (conversation.kind !== 'direct' || (other?.isOnline ?? other?.presence === 'online')) return;
    const timer = window.setInterval(() => setPresenceTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [conversation.kind, other?.id, other?.isOnline, other?.presence]);

  const send = async () => {
    const content = value.trim();
    if ((!content && !attachment) || (editingMessage && sending)) return;
    setSendError('');
    announceTyping(false);
    if (!editingMessage) {
      const outgoingAttachment = attachment;
      const replyToId = replyingTo?.id;
      setValue('');
      setAttachment(undefined);
      setReplyingTo(null);
      setEmojiOpen(false);
      try {
        await onSend(content, outgoingAttachment, replyToId);
      } catch (sendFailure) {
        setSendError(sendFailure instanceof Error ? sendFailure.message : 'Не удалось отправить сообщение');
      }
      return;
    }
    setSending(true);
    try {
      if (!onEdit) return;
      await onEdit(editingMessage.id, content);
      setEditingMessage(null);
      setValue('');
      setEmojiOpen(false);
    } catch (sendFailure) {
      setSendError(sendFailure instanceof Error ? sendFailure.message : 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };
  const retryFailedMessage = async (message: AppMessage) => {
    if (!onRetry || message.deliveryState !== 'failed') return;
    const retryId = message.clientId || message.id;
    if (retryingMessagesRef.current.has(retryId)) return;
    retryingMessagesRef.current.add(retryId);
    setRetryingMessageIds((items) => new Set(items).add(retryId));
    setSendError('');
    try {
      await onRetry(message);
    } catch (retryFailure) {
      setSendError(retryFailure instanceof Error ? retryFailure.message : 'Не удалось повторить отправку');
    } finally {
      retryingMessagesRef.current.delete(retryId);
      setRetryingMessageIds((items) => {
        const next = new Set(items);
        next.delete(retryId);
        return next;
      });
    }
  };
  const chooseFile = async (file?: File) => {
    if (!file) return;
    setAttachmentError('');
    if (file.size > (file.type.startsWith('image/') ? 30_000_000 : 8_000_000)) return setAttachmentError(file.type.startsWith('image/') ? 'Фотография должна быть меньше 30 МБ' : 'Файл должен быть меньше 8 МБ');
    try {
      const clipboardName = `Изображение ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }).replace(':', '-')}.png`;
      const prepared = file.type.startsWith('image/') ? await prepareImageDataUrl(file) : { file, dataUrl: await fileToDataUrl(file) };
      if (prepared.file.size > 8_000_000) return setAttachmentError('После обработки файл всё ещё больше 8 МБ');
      setAttachment({
        name: prepared.file.name || clipboardName,
        type: prepared.file.type || 'application/octet-stream',
        size: prepared.file.size,
        dataUrl: prepared.dataUrl,
      });
    } catch {
      setAttachmentError('Не удалось прочитать файл');
    }
  };
  const pasteFile = (event: ClipboardEvent) => {
    const file =
      Array.from(event.clipboardData.items)
        .find((item) => item.kind === 'file')
        ?.getAsFile() || event.clipboardData.files[0];
    if (!file) return;
    event.preventDefault();
    void chooseFile(file);
  };
  const enterFile = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingFile(true);
  };
  const leaveFile = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDraggingFile(false);
  };
  const dropFile = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFile(false);
    void chooseFile(event.dataTransfer.files[0]);
  };
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [normalizedSearch]);
  useEffect(() => {
    onCallOpenChange?.(callOpen);
  }, [callOpen, onCallOpenChange]);
  useEffect(() => {
    if (!callOpen) {
      setCallChatOpen(false);
      setCallChatUnread(0);
    } else {
      setSearchOpen(false);
      setDetailsOpen(false);
      setProfileInfoOpen(false);
    }
  }, [callOpen]);
  useEffect(() => {
    const incoming = messages.filter((message) => !knownCallMessageIds.current.has(message.id) && message.authorId !== currentUser.id);
    messages.forEach((message) => knownCallMessageIds.current.add(message.id));
    if (callOpen && !callChatOpen && incoming.length) setCallChatUnread((count) => count + incoming.length);
  }, [messages, currentUser.id, callOpen, callChatOpen]);
  useEffect(() => {
    if (callChatOpen) setCallChatUnread(0);
  }, [callChatOpen]);
  useEffect(() => {
    setProfileInfoOpen(false);
    setDetailsOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
    setValue('');
    setAttachment(undefined);
    setAttachmentError('');
    setSendError('');
    setReplyingTo(null);
    setEditingMessage(null);
    setEmojiOpen(false);
    setImagePreviewId(null);
    composerSelection.current = { start: 0, end: 0 };
    setMuted(localStorage.getItem(`mova-muted-${conversation.id}`) === 'true');
    setBlocked(localStorage.getItem(`mova-blocked-${conversation.id}`) === 'true');
    positionedAtBottom.current = false;
    previousMessageCount.current = 0;
  }, [conversation.id]);
  useEffect(() => {
    if (!profileInfoOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileInfoOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [profileInfoOpen]);
  useEffect(() => {
    if (!activeMatchId) return;
    const match = messageElements.current.get(activeMatchId);
    if (match && typeof match.scrollIntoView === 'function') match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeMatchId]);
  useEffect(() => {
    const messageCount = messages.length;
    const ownMessageAdded = messageCount > previousMessageCount.current && messages.at(-1)?.authorId === currentUser.id;
    if (messageCount && (!positionedAtBottom.current || ownMessageAdded)) {
      const container = messagesContainer.current;
      if (container) {
        if (typeof container.scrollTo === 'function')
          container.scrollTo({
            top: container.scrollHeight,
            behavior: positionedAtBottom.current ? 'smooth' : 'auto',
          });
        else container.scrollTop = container.scrollHeight;
      }
      positionedAtBottom.current = true;
    }
    previousMessageCount.current = messageCount;
  }, [messages, currentUser.id]);

  const showOlderMatch = () => setActiveMatchIndex((index) => Math.min(matchCount - 1, index + 1));
  const showNewerMatch = () => setActiveMatchIndex((index) => Math.max(0, index - 1));
  const resizeCallChat = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = callChatWidth;
    const maxWidth = Math.max(320, Math.min(720, (threadRef.current?.clientWidth || 1020) - 300));
    document.body.classList.add('mova-is-resizing-call-chat');
    const nextWidth = (clientX: number) => Math.min(maxWidth, Math.max(320, startWidth + startX - clientX));
    const move = (moveEvent: PointerEvent) => setCallChatWidth(nextWidth(moveEvent.clientX));
    const stop = (upEvent: PointerEvent) => {
      const width = nextWidth(upEvent.clientX);
      setCallChatWidth(width);
      window.localStorage.setItem('mova-call-chat-width', String(width));
      document.body.classList.remove('mova-is-resizing-call-chat');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const nudgeCallChat = (amount: number) =>
    setCallChatWidth((width) => {
      const next = Math.min(720, Math.max(320, width + amount));
      window.localStorage.setItem('mova-call-chat-width', String(next));
      return next;
    });
  const startCall = (video: boolean) => {
    setDetailsOpen(false);
    onStartCall(video);
  };
  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(`mova-muted-${conversation.id}`, String(next));
    setDetailsOpen(false);
  };
  const toggleBlocked = () => {
    const next = !blocked;
    setBlocked(next);
    localStorage.setItem(`mova-blocked-${conversation.id}`, String(next));
    setDetailsOpen(false);
  };

  return (
    <section ref={threadRef} className={`mova-real-thread mova-open-chat ${callOpen ? 'is-in-call' : ''} ${callOpen && callChatOpen ? 'is-call-chat-open' : ''} ${draggingFile ? 'is-file-dragging' : ''}`} style={{ '--mova-call-chat-width': `${callChatWidth}px` } as CSSProperties} aria-hidden={!mobileActive} inert={!mobileActive ? true : undefined} onDragEnter={enterFile} onDragOver={(event) => event.preventDefault()} onDragLeave={leaveFile} onDrop={dropFile}>
      {draggingFile && (
        <div className="mova-file-drop-overlay">
          <Upload size={28} />
          <strong>Отпустите, чтобы прикрепить</strong>
          <span>Изображение или файл до 8 МБ</span>
        </div>
      )}
      <header ref={threadHeaderRef} className="mova-real-thread__header">
        {onMobileBack && (
          <IconButton label="К списку диалогов" className="mova-mobile-chat-back" onClick={onMobileBack}>
            <ArrowLeft size={23} />
          </IconButton>
        )}
        <button
          type="button"
          className="mova-chat-identity"
          aria-label={`Открыть информацию о ${conversation.title}`}
          aria-expanded={profileInfoOpen}
          onClick={() => {
            setProfileInfoOpen(true);
            setDetailsOpen(false);
            setSearchOpen(false);
          }}
        >
          <ConversationAvatar conversation={conversation} currentUser={currentUser} />
          <span>
            <span className="mova-chat-identity__name">
              <strong><AppleEmoji text={conversation.title} /></strong>
              {muted && <BellOff size={15} aria-label="Уведомления выключены" />}
            </span>
            <small>{status}</small>
          </span>
        </button>
        <div>
          <VoiceCallBar
            conversation={conversation}
            callConversation={voiceConversation}
            currentUser={currentUser}
            call={voiceSession}
            canvasOpen={callCanvasOpen}
            stageHost={callStageHost}
            bannerHost={callBannerHost}
            chatOpen={callChatOpen}
            unreadCount={callChatUnread}
            onToggleChat={() => setCallChatOpen((open) => !open)}
            onOpenCanvas={onOpenCallCanvas}
            onMinimizeCanvas={onMinimizeCallCanvas}
            onStartCall={onStartCall}
          />
          <IconButton
            label="Поиск"
            className={searchOpen ? 'is-active' : ''}
            onClick={() => {
              setSearchOpen((open) => !open);
              setDetailsOpen(false);
              setProfileInfoOpen(false);
            }}
          >
            <Search size={18} />
          </IconButton>
          <IconButton
            label="Подробнее"
            className={detailsOpen ? 'is-active' : ''}
            onClick={() => {
              setDetailsOpen((open) => !open);
              setSearchOpen(false);
              setProfileInfoOpen(false);
            }}
          >
            <MoreVertical size={24} />
          </IconButton>
        </div>
      </header>
      <div ref={setCallBannerHost} className="mova-active-call-host" />
      {profileInfoOpen && (
        <aside className="mova-contact-info" aria-label={`Информация о ${conversation.title}`}>
          <header>
            <IconButton label="Закрыть информацию" onClick={() => setProfileInfoOpen(false)}>
              <X size={25} />
            </IconButton>
            <h2>Информация</h2>
          </header>
          <section className="mova-contact-info__profile">
            <ConversationAvatar conversation={conversation} currentUser={currentUser} />
            <h3><AppleEmoji text={conversation.title} /></h3>
            <p>{status}</p>
          </section>
          <section className="mova-contact-info__card">
            {conversation.kind === 'direct' && (
              <div className="mova-message-body">
                <AtSign size={25} />
                <span>
                  <strong>{other?.handle?.replace(/^@/, '') || 'не указан'}</strong>
                  <small>Имя пользователя</small>
                </span>
              </div>
            )}
            <div>
              <Info size={25} />
              <span>
                <strong>{conversation.kind === 'direct' ? other?.bio || 'Информация о себе не указана' : `${conversation.members.length} участников`}</strong>
                <small>{conversation.kind === 'direct' ? 'О себе' : 'Участники'}</small>
              </span>
            </div>
            <label>
              <Bell size={25} />
              <span>
                <strong>Уведомления</strong>
                <small>{muted ? 'Выключены' : 'Включены'}</small>
              </span>
              <input type="checkbox" checked={!muted} onChange={toggleMuted} aria-label="Уведомления" />
              <i />
            </label>
          </section>
        </aside>
      )}
      <div ref={setCallStageHost} className="mova-call-host" />
      {callOpen && callChatOpen && (
        <div
          className="mova-call-chat-resizer"
          role="separator"
          aria-label="Изменить ширину чата звонка"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={720}
          aria-valuenow={Math.round(callChatWidth)}
          tabIndex={0}
          onPointerDown={resizeCallChat}
          onDoubleClick={() => {
            setCallChatWidth(420);
            window.localStorage.setItem('mova-call-chat-width', '420');
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              nudgeCallChat(16);
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              nudgeCallChat(-16);
            }
          }}
        >
          <i />
        </div>
      )}
      {callOpen && callChatOpen && (
        <header className="mova-call-chat-header">
          <MessageCircle size={20} />
          <span>
            <strong><AppleEmoji text={conversation.title} /></strong>
            <small>Чат звонка</small>
          </span>
          <IconButton label="Закрыть чат" onClick={() => setCallChatOpen(false)}>
            <X size={19} />
          </IconButton>
        </header>
      )}
      {searchOpen && (
        <div className="mova-chat-search-panel">
          <Search size={17} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearchOpen(false);
              if (event.key === 'Enter' && matchCount) {
                event.preventDefault();
                event.shiftKey ? showNewerMatch() : showOlderMatch();
              }
              if (event.key === 'ArrowUp' && matchCount) {
                event.preventDefault();
                showOlderMatch();
              }
              if (event.key === 'ArrowDown' && matchCount) {
                event.preventDefault();
                showNewerMatch();
              }
            }}
            placeholder="Поиск в переписке"
            aria-label="Поиск в переписке"
          />
          <span aria-live="polite">{normalizedSearch ? (matchCount ? `${Math.min(activeMatchIndex + 1, matchCount)} из ${matchCount}` : 'Не найдено') : 'Введите запрос'}</span>
          <IconButton label="К более старому сообщению" disabled={!matchCount || activeMatchIndex >= matchCount - 1} onClick={showOlderMatch}>
            <ChevronUp size={17} />
          </IconButton>
          <IconButton label="К более новому сообщению" disabled={!matchCount || activeMatchIndex === 0} onClick={showNewerMatch}>
            <ChevronDown size={17} />
          </IconButton>
          <IconButton
            label="Закрыть поиск"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery('');
            }}
          >
            <X size={17} />
          </IconButton>
        </div>
      )}
      <PopoverSurface open={detailsOpen} className="mova-chat-actions-menu" ariaLabel="Действия с чатом">
          <button type="button" role="menuitem" onClick={toggleMuted}>
            <BellOff size={22} />
            <span>{muted ? 'Включить уведомления' : 'Выключить уведомления'}</span>
            {muted && <Check size={17} />}
          </button>
          <button type="button" role="menuitem" onClick={() => startCall(false)}>
            <Phone size={22} />
            <span>Позвонить</span>
          </button>
          <button type="button" role="menuitem" onClick={() => startCall(true)}>
            <Video size={22} />
            <span>Видеозвонок</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setSelectingMessages(true);
              setSelectedMessages([]);
              setDetailsOpen(false);
            }}
          >
            <CheckCheck size={22} />
            <span>Выбрать сообщения</span>
          </button>
          <div />
          <button type="button" role="menuitem" onClick={toggleBlocked}>
            <Ban size={22} />
            <span>{blocked ? 'Разблокировать' : 'Заблокировать'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setDetailsOpen(false);
              setDeleteConfirmOpen(true);
            }}
          >
            <Trash2 size={22} />
            <span>Удалить чат</span>
          </button>
      </PopoverSurface>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Удалить чат?"
        description={`Чат «${conversation.title}» исчезнет из списка. Это действие нельзя отменить.`}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          onDeleteConversation();
        }}
      />
      {selectingMessages && (
        <div className="mova-message-selection-bar">
          <button
            type="button"
            onClick={() => {
              setSelectingMessages(false);
              setSelectedMessages([]);
            }}
            aria-label="Завершить выбор"
          >
            <X size={19} />
          </button>
          <strong>{selectedMessages.length ? `Выбрано: ${selectedMessages.length}` : 'Выберите сообщения'}</strong>
        </div>
      )}
      <div className="mova-real-messages" ref={messagesContainer}>
        <div className="mova-real-thread-intro">
          <ConversationAvatar conversation={conversation} currentUser={currentUser} />
          <h1><AppleEmoji text={conversation.title} /></h1>
          <p>{conversation.kind === 'direct' ? `Это начало вашей переписки${other ? ` с ${other.name}` : ''}.` : 'Группа создана. Можно начинать разговор.'}</p>
        </div>
        {historyError && (
          <div className="mova-message-history-error" role="status">
            <span>Не удалось загрузить сообщения</span>
            <button type="button" disabled={loading} onClick={onRetryHistory}>Повторить</button>
          </div>
        )}
        {loading && messages.length === 0 ? <MessageListSkeleton /> : messages.map((message, index) => {
          const structure = messageStructure[index];
          const messageKey = message.clientId || message.id;
          const daySeparator = structure.startsDay ? (
            <div className="mova-message-day-separator" role="separator" aria-label={structure.dayLabel}>
              <time dateTime={structure.dayKey}>{structure.dayLabel}</time>
            </div>
          ) : null;
          const matches = Boolean(normalizedSearch && (message.content.toLocaleLowerCase().includes(normalizedSearch) || message.attachment?.name.toLocaleLowerCase().includes(normalizedSearch)));
          if (message.kind === 'call')
            return (
              <Fragment key={messageKey}>
                {daySeparator}
                <article
                  ref={(element) => {
                    if (element) messageElements.current.set(message.id, element);
                    else messageElements.current.delete(message.id);
                  }}
                  className={`mova-call-system-message ${matches ? 'is-search-match' : ''} ${message.id === activeMatchId ? 'is-active-search-match' : ''}`}
                >
                  <span aria-hidden="true"><PhoneCall size={17} /></span>
                  <span>
                    <strong>Звонок завершён</strong>
                    <small>Длительность {formatCallDuration(message.call?.durationSeconds || 0)}</small>
                  </span>
                  <time>{new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>
                </article>
              </Fragment>
            );
          const own = message.authorId === currentUser.id;
          const grouped = !structure.startsGroup;
          const continuesGroup = !structure.endsGroup;
          const showGroupAvatarSlot = conversation.kind === 'group' && !own;
          const imageAttachment = Boolean(message.attachment?.type.startsWith('image/'));
          const imageCaption = imageAttachment && Boolean(message.content.trim() || message.replyTo);
          const selectedForAction = selectedMessages.includes(message.id);
          return (
            <Fragment key={messageKey}>
              {daySeparator}
              <article
                ref={(element) => {
                  if (element) messageElements.current.set(message.id, element);
                  else messageElements.current.delete(message.id);
                }}
                className={`mova-real-message ${own ? 'is-own' : ''} ${grouped ? 'is-grouped' : 'is-group-start'} ${continuesGroup ? '' : 'is-group-end'} ${message.deliveryState === 'sending' ? 'is-sending' : message.deliveryState === 'failed' ? 'is-failed' : ''} ${matches ? 'is-search-match' : ''} ${message.id === activeMatchId ? 'is-active-search-match' : ''} ${message.id === replyHighlightId ? 'is-reply-target' : ''} ${selectingMessages ? 'is-selectable' : ''} ${selectedForAction ? 'is-selected' : ''}`}
                onClick={selectingMessages ? () => setSelectedMessages((items) => (selectedForAction ? items.filter((id) => id !== message.id) : [...items, message.id])) : undefined}
                onContextMenu={(event) => {
                  if (selectingMessages) return;
                  event.preventDefault();
                  const width = 194;
                  const height = own && onEdit ? 100 : 54;
                  setMessageMenu({
                    message,
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
                  });
                }}
              >
                {selectingMessages && <span className="mova-message-selector">{selectedForAction && <Check size={14} />}</span>}
                {showGroupAvatarSlot && (
                  <span className="mova-message-avatar-slot">
                    {structure.endsGroup && <Avatar name={message.author.name} src={message.author.avatarDataUrl} color={message.author.color} size="sm" />}
                  </span>
                )}
                <div className="mova-message-body">
                  {showGroupAvatarSlot && structure.startsGroup && <strong><AppleEmoji text={message.author.name} /></strong>}
                  <div className={`mova-real-bubble${message.replyTo ? ' has-reply' : ''}${message.attachment && !imageAttachment ? ' has-file' : ''}${imageAttachment ? ` has-image ${imageCaption ? 'has-caption' : 'is-image-only'}` : ''}`}>
                  {message.replyTo && (
                    <button
                      type="button"
                      className="mova-message-reply"
                      onClick={() => jumpToMessage(message.replyTo?.id || '')}
                      aria-label={`Перейти к сообщению ${message.replyTo.author.name}`}
                    >
                      {message.replyTo.attachment?.type.startsWith('image/') && <img src={attachmentSource(message.replyTo.attachment)} alt="" />}
                      <span>
                        <strong><AppleEmoji text={message.replyTo.author.name} /></strong>
                        <small><AppleEmoji text={message.replyTo.content || message.replyTo.attachmentName || 'Вложение'} /></small>
                      </span>
                    </button>
                  )}
                  {message.attachment &&
                    (message.attachment.type.startsWith('image/') ? (
                      <button type="button" className="mova-message-image" onClick={() => setImagePreviewId(message.id)} aria-label={`Открыть изображение ${message.attachment.name}`}>
                        <CachedImage
                          src={attachmentSource(message.attachment)}
                          alt={message.attachment.name}
                          onLoad={() => {
                            if (!positionedAtBottom.current) return;
                            window.requestAnimationFrame(() => {
                              const container = messagesContainer.current;
                              if (container) container.scrollTop = container.scrollHeight;
                            });
                          }}
                        />
                      </button>
                    ) : (
                      <a className="mova-message-file" href={attachmentSource(message.attachment)} download={message.attachment.name}>
                        <FileText size={20} />
                        <span>
                          <strong>{message.attachment.name}</strong>
                          <small>{Math.max(1, Math.round(message.attachment.size / 1024))} КБ</small>
                        </span>
                      </a>
                    ))}
                  {message.content && <p className={isEmojiOnlyText(message.content) ? 'mova-message-emoji-only' : undefined}><MessageText text={message.content} /></p>}
                  <span className={`mova-message-meta${own ? ' is-own' : ''}`}>
                    {message.editedAt && <span className="mova-message-edited">изменено</span>}
                    <time>
                      {new Intl.DateTimeFormat('ru', {
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(message.createdAt))}
                    </time>
                    {own && (
                      <MessageStatus
                        message={message}
                        conversation={conversation}
                        retrying={retryingMessageIds.has(message.clientId || message.id)}
                        onRetry={message.deliveryState === 'failed' && onRetry && !selectingMessages ? () => void retryFailedMessage(message) : undefined}
                      />
                    )}
                  </span>
                  </div>
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>
      <form
        ref={composerRef}
        className="mova-real-composer"
        onPaste={pasteFile}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className={`mova-real-typing${typingLabel ? '' : ' is-empty'}`} role="status" aria-live="polite" aria-hidden={typingLabel ? undefined : 'true'}>
          <span aria-hidden="true"><i /><i /><i /></span>
          <strong>{typingLabel || 'Никто не печатает'}</strong>
        </div>
        <div className="mova-composer-panel">
          {(replyingTo || editingMessage) && (
            <div className={`mova-composer-context mova-composer-context__preview${editingMessage ? ' is-editing' : ' is-replying'}`}>
              <span className="mova-composer-row__icon" aria-hidden="true">{editingMessage ? <Pencil size={17} /> : <Reply size={17} />}</span>
              {!editingMessage && replyingTo?.attachment?.type.startsWith('image/') && <img src={attachmentSource(replyingTo.attachment)} alt="" />}
              <span className="mova-composer-row__copy">
                <strong>{editingMessage ? 'Редактирование сообщения' : `В ответ ${replyingTo?.author.name}`}</strong>
                <small><AppleEmoji text={(editingMessage || replyingTo)?.content || (editingMessage || replyingTo)?.attachment?.name || 'Вложение'} /></small>
              </span>
              <button type="button" className="mova-composer-row__remove" aria-label={editingMessage ? 'Отменить редактирование' : 'Отменить ответ'} onClick={() => { setEditingMessage(null); setReplyingTo(null); setValue(''); }}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {attachment && (
            <div className="mova-attachment-draft">
              <span className="mova-composer-row__icon">
                {attachment.type.startsWith('image/') ? <img src={attachmentSource(attachment)} alt="" /> : <FileText size={17} aria-hidden="true" />}
              </span>
              <span className="mova-composer-row__copy">
                <strong><AppleEmoji text={attachment.name} /></strong>
                <small>{Math.max(1, Math.round(attachment.size / 1024))} КБ</small>
              </span>
              <button type="button" className="mova-composer-row__remove" aria-label="Убрать вложение" onClick={() => setAttachment(undefined)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="mova-composer-input-row">
            <input ref={fileInput} type="file" hidden onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
            <IconButton label="Прикрепить файл" disabled={Boolean(editingMessage)} onClick={() => fileInput.current?.click()}>
              <Paperclip size={19} aria-hidden="true" />
            </IconButton>
            <textarea
              ref={composerInput}
              rows={1}
              value={value}
              disabled={blocked}
              onChange={(event) => {
                setValue(event.target.value);
                composerSelection.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
                if (!editingMessage) announceTyping(Boolean(event.target.value.trim()));
              }}
              onSelect={rememberComposerSelection}
              onClick={rememberComposerSelection}
              onKeyUp={rememberComposerSelection}
              onBlur={() => { rememberComposerSelection(); announceTyping(false); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && emojiOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeEmojiPicker(true);
                  return;
                }
                if (event.key === 'Escape' && (editingMessage || replyingTo)) {
                  event.preventDefault();
                  setEditingMessage(null);
                  setReplyingTo(null);
                  setValue('');
                  return;
                }
                if (event.key === 'ArrowUp' && !value && !editingMessage && !replyingTo && !attachment && onEdit) {
                  const latestEditableMessage = [...messages].reverse().find((message) => message.authorId === currentUser.id && message.kind !== 'call' && Boolean(message.content.trim()));
                  if (latestEditableMessage) {
                    event.preventDefault();
                    editOwnMessage(latestEditableMessage);
                    return;
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              aria-label={`Сообщение в ${conversation.title}`}
              placeholder={blocked ? 'Пользователь заблокирован' : editingMessage ? 'Измените сообщение…' : 'Сообщение...'}
            />
            <IconButton
              ref={emojiButton}
              label="Эмодзи"
              className={emojiOpen ? 'is-active' : ''}
              aria-haspopup="dialog"
              aria-expanded={emojiOpen}
              onPointerDown={rememberComposerSelection}
              onClick={() => setEmojiOpen((open) => !open)}
            >
              <Smile size={19} aria-hidden="true" />
            </IconButton>
            <button className="mova-composer-send" type="submit" aria-label={editingMessage ? 'Сохранить изменения' : 'Отправить'} disabled={(!value.trim() && !attachment) || Boolean(editingMessage && sending)}>
              <Send size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {emojiOpen && <EmojiPicker onSelect={insertEmoji} onClose={() => closeEmojiPicker(true)} />}
        <div className="mova-composer-errors" aria-live="polite">
          {attachmentError && <span className="mova-attachment-error">{attachmentError}</span>}
          {sendError && <span className="mova-send-error" role="alert">{sendError}</span>}
        </div>
      </form>
      {imagePreviewId && mediaGallery.some((item) => item.id === imagePreviewId) &&
        createPortal(
          <MediaViewer items={mediaGallery} activeId={imagePreviewId} onClose={() => setImagePreviewId(null)} />,
          document.body,
        )}
      {createPortal(
          <div className="mova-message-context-layer" style={{ pointerEvents: messageMenu ? 'auto' : 'none' }} onPointerDown={() => setMessageMenu(null)} onContextMenu={(event) => event.preventDefault()}>
            <PopoverSurface open={Boolean(messageMenu)} className="mova-message-context-menu" ariaLabel="Действия с сообщением" style={messageMenu ? { left: messageMenu.x, top: messageMenu.y } : undefined}>
              <button type="button" role="menuitem" onClick={() => messageMenu && replyToMessage(messageMenu.message)}>
                <Reply size={16} />
                <span>Ответить</span>
              </button>
              {messageMenu?.message.authorId === currentUser.id && onEdit && (
                <button type="button" role="menuitem" onClick={() => messageMenu && editOwnMessage(messageMenu.message)}>
                  <Pencil size={15} />
                  <span>Редактировать</span>
                </button>
              )}
            </PopoverSurface>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function RealMessages(props: RealMessagesProps) {
  const [voiceConversation, setVoiceConversation] = useState(props.conversation);
  const [callCanvasOpen, setCallCanvasOpen] = useState(true);
  const startWithCamera = useRef(false);
  const pendingStart = useRef<{ conversation: AppConversation; video: boolean } | null>(null);
  const voiceSession = useVoiceCall(voiceConversation.id, props.currentUser.id);
  const voiceState = normalizeCallState(voiceSession.state);
  useEffect(() => {
    if (voiceState === 'idle' && voiceConversation.id !== props.conversation.id) setVoiceConversation(props.conversation);
  }, [props.conversation, voiceConversation.id, voiceState]);
  useEffect(() => {
    const pending = pendingStart.current;
    if (!pending || pending.conversation.id !== voiceConversation.id || voiceState !== 'idle') return;
    pendingStart.current = null;
    startWithCamera.current = pending.video;
    setCallCanvasOpen(true);
    voiceSession.call();
  }, [voiceConversation.id, voiceSession, voiceState]);
  useEffect(() => {
    if (voiceState === 'connected' && startWithCamera.current && !voiceSession.cameraStream) {
      startWithCamera.current = false;
      void voiceSession.toggleCamera();
    }
  }, [voiceSession, voiceState]);
  const startCall = (video: boolean) => {
    if (voiceState !== 'idle') return;
    if (voiceConversation.id === props.conversation.id) {
      startWithCamera.current = video;
      setCallCanvasOpen(true);
      voiceSession.call();
      return;
    }
    pendingStart.current = { conversation: props.conversation, video };
    setVoiceConversation(props.conversation);
  };
  return (
    <RealMessagesView
      {...props}
      voiceSession={voiceSession}
      voiceConversation={voiceConversation}
      callCanvasOpen={callCanvasOpen}
      onOpenCallCanvas={() => setCallCanvasOpen(true)}
      onMinimizeCallCanvas={() => setCallCanvasOpen(false)}
      onStartCall={startCall}
    />
  );
}

const voiceDockStateLabel = (state: ReturnType<typeof normalizeCallState>) =>
  state === 'connecting'
    ? 'Подключение…'
    : state === 'connected'
      ? 'Подключено'
      : state === 'reconnecting'
        ? 'Переподключение…'
        : 'Соединение потеряно';

export function VoiceDock({ conversation, call, onReturn }: { conversation: AppConversation; call: VoiceCallController; onReturn: () => void }) {
  const state = normalizeCallState(call.state);
  const displayedState = state === 'available' ? 'disconnected' : state;
  return (
    <section className={`mova-voice-dock is-${displayedState}`} aria-label={`Активный звонок с ${conversation.title}`} data-call-state={displayedState}>
      <button type="button" className="mova-voice-dock__summary" onClick={onReturn} aria-label={`Вернуться в звонок с ${conversation.title}`}>
        <span className="mova-voice-dock__icon" aria-hidden="true"><PhoneCall size={18} /></span>
        <span>
          <strong><AppleEmoji text={conversation.title} /></strong>
          <small>{voiceDockStateLabel(displayedState)}</small>
        </span>
      </button>
      <div className="mova-voice-dock__controls">
        <IconButton label={call.muted ? 'Включить микрофон' : 'Выключить микрофон'} className={call.muted ? 'is-off' : ''} onClick={call.toggleMute}>
          {call.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </IconButton>
        <IconButton label={call.deafened ? 'Включить звук в наушниках' : 'Выключить звук в наушниках'} className={call.deafened ? 'is-off' : ''} onClick={call.toggleDeafen}>
          {call.deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
        </IconButton>
        <IconButton label="Вернуться в звонок" onClick={onReturn}>
          <Maximize2 size={17} />
        </IconButton>
        <IconButton label="Выйти из звонка" className="is-disconnect" onClick={call.leave}>
          <PhoneOff size={18} />
        </IconButton>
      </div>
    </section>
  );
}

export function Product({ currentUser, onUserUpdate, onLogout }: { currentUser: AppUser; onUserUpdate: (user: AppUser) => void; onLogout: () => void }) {
  const SIDEBAR_COMPACT_WIDTH = 76;
  const SIDEBAR_MIN_WIDTH = 260;
  const SIDEBAR_MAX_WIDTH = 560;
  const SIDEBAR_COLLAPSE_THRESHOLD = 220;
  const initialConversations = conversationCache.get(currentUser.id)?.value || [];
  const initialSelectedId = preferredConversation(initialConversations);
  const initialVoiceConversationId = sessionStorage.getItem('mova-active-call') || sessionStorage.getItem('mova-pending-call') || initialSelectedId;
  const [conversations, setConversations] = useState<AppConversation[]>(initialConversations);
  const [users, setUsers] = useState<AppUser[]>(userCache.get(currentUser.id)?.value || []);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<AppMessage[]>(() => (initialSelectedId ? messageCache.get(messageCacheKey(currentUser.id, initialSelectedId))?.value || [] : []));
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(!isFresh(conversationCache.get(currentUser.id)) || !isFresh(userCache.get(currentUser.id)));
  const [messagesLoading, setMessagesLoading] = useState(() => Boolean(initialSelectedId && !isFresh(messageCache.get(messageCacheKey(currentUser.id, initialSelectedId)))));
  const [messagesErrorFor, setMessagesErrorFor] = useState<string | null>(null);
  const [messagesLoadAttempt, setMessagesLoadAttempt] = useState(0);
  const [backgroundColor, setBackgroundColor] = useState(loadBackgroundColor);
  const [accentColor, setAccentColor] = useState(loadAccentColor);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [voiceConversationId, setVoiceConversationId] = useState<string | null>(initialVoiceConversationId);
  const [callCanvasOpen, setCallCanvasOpen] = useState(Boolean(sessionStorage.getItem('mova-pending-call')));
  const [query, setQuery] = useState('');
  const mobileNavigation = useMobileNavigationViewport();
  const [mobileView, setMobileView] = useState<MobileNavigationView>(() =>
    sessionStorage.getItem('mova-pending-call') ? 'chat' : 'list',
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('mova-sidebar-width');
    const saved = stored === null ? NaN : Number(stored);
    return Number.isFinite(saved) ? (saved < 220 ? 76 : Math.min(560, Math.max(260, saved))) : 360;
  });
  const sidebarCompact = sidebarWidth === SIDEBAR_COMPACT_WIDTH;
  const voiceSession = useVoiceCall(voiceConversationId, currentUser.id);
  const voiceState = normalizeCallState(voiceSession.state);
  const voiceConversation = conversations.find((conversation) => conversation.id === voiceConversationId) || null;
  const voiceDockVisible = Boolean(voiceConversation && !callCanvasOpen && (isJoinedCallState(voiceState) || (voiceState === 'available' && voiceSession.joined)));
  const toast = useToast();
  const resolveSidebarWidth = (rawWidth: number) => (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD ? SIDEBAR_COMPACT_WIDTH : Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, rawWidth)));
  const currentUserRef = useRef(currentUser);
  const conversationsRef = useRef(conversations);
  const selectedIdRef = useRef(selectedId);
  const lastActivity = useRef(Date.now());
  const markingReadThrough = useRef<string | null>(null);
  const typingExpiryTimers = useRef(new Map<string, number>());
  const overviewSyncInFlight = useRef<Promise<void> | null>(null);
  const realtimeReadyCount = useRef(0);
  const retryingClientIds = useRef(new Set<string>());
  const notifiedRealtimeMessageIds = useRef(new Set<string>());
  const pendingCallStart = useRef<{ conversationId: string; video: boolean } | null>(null);
  const startCallWithCamera = useRef(false);
  const voiceStateRef = useRef(voiceState);
  const voiceConversationIdRef = useRef(voiceConversationId);
  const mobileNavigationRef = useRef(mobileNavigation);
  const mobileViewRef = useRef(mobileView);
  const mobileCallOpenRef = useRef(false);
  const mobileCallConversationRef = useRef<string | null>(sessionStorage.getItem('mova-pending-call'));
  const productOverlayOpenRef = useRef(false);
  const edgeSwipeRef = useRef<{ source: 'touch' | 'pointer'; id: number; x: number; y: number; startedAt: number } | null>(null);
  currentUserRef.current = currentUser;
  conversationsRef.current = conversations;
  selectedIdRef.current = selectedId;
  voiceStateRef.current = voiceState;
  voiceConversationIdRef.current = voiceConversationId;
  mobileNavigationRef.current = mobileNavigation;
  mobileViewRef.current = mobileView;
  productOverlayOpenRef.current = createOpen || profileOpen || settingsOpen || accountOpen;
  const setMobileNavigationView = useCallback((view: MobileNavigationView) => {
    mobileViewRef.current = view;
    setMobileView(view);
  }, []);
  const closeProductOverlays = useCallback(() => {
    setCreateOpen(false);
    setProfileOpen(false);
    setSettingsOpen(false);
    setAccountOpen(false);
    productOverlayOpenRef.current = false;
  }, []);
  const showMobileConversation = useCallback((conversationId: string, mode: 'auto' | 'push' | 'replace' = 'auto') => {
    if (!mobileNavigationRef.current) return;
    const currentHistory = readMobileHistory();
    const historyMode = mode === 'auto' ? (mobileViewRef.current === 'chat' || currentHistory?.view === 'chat' ? 'replace' : 'push') : mode;
    const nextState = mobileHistoryState('chat', conversationId);
    if (historyMode === 'replace') window.history.replaceState(nextState, '');
    else window.history.pushState(nextState, '');
    setMobileNavigationView('chat');
  }, [setMobileNavigationView]);
  const restoreMobileChatAfterBack = useCallback(() => {
    const conversationId = mobileCallConversationRef.current || selectedIdRef.current;
    if (!conversationId) return;
    showMobileConversation(conversationId, 'push');
  }, [showMobileConversation]);
  const navigateToMobileList = useCallback(() => {
    if (!mobileNavigationRef.current || mobileViewRef.current !== 'chat') return;
    if (mobileCallOpenRef.current) return;
    const currentHistory = readMobileHistory();
    if (currentHistory?.view === 'chat') window.history.back();
    else {
      window.history.replaceState(mobileHistoryState('list'), '');
      setMobileNavigationView('list');
    }
  }, [setMobileNavigationView]);
  const handleMobileCallOpenChange = useCallback((open: boolean) => {
    mobileCallOpenRef.current = open;
    if (open) {
      const conversationId = selectedIdRef.current;
      if (conversationId) {
        mobileCallConversationRef.current = conversationId;
        showMobileConversation(conversationId);
      }
      return;
    }
    mobileCallConversationRef.current = null;
  }, [showMobileConversation]);
  useEffect(() => {
    if (!mobileNavigation) {
      edgeSwipeRef.current = null;
      return;
    }
    const pendingCallConversation = sessionStorage.getItem('mova-pending-call');
    if (pendingCallConversation) {
      mobileCallConversationRef.current = pendingCallConversation;
      setSelectedId(pendingCallConversation);
      showMobileConversation(pendingCallConversation, 'replace');
      return;
    }
    mobileCallConversationRef.current = null;
    window.history.replaceState(mobileHistoryState('list'), '');
    setMobileNavigationView('list');
  }, [mobileNavigation, setMobileNavigationView, showMobileConversation]);
  useEffect(() => {
    const onPopState = () => {
      if (!mobileNavigationRef.current) return;
      if (mobileCallOpenRef.current) {
        restoreMobileChatAfterBack();
        return;
      }
      if (productOverlayOpenRef.current) {
        const previousView = mobileViewRef.current;
        closeProductOverlays();
        if (previousView === 'chat') restoreMobileChatAfterBack();
        else {
          window.history.pushState(mobileHistoryState('list'), '');
          setMobileNavigationView('list');
        }
        return;
      }
      const next = readMobileHistory();
      if (next?.view === 'chat' && next.conversationId) {
        setSelectedId(next.conversationId);
        window.localStorage.setItem('mova-selected-conversation', next.conversationId);
        setMobileNavigationView('chat');
      } else setMobileNavigationView('list');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [closeProductOverlays, restoreMobileChatAfterBack, setMobileNavigationView]);
  useEffect(() => {
    if (!mobileNavigation || mobileView !== 'chat') return;
    const excludedTarget = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('.mova-real-composer,.mova-emoji-picker,.mova-media-viewer,.mova-call-stage,.mova-message-image,.mova-message-file,input,textarea,[contenteditable="true"]'));
    const startSwipe = (source: 'touch' | 'pointer', id: number, clientX: number, clientY: number, target: EventTarget | null) => {
      const edgeWidth = Math.min(40, window.innerWidth * 0.1);
      if (clientX > edgeWidth || mobileCallOpenRef.current || productOverlayOpenRef.current || excludedTarget(target)) return;
      edgeSwipeRef.current = { source, id, x: clientX, y: clientY, startedAt: performance.now() };
    };
    const updateSwipe = (source: 'touch' | 'pointer', id: number, clientX: number, clientY: number) => {
      const swipe = edgeSwipeRef.current;
      if (!swipe || swipe.source !== source || swipe.id !== id) return;
      const distanceX = clientX - swipe.x;
      const distanceY = Math.abs(clientY - swipe.y);
      if (distanceX < -8 || (distanceY > 20 && distanceY > Math.abs(distanceX))) edgeSwipeRef.current = null;
    };
    const finishSwipe = (source: 'touch' | 'pointer', id: number, clientX: number, clientY: number) => {
      const swipe = edgeSwipeRef.current;
      if (!swipe || swipe.source !== source || swipe.id !== id) return;
      edgeSwipeRef.current = null;
      const distanceX = clientX - swipe.x;
      const distanceY = Math.abs(clientY - swipe.y);
      if (distanceX >= 64 && distanceX > distanceY * 1.2 && performance.now() - swipe.startedAt <= 900) navigateToMobileList();
    };
    const findTouch = (touches: TouchList, id: number) => Array.from(touches).find((touch) => touch.identifier === id);
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      startSwipe('touch', touch.identifier, touch.clientX, touch.clientY, event.target);
    };
    const onTouchMove = (event: TouchEvent) => {
      const swipe = edgeSwipeRef.current;
      if (!swipe || swipe.source !== 'touch') return;
      const touch = findTouch(event.touches, swipe.id);
      if (touch) updateSwipe('touch', swipe.id, touch.clientX, touch.clientY);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const swipe = edgeSwipeRef.current;
      if (!swipe || swipe.source !== 'touch') return;
      const touch = findTouch(event.changedTouches, swipe.id);
      if (touch) finishSwipe('touch', swipe.id, touch.clientX, touch.clientY);
      else edgeSwipeRef.current = null;
    };
    const onTouchCancel = () => {
      if (edgeSwipeRef.current?.source === 'touch') edgeSwipeRef.current = null;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || edgeSwipeRef.current?.source === 'touch') return;
      startSwipe('pointer', event.pointerId, event.clientX, event.clientY, event.target);
    };
    const clearSwipe = (event: PointerEvent) => {
      if (edgeSwipeRef.current?.source === 'pointer' && edgeSwipeRef.current.id === event.pointerId) edgeSwipeRef.current = null;
    };
    const onPointerMove = (event: PointerEvent) => {
      updateSwipe('pointer', event.pointerId, event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      finishSwipe('pointer', event.pointerId, event.clientX, event.clientY);
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });
    document.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
    document.addEventListener('pointercancel', clearSwipe, { passive: true, capture: true });
    return () => {
      edgeSwipeRef.current = null;
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchCancel, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', clearSwipe, true);
    };
  }, [mobileNavigation, mobileView, navigateToMobileList]);
  const updateTypingUser = useCallback((conversationId: string, userId: string, active: boolean) => {
    const key = `${conversationId}:${userId}`;
    const existingTimer = typingExpiryTimers.current.get(key);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    typingExpiryTimers.current.delete(key);
    setTypingByConversation((items) => {
      const current = items[conversationId] || [];
      const nextUsers = active ? [...new Set([...current, userId])] : current.filter((id) => id !== userId);
      if (nextUsers.length) return { ...items, [conversationId]: nextUsers };
      const next = { ...items };
      delete next[conversationId];
      return next;
    });
    if (active) {
      const timer = window.setTimeout(() => {
        typingExpiryTimers.current.delete(key);
        setTypingByConversation((items) => {
          const nextUsers = (items[conversationId] || []).filter((id) => id !== userId);
          if (nextUsers.length) return { ...items, [conversationId]: nextUsers };
          const next = { ...items };
          delete next[conversationId];
          return next;
        });
      }, 7_000);
      typingExpiryTimers.current.set(key, timer);
    }
  }, []);
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('mova-is-resizing-sidebar');
    const move = (moveEvent: PointerEvent) => setSidebarWidth(resolveSidebarWidth(startWidth + moveEvent.clientX - startX));
    const stop = (upEvent: PointerEvent) => {
      const width = resolveSidebarWidth(startWidth + upEvent.clientX - startX);
      setSidebarWidth(width);
      window.localStorage.setItem('mova-sidebar-width', String(width));
      document.body.classList.remove('mova-is-resizing-sidebar');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const nudgeSidebar = (amount: number) =>
    setSidebarWidth((width) => {
      const next = width === SIDEBAR_COMPACT_WIDTH && amount > 0 ? SIDEBAR_MIN_WIDTH : amount < 0 && width <= SIDEBAR_MIN_WIDTH ? SIDEBAR_COMPACT_WIDTH : Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width + amount));
      window.localStorage.setItem('mova-sidebar-width', String(next));
      return next;
    });
  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    const updateBackground = (event: Event) => setBackgroundColor((event as CustomEvent<string>).detail || loadBackgroundColor());
    const updateAccent = (event: Event) => setAccentColor((event as CustomEvent<string>).detail || loadAccentColor());
    window.addEventListener('mova-open-settings', openSettings);
    window.addEventListener('mova-background-color', updateBackground);
    window.addEventListener('mova-accent-color', updateAccent);
    return () => {
      window.removeEventListener('mova-open-settings', openSettings);
      window.removeEventListener('mova-background-color', updateBackground);
      window.removeEventListener('mova-accent-color', updateAccent);
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--mova-accent-color', accentColor);
  }, [accentColor]);
  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('.mova-account-anchor')) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setAccountOpen(false);
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountOpen]);
  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.type === 'message:new') {
          const handledMessageIds = notifiedRealtimeMessageIds.current;
          const alreadyHandled = handledMessageIds.has(event.message.id);
          handledMessageIds.add(event.message.id);
          if (handledMessageIds.size > 500) handledMessageIds.delete(handledMessageIds.values().next().value!);
          const shouldNotify = !alreadyHandled && event.message.authorId !== currentUserRef.current.id && currentUserRef.current.presence !== 'dnd';
          if (!shouldNotify) return;
          if (event.message.kind !== 'call') {
            const settings = loadAudioSettings();
            const audio = new Audio(messageSoundUrl);
            audio.volume = settings.systemVolume / 100;
            const sinkId = settings.outputDeviceId === 'default' ? '' : settings.outputDeviceId;
            const setSinkId = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
            const play = () => void audio.play().catch(() => undefined);
            if (setSinkId) void setSinkId.call(audio, sinkId).then(play).catch(play);
            else play();
          }
          const conversation = conversationsRef.current.find((item) => item.id === event.message.conversationId);
          showMessageNotification(event.message, conversation, () => {
            setSelectedId(event.message.conversationId);
            window.localStorage.setItem('mova-selected-conversation', event.message.conversationId);
            showMobileConversation(event.message.conversationId);
          });
        }
      }),
    [showMobileConversation],
  );
  useEffect(() => {
    const requestPermission = () => void requestMessageNotificationPermission();
    window.addEventListener('pointerdown', requestPermission, { once: true });
    window.addEventListener('keydown', requestPermission, { once: true });
    return () => {
      window.removeEventListener('pointerdown', requestPermission);
      window.removeEventListener('keydown', requestPermission);
    };
  }, []);
  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;
  const selectConversation = useCallback((conversationId: string) => {
    setSelectedId(conversationId);
    window.localStorage.setItem('mova-selected-conversation', conversationId);
    showMobileConversation(conversationId);
  }, [showMobileConversation]);
  const requestCall = useCallback((conversationId: string, video: boolean) => {
    if (voiceState !== 'idle') {
      if (voiceConversationId === conversationId && (isJoinedCallState(voiceState) || voiceState === 'available')) {
        selectConversation(conversationId);
        setCallCanvasOpen(true);
        if (voiceState === 'available') void voiceSession.accept();
        return;
      }
      const activeTitle = conversationsRef.current.find((conversation) => conversation.id === voiceConversationId)?.title || 'другом чате';
      toast.push(`Вы уже находитесь в звонке «${activeTitle}». Сначала выйдите из него.`, 'info');
      return;
    }
    startCallWithCamera.current = video;
    setCallCanvasOpen(true);
    if (voiceConversationId === conversationId) {
      voiceSession.call();
      return;
    }
    pendingCallStart.current = { conversationId, video };
    setVoiceConversationId(conversationId);
  }, [selectConversation, toast, voiceConversationId, voiceSession, voiceState]);
  const returnToCall = useCallback(() => {
    if (!voiceConversationId) return;
    selectConversation(voiceConversationId);
    setCallCanvasOpen(true);
    if (voiceState === 'available') void voiceSession.accept();
  }, [selectConversation, voiceConversationId, voiceSession, voiceState]);
  useEffect(() => {
    const pending = pendingCallStart.current;
    if (!pending || pending.conversationId !== voiceConversationId || voiceState !== 'idle') return;
    pendingCallStart.current = null;
    startCallWithCamera.current = pending.video;
    voiceSession.call();
  }, [voiceConversationId, voiceSession, voiceState]);
  useEffect(() => {
    if (voiceState === 'connected' && startCallWithCamera.current && !voiceSession.cameraStream) {
      startCallWithCamera.current = false;
      void voiceSession.toggleCamera();
    }
  }, [voiceSession, voiceState]);
  useEffect(() => {
    if (voiceState === 'idle') {
      setCallCanvasOpen(false);
      if (selectedId && !pendingCallStart.current && voiceConversationId !== selectedId) setVoiceConversationId(selectedId);
      return;
    }
    if (voiceState === 'ringing' || voiceState === 'incoming' || voiceState === 'connecting') setCallCanvasOpen(true);
  }, [selectedId, voiceConversationId, voiceState]);
  const reloadConversations = useCallback(async (force = false) => {
    const cached = conversationCache.get(currentUser.id);
    if (!force && isFresh(cached)) {
      setConversations(cached!.value);
      setSelectedId((current) => (current && cached!.value.some((item) => item.id === current) ? current : preferredConversation(cached!.value)));
      return;
    }
    const result = await api.conversations();
    const nextConversations = sortConversationsByActivity(result.conversations);
    conversationCache.set(currentUser.id, { value: nextConversations, updatedAt: Date.now() });
    setConversations(nextConversations);
    setSelectedId((current) => {
      const preferred = sessionStorage.getItem('mova-active-call') || sessionStorage.getItem('mova-pending-call') || localStorage.getItem('mova-selected-conversation');
      return current && nextConversations.some((item) => item.id === current) ? current : preferred && nextConversations.some((item) => item.id === preferred) ? preferred : nextConversations[0]?.id || null;
    });
  }, [currentUser.id]);
  const syncOverview = useCallback(() => {
    if (overviewSyncInFlight.current) return overviewSyncInFlight.current;
    const sync = Promise.all([api.conversations(), api.users()])
      .then(([conversationResult, userResult]) => {
        const nextConversations = sortConversationsByActivity(conversationResult.conversations);
        const updatedAt = Date.now();
        conversationCache.set(currentUser.id, { value: nextConversations, updatedAt });
        userCache.set(currentUser.id, { value: userResult.users, updatedAt });
        setConversations(nextConversations);
        setUsers(userResult.users);
        setSelectedId((selectedConversationId) =>
          selectedConversationId && nextConversations.some((item) => item.id === selectedConversationId)
            ? selectedConversationId
            : preferredConversation(nextConversations),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (overviewSyncInFlight.current === sync) overviewSyncInFlight.current = null;
      });
    overviewSyncInFlight.current = sync;
    return sync;
  }, [currentUser.id]);
  useEffect(() => {
    const loadUsers = async () => {
      const cached = userCache.get(currentUser.id);
      if (isFresh(cached)) return setUsers(cached!.value);
      const result = await api.users();
      userCache.set(currentUser.id, { value: result.users, updatedAt: Date.now() });
      setUsers(result.users);
    };
    Promise.all([reloadConversations(), loadUsers()]).finally(() => setLoading(false));
    realtime.connect();
    const unsubscribe = realtime.subscribe((event: RealtimeEvent) => {
      if (event.type === 'message:new') {
        updateTypingUser(event.message.conversationId, event.message.authorId, false);
        const cacheKey = messageCacheKey(currentUserRef.current.id, event.message.conversationId);
        const cachedEntry = messageCache.get(cacheKey);
        const cached = cachedEntry?.value || [];
        messageCache.set(cacheKey, { value: reconcileClientMessage(cached, event.message), updatedAt: cachedEntry ? Date.now() : 0 });
        setMessages((items) => (event.message.conversationId === selectedIdRef.current ? reconcileClientMessage(items, event.message) : items));
        setConversations((items) => {
          const next = updateConversationLastMessage(items, event.message);
          conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
      }
      if (event.type === 'message:update') {
        const cacheKey = messageCacheKey(currentUserRef.current.id, event.message.conversationId);
        const cachedEntry = messageCache.get(cacheKey);
        if (cachedEntry) messageCache.set(cacheKey, { value: cachedEntry.value.map((message) => (message.id === event.message.id ? event.message : message)), updatedAt: Date.now() });
        if (event.message.conversationId === selectedIdRef.current) setMessages((items) => items.map((message) => (message.id === event.message.id ? event.message : message)));
        setConversations((items) => {
          const next = updateConversationLastMessage(items, event.message, true);
          conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
      }
      if (event.type === 'typing' && event.userId !== currentUserRef.current.id) updateTypingUser(event.conversationId, event.userId, event.active);
      if (event.type === 'message:read' && event.conversationId === selectedIdRef.current) {
        const readIds = new Set(event.messageIds);
        setMessages((items) =>
          items.map((message) =>
            readIds.has(message.id) && !message.readBy?.some((receipt) => receipt.userId === event.userId)
              ? {
                  ...message,
                  readBy: [...(message.readBy || []), { userId: event.userId, readAt: event.readAt }],
                }
              : message,
          ),
        );
      }
      if (event.type === 'call:invite') {
        if (voiceStateRef.current !== 'idle' && voiceConversationIdRef.current !== event.conversationId) {
          const activeTitle = conversationsRef.current.find((conversation) => conversation.id === voiceConversationIdRef.current)?.title || 'другом чате';
          toast.push(`Входящий звонок пропущен: вы уже разговариваете в «${activeTitle}».`, 'info');
          return;
        }
        setVoiceConversationId(event.conversationId);
        setCallCanvasOpen(true);
        mobileCallConversationRef.current = event.conversationId;
        selectConversation(event.conversationId);
      }
      if (event.type === 'call:state') {
        const currentVoiceConversationId = voiceConversationIdRef.current;
        const belongsToCurrentCall = currentVoiceConversationId === event.conversationId;
        const joined = event.joined || event.room?.some((participant) => participant.userId === currentUserRef.current.id);
        if (voiceStateRef.current !== 'idle' && !belongsToCurrentCall && event.status !== 'idle') return;
        if (event.status === 'idle' && belongsToCurrentCall && mobileCallConversationRef.current === event.conversationId) {
          mobileCallConversationRef.current = null;
          mobileCallOpenRef.current = false;
        } else if (event.status !== 'idle' && (sessionStorage.getItem('mova-active-call') === event.conversationId || sessionStorage.getItem('mova-pending-call') === event.conversationId || event.status === 'ringing' || joined)) {
          setVoiceConversationId(event.conversationId);
          if (event.status === 'ringing') {
            mobileCallConversationRef.current = event.conversationId;
            setCallCanvasOpen(true);
            selectConversation(event.conversationId);
          }
        }
      }
      if ((event.type === 'call:decline' || event.type === 'call:end') && mobileCallConversationRef.current === event.conversationId) {
        mobileCallConversationRef.current = null;
        mobileCallOpenRef.current = false;
      }
      if (event.type === 'conversation:new') void reloadConversations(true);
      if (event.type === 'ready') {
        realtimeReadyCount.current += 1;
        if (realtimeReadyCount.current > 1) void syncOverview();
      }
      if (event.type === 'profile:update' || event.type === 'presence:update') {
        setUsers((items) => {
          const next = items.map((user) => (user.id === event.user.id ? event.user : user));
          userCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
        setConversations((items) => {
          const next = items.map((conversation) => ({
            ...conversation,
            members: conversation.members.map((member) => (member.id === event.user.id ? event.user : member)),
            title: conversation.kind === 'direct' && event.user.id !== currentUser.id ? event.user.name : conversation.title,
          }));
          conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
      }
    });
    const refreshOverview = () => {
      if (document.visibilityState === 'visible') void syncOverview();
    };
    const refreshTimer = window.setInterval(refreshOverview, 5 * 60_000);
    window.addEventListener('focus', refreshOverview);
    window.addEventListener('online', refreshOverview);
    document.addEventListener('visibilitychange', refreshOverview);
    return () => {
      unsubscribe();
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshOverview);
      window.removeEventListener('online', refreshOverview);
      document.removeEventListener('visibilitychange', refreshOverview);
      typingExpiryTimers.current.forEach((timer) => window.clearTimeout(timer));
      typingExpiryTimers.current.clear();
      realtime.close();
    };
  }, [reloadConversations, selectConversation, currentUser.id, syncOverview, toast, updateTypingUser]);
  useEffect(() => {
    const markActive = () => {
      lastActivity.current = Date.now();
      if (currentUserRef.current.presence === 'idle') void api.updatePresence('online').then((result) => onUserUpdate(result.user));
    };
    const events = ['pointerdown', 'keydown', 'mousemove'];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (currentUserRef.current.presence === 'online' && Date.now() - lastActivity.current >= 15 * 60_000) void api.updatePresence('idle').then((result) => onUserUpdate(result.user));
    }, 30_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActive));
      window.clearInterval(timer);
    };
  }, [onUserUpdate]);
  useEffect(() => {
    if (currentUser.presence !== 'dnd' || !currentUser.dndUntil || currentUser.dndUntil === 'forever') return;
    const remaining = new Date(currentUser.dndUntil).getTime() - Date.now();
    if (remaining <= 0) {
      void api.updatePresence('online').then((result) => onUserUpdate(result.user));
      return;
    }
    const timer = window.setTimeout(() => void api.updatePresence('online').then((result) => onUserUpdate(result.user)), remaining);
    return () => window.clearTimeout(timer);
  }, [currentUser.presence, currentUser.dndUntil, onUserUpdate]);
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessagesLoading(false);
      setMessagesErrorFor(null);
      return;
    }
    const key = messageCacheKey(currentUser.id, selectedId);
    const cached = messageCache.get(key);
    if (cached) setMessages(cached.value);
    else setMessages([]);
    setMessagesErrorFor(null);
    if (isFresh(cached)) {
      setMessagesLoading(false);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    api.messages(selectedId)
      .then((result) => {
        messageCache.set(key, { value: result.messages, updatedAt: Date.now() });
        if (!cancelled) setMessages(result.messages);
      })
      .catch(() => {
        if (!cancelled) setMessagesErrorFor(selectedId);
      })
      .finally(() => !cancelled && setMessagesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, currentUser.id, messagesLoadAttempt]);
  useEffect(() => {
    const markRead = () => {
      if (!selectedId || document.visibilityState !== 'visible') return;
      const latestUnread = [...messages].reverse().find((message) => message.conversationId === selectedId && message.authorId !== currentUser.id && !message.readBy?.some((receipt) => receipt.userId === currentUser.id));
      if (!latestUnread || markingReadThrough.current === latestUnread.id) return;
      markingReadThrough.current = latestUnread.id;
      void api
        .markConversationRead(selectedId, latestUnread.id)
        .then((result) => {
          const readIds = new Set(result.messageIds);
          setMessages((items) =>
            items.map((message) =>
              readIds.has(message.id) && !message.readBy?.some((receipt) => receipt.userId === result.userId)
                ? {
                    ...message,
                    readBy: [...(message.readBy || []), { userId: result.userId, readAt: result.readAt }],
                  }
                : message,
            ),
          );
        })
        .finally(() => {
          if (markingReadThrough.current === latestUnread.id) markingReadThrough.current = null;
        });
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    window.addEventListener('focus', markRead);
    return () => {
      document.removeEventListener('visibilitychange', markRead);
      window.removeEventListener('focus', markRead);
    };
  }, [selectedId, messages, currentUser.id]);
  const updatePendingMessage = (conversationId: string, clientId: string, patch: Partial<AppMessage>) => {
    const update = (items: AppMessage[]) => items.map((message) => (message.clientId === clientId && !message.sentAt ? { ...message, ...patch } : message));
    const cacheKey = messageCacheKey(currentUser.id, conversationId);
    const cached = messageCache.get(cacheKey)?.value || [];
    messageCache.set(cacheKey, { value: update(cached), updatedAt: Date.now() });
    setMessages((items) => (selectedIdRef.current === conversationId ? update(items) : items));
    setConversations((items) => {
      const next = items.map((conversation) =>
        conversation.id === conversationId && conversation.lastMessage?.clientId === clientId && !conversation.lastMessage.sentAt
          ? { ...conversation, lastMessage: { ...conversation.lastMessage, ...patch } }
          : conversation,
      );
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  };
  const acknowledgeMessage = (message: AppMessage) => {
    const cacheKey = messageCacheKey(currentUser.id, message.conversationId);
    const cached = messageCache.get(cacheKey)?.value || [];
    messageCache.set(cacheKey, { value: reconcileClientMessage(cached, message), updatedAt: Date.now() });
    setMessages((items) => (selectedIdRef.current === message.conversationId ? reconcileClientMessage(items, message) : items));
    setConversations((items) => {
      const next = updateConversationLastMessage(items, message);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  };
  const sendMessageAttempt = (message: AppMessage) =>
    api.sendMessage(message.conversationId, message.content, message.attachment, message.replyToId || message.replyTo?.id, message.clientId, (uploadedAttachment) =>
      updatePendingMessage(message.conversationId, message.clientId || message.id, { attachment: uploadedAttachment }),
    );
  const send = async (content: string, attachment?: MessageAttachment, replyToId?: string) => {
    if (!selectedId) return;
    const conversationId = selectedId;
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = new Date().toISOString();
    const replyMessage = replyToId ? messages.find((message) => message.id === replyToId) : undefined;
    const optimisticMessage: AppMessage = {
      id: clientId,
      clientId,
      conversationId,
      authorId: currentUser.id,
      author: currentUser,
      content,
      ...(attachment ? { attachment } : {}),
      ...(replyToId ? { replyToId } : {}),
      ...(replyMessage
        ? {
            replyTo: {
              id: replyMessage.id,
              authorId: replyMessage.authorId,
              content: replyMessage.content,
              ...(replyMessage.attachment ? { attachmentName: replyMessage.attachment.name, attachment: replyMessage.attachment } : {}),
              author: replyMessage.author,
            },
          }
        : {}),
      createdAt,
      readBy: [],
      deliveryState: 'sending',
    };
    setMessages((items) => {
      const next = [...items, optimisticMessage];
      messageCache.set(messageCacheKey(currentUser.id, conversationId), { value: next, updatedAt: Date.now() });
      return next;
    });
    setConversations((items) => {
      const next = updateConversationLastMessage(items, optimisticMessage);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
    try {
      const result = await sendMessageAttempt(optimisticMessage);
      acknowledgeMessage(result.message);
    } catch (sendFailure) {
      updatePendingMessage(conversationId, clientId, { deliveryState: 'failed' });
      throw sendFailure;
    }
  };
  const retry = async (message: AppMessage) => {
    const clientId = message.clientId;
    if (!clientId || retryingClientIds.current.has(clientId)) return;
    retryingClientIds.current.add(clientId);
    updatePendingMessage(message.conversationId, clientId, { deliveryState: 'sending' });
    try {
      const result = await sendMessageAttempt(message);
      acknowledgeMessage(result.message);
    } catch (retryFailure) {
      updatePendingMessage(message.conversationId, clientId, { deliveryState: 'failed' });
      throw retryFailure;
    } finally {
      retryingClientIds.current.delete(clientId);
    }
  };
  const edit = async (messageId: string, content: string) => {
    if (!selectedId) return;
    const result = await api.editMessage(selectedId, messageId, content);
    setMessages((items) => {
      const next = items.map((message) => (message.id === result.message.id ? result.message : message));
      messageCache.set(messageCacheKey(currentUser.id, selectedId), { value: next, updatedAt: Date.now() });
      return next;
    });
    setConversations((items) => {
      const next = updateConversationLastMessage(items, result.message, true);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  };
  const visible = useMemo(() => conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [conversations, query]);
  const mobileNavigationClass = mobileNavigation ? ` is-mobile-navigation is-mobile-${mobileView}` : '';
  return (
    <main className={`mova-real-app mova-tg-app${sidebarCompact ? ' is-sidebar-compact' : ''}${accountOpen ? ' is-account-menu-open' : ''}${voiceDockVisible ? ' has-voice-dock' : ''}${mobileNavigationClass}`} style={{ '--mova-sidebar-width': `${sidebarWidth}px`, '--mova-background-color': backgroundColor, '--mova-accent-color': accentColor } as CSSProperties} data-mobile-view={mobileNavigation ? mobileView : undefined}>
      <div className="mova-real-aurora" />
      <aside className="mova-real-sidebar mova-tg-sidebar" aria-hidden={mobileNavigation && mobileView === 'chat'} inert={mobileNavigation && mobileView === 'chat' ? true : undefined}>
        <div className="mova-tg-search-row">
          <div className="mova-account-anchor">
            <IconButton label="Меню и профиль" className="mova-tg-menu" onClick={() => setAccountOpen(!accountOpen)}>
              <Menu size={23} />
            </IconButton>
            <AccountMenu user={currentUser} open={accountOpen} onClose={() => setAccountOpen(false)} onEdit={() => setProfileOpen(true)} onSettings={() => setSettingsOpen(true)} onUpdated={onUserUpdate} onLogout={onLogout} />
          </div>
          <label className="mova-tg-search">
            <Search size={20} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск по чатам" />
          </label>
        </div>
        <div className="mova-real-chat-list">
          {loading ? (
            <ConversationListSkeleton />
          ) : visible.length === 0 ? (
            <div className="mova-real-empty-list">
              <MessageCircle size={25} />
              <strong>{conversations.length ? 'Ничего не найдено' : 'Пока тихо'}</strong>
              <p>{conversations.length ? 'Попробуйте другой запрос' : 'Создайте личный чат или группу'}</p>
            </div>
          ) : (
            visible.map((conversation) => {
              const typingLabel = conversationTypingLabel(conversation, currentUser.id, typingByConversation[conversation.id] || []);
              return (
              <button type="button" key={conversation.id} aria-label={sidebarCompact ? conversation.title : undefined} title={sidebarCompact ? conversation.title : undefined} className={selectedId === conversation.id ? 'is-active' : ''} onClick={() => selectConversation(conversation.id)}>
                <ConversationAvatar conversation={conversation} currentUser={currentUser} />
                <span>
                  <span>
                    <strong><AppleEmoji text={conversation.title} /></strong>
                    <time>
                      {conversation.lastMessage
                        ? new Intl.DateTimeFormat('ru', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(conversation.lastMessage.createdAt))
                        : ''}
                    </time>
                  </span>
                  <small className={typingLabel ? 'mova-typing-status' : undefined} aria-live="polite">
                    <AppleEmoji
                      text={
                        typingLabel || conversation.lastMessage?.content ||
                        (conversation.lastMessage?.attachment
                          ? conversation.lastMessage.attachment.type.startsWith('image/')
                            ? 'Фотография'
                            : conversation.lastMessage.attachment.name
                          : conversation.kind === 'group'
                            ? `${conversation.members.length} участников`
                            : 'Начните разговор')
                      }
                    />
                  </small>
                </span>
              </button>
              );
            })
          )}
        </div>
        <button type="button" className="mova-tg-compose" aria-label="Новый разговор" onClick={() => setCreateOpen(true)}>
          <Pencil size={23} />
        </button>
        <div
          className="mova-sidebar-resizer"
          role="separator"
          aria-label="Изменить ширину списка чатов"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_COMPACT_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(sidebarWidth)}
          aria-valuetext={sidebarCompact ? 'Компактное меню' : `${Math.round(sidebarWidth)} пикселей`}
          tabIndex={accountOpen ? -1 : 0}
          onPointerDown={startSidebarResize}
          onDoubleClick={() => {
            setSidebarWidth(360);
            window.localStorage.setItem('mova-sidebar-width', '360');
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              nudgeSidebar(-16);
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              nudgeSidebar(16);
            }
          }}
        >
          <i />
        </div>
      </aside>
      {selected ? (
        <RealMessagesView
          conversation={selected}
          currentUser={currentUser}
          voiceSession={voiceSession}
          voiceConversation={voiceConversation || selected}
          callCanvasOpen={callCanvasOpen}
          onOpenCallCanvas={returnToCall}
          onMinimizeCallCanvas={() => setCallCanvasOpen(false)}
          onStartCall={(video) => requestCall(selected.id, video)}
          messages={messages}
          loading={messagesLoading}
          historyError={messagesErrorFor === selected.id}
          typingUserIds={typingByConversation[selected.id] || []}
          mobileActive={!mobileNavigation || mobileView === 'chat'}
          onMobileBack={navigateToMobileList}
          onCallOpenChange={handleMobileCallOpenChange}
          onSend={send}
          onRetry={retry}
          onRetryHistory={() => setMessagesLoadAttempt((attempt) => attempt + 1)}
          onEdit={edit}
          onDeleteConversation={() => {
            setConversations((items) => items.filter((item) => item.id !== selected.id));
            setSelectedId(null);
            setMessages([]);
            if (mobileNavigationRef.current) {
              window.history.replaceState(mobileHistoryState('list'), '');
              setMobileNavigationView('list');
            }
          }}
        />
      ) : (
        <section className="mova-real-welcome" aria-hidden={mobileNavigation && mobileView === 'list'} inert={mobileNavigation && mobileView === 'list' ? true : undefined}>
          <div>
            <span><img src="/mova-logo.png" alt="" /></span>
            <h1>Mova</h1>
            <p>Выберите разговор или создайте новый</p>
            <Button leadingIcon={<Plus size={17} />} onClick={() => setCreateOpen(true)}>
              Новый разговор
            </Button>
          </div>
        </section>
      )}
      {voiceDockVisible && voiceConversation && <VoiceDock conversation={voiceConversation} call={voiceSession} onReturn={returnToCall} />}
      <CreateConversation
        open={createOpen}
        users={users}
        onClose={() => setCreateOpen(false)}
        onCreated={(conversation) => {
          setConversations((items) => {
            const next = [conversation, ...items.filter((item) => item.id !== conversation.id)];
            conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
            return next;
          });
          selectConversation(conversation.id);
        }}
      />
      <SettingsModal user={currentUser} open={settingsOpen} onClose={() => setSettingsOpen(false)} onEditProfile={() => setProfileOpen(true)} />
      <ProfileEditor user={currentUser} open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={onUserUpdate} />
    </main>
  );
}

export function RealApp() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  useEffect(() => {
    if (!session.get()) return;
    api
      .me()
      .then((result) => setCurrentUser(result.user))
      .catch(() => session.clear())
      .finally(() => setChecking(false));
  }, []);
  if (checking)
    return (
      <div className="mova-boot">
        <img src="/mova-logo.png" alt="" />
        <p>Открываем Mova…</p>
      </div>
    );
  if (!currentUser)
    return (
      <AuthScreen
        onAuth={(user) => {
          setCurrentUser(user);
          setChecking(false);
        }}
      />
    );
  return (
    <Product
      currentUser={currentUser}
      onUserUpdate={setCurrentUser}
      onLogout={() => {
        realtime.close();
        clearClientCache();
        session.clear();
        setCurrentUser(null);
      }}
    />
  );
}
