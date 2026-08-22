import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, AtSign, Ban, Bell, BellOff, Bookmark, Camera, Check, CheckCheck, ChevronDown, ChevronRight, ChevronUp, CircleCheck, Clock, CloudOff, Copy, FileText, Forward, Gamepad2, HeadphoneOff, Headphones, Info, Languages, Link2, LoaderCircle, LogOut, Maximize2, Megaphone, Menu, MessageCircle, Mic, MicOff, Minimize2, MonitorUp, Moon, MoreHorizontal, MoreVertical, Palette, Paperclip, Pencil, Phone, PhoneCall, PhoneOff, Pin, Plus, Power, Reply, RotateCcw, Search, Send, Settings, ShieldCheck, Smile, Sparkles, Trash2, Upload, UserMinus, UserPlus, UserRound, Users, Video, VideoOff, Volume2, X } from 'lucide-react';
import { api, realtime, session, type AppConversation, type AppMessage, type AppUser, type EmailChallenge, type ForwardedMessageSource, type MessageAttachment, type RealtimeEvent } from './lib/api';
import { isJoinedCallState, normalizeCallState, useVoiceCall, type ScreenShareQuality } from './hooks/useVoiceCall';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { Avatar, Button, ConfirmDialog, DialogSurface, IconButton, PopoverSurface, StatusIndicator, Tooltip, useToast } from './components/Primitives';
import { formatVoiceDuration, isVoiceAttachment, useVoiceMessagePlayer, VoiceMessage, VoiceMessagePlayerBar, VoicePlaybackAudio } from './components/VoiceMessage';
import { AppleEmoji, isEmojiOnlyText } from './components/AppleEmoji';
import { EmojiPicker } from './components/EmojiPicker';
import { buildMediaGallery, MediaViewer } from './components/MediaViewer';
import { defaultAudioSettings, loadAudioSettings, saveAudioSettings, withNoiseSuppressionMode, type AudioSettings, type NoiseSuppressionMode } from './lib/audioSettings';
import { createMicrophonePipeline, type MicrophonePipeline } from './lib/microphoneProcessing';
import { defaultScreenShareSettings, loadScreenShareSettings, saveScreenShareSettings, type ScreenShareSettings } from './lib/screenShareSettings';
import { backgroundPresets, defaultBackgroundColor, loadBackgroundColor, saveBackgroundColor } from './lib/backgroundSettings';
import { accentPresets, defaultAccentColor, loadAccentColor, saveAccentColor } from './lib/accentSettings';
import { enableMessageNotifications, restoreMessageNotifications, shouldPlayMessageSoundInPage, shouldPromptForNotifications, showIncomingCallNotification, showMessageNotification, unregisterMessageNotifications } from './lib/messageNotifications';
import { cropImageFile, fileToDataUrl, prepareImageDataUrl } from './lib/imageCompression';
import { getMessageStructure } from './lib/messageGrouping';
import { clearPersistentUserData, deletePersistentConversation, loadPersistentClientState, persistConversations, persistMessages, persistOutbox, persistUsers, removeOutbox, type OutboxEntry } from './lib/persistentClientStore';
import { buildCallDiagnosticReport, copyDiagnosticReport } from './lib/callDiagnostics';
import { startUnreadTitleBlink } from './lib/documentTitle';
import { attachmentDownloadSource, formatFileSize } from './lib/fileAttachments';
import type { DesktopGameActivity, DesktopGameActivitySettings, DesktopRegisteredGame, DesktopRunningApplication } from './DesktopTitlebar';

const avatarStatus = (presence: AppUser['presence'], isOnline?: boolean) => (isOnline === false ? 'offline' : presence);
const attachmentSource = (attachment?: MessageAttachment | null) => attachment?.url || attachment?.dataUrl || '';
const attachmentLabel = (attachment?: MessageAttachment | null) => isVoiceAttachment(attachment) ? 'Голосовое сообщение' : attachment?.name || '';
const activityTime = (startedAt?: string) => {
  if (!startedAt) return '';
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes} мин.`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч. ${minutes % 60} мин.`;
};
function GameActivityIcon({ activity, size = 20 }: { activity?: { name: string; iconDataUrl?: string } | null; size?: number }) {
  return activity?.iconDataUrl
    ? <img className="mova-game-icon" src={activity.iconDataUrl} alt="" width={size} height={size} draggable={false} />
    : <Gamepad2 size={size} aria-hidden="true" />;
}
const russianCount = (value: number, one: string, few: string, many: string) => {
  const tens = value % 100;
  const units = value % 10;
  return tens >= 11 && tens <= 19 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many;
};
export const formatPresenceStatus = (user?: AppUser, now = Date.now()) => {
  if (!user) return 'не в сети';
  const online = user.isOnline ?? user.presence === 'online';
  if (online) return user.presence === 'idle' ? 'неактивен' : user.presence === 'dnd' ? 'не беспокоить' : user.activity?.name ? `играет в ${user.activity.name}` : 'в сети';
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
export const presenceUpdateForSystemIdle = (presence: AppUser['presence'], idleSeconds: number): 'online' | 'idle' | null => {
  if (presence === 'online' && idleSeconds >= 15 * 60) return 'idle';
  if (presence === 'idle' && idleSeconds < 45) return 'online';
  return null;
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
  hasMore?: boolean;
  nextCursor?: string | null;
}
interface ConversationDraft {
  text: string;
  updatedAt: string;
}
type ConversationDrafts = Record<string, ConversationDraft>;
const conversationDraftStorageKey = (userId: string) => `mova-composer-drafts:${userId}`;
export const loadConversationDrafts = (userId: string): ConversationDrafts => {
  try {
    const stored = JSON.parse(localStorage.getItem(conversationDraftStorageKey(userId)) || '{}') as Record<string, Partial<ConversationDraft>>;
    return Object.fromEntries(Object.entries(stored).flatMap(([conversationId, draft]) => {
      const text = typeof draft?.text === 'string' ? draft.text.slice(0, 4_000) : '';
      const updatedAt = typeof draft?.updatedAt === 'string' && Number.isFinite(new Date(draft.updatedAt).getTime()) ? draft.updatedAt : '';
      return text.trim() && updatedAt ? [[conversationId, { text, updatedAt }]] : [];
    }));
  } catch {
    return {};
  }
};
const persistConversationDrafts = (userId: string, drafts: ConversationDrafts) => {
  if (Object.keys(drafts).length) localStorage.setItem(conversationDraftStorageKey(userId), JSON.stringify(drafts));
  else localStorage.removeItem(conversationDraftStorageKey(userId));
};
class MirroredCacheMap<K, V> extends Map<K, V> {
  constructor(private readonly mirror: (key: K, value: V) => Promise<void>) {
    super();
  }
  override set(key: K, value: V) {
    super.set(key, value);
    void this.mirror(key, value).catch(() => undefined);
    return this;
  }
}
const CLIENT_CACHE_TTL = 60_000;
const conversationCache = new MirroredCacheMap<string, ClientCache<AppConversation[]>>(persistConversations);
const userCache = new MirroredCacheMap<string, ClientCache<AppUser[]>>(persistUsers);
const messageCache = new MirroredCacheMap<string, ClientCache<AppMessage[]>>((key, value) => {
  const separator = key.indexOf(':');
  return persistMessages(key.slice(0, separator), key.slice(separator + 1), value);
});
const isFresh = <T,>(entry?: ClientCache<T>) => Boolean(entry && Date.now() - entry.updatedAt < CLIENT_CACHE_TTL);
const messageCacheKey = (userId: string, conversationId: string) => `${userId}:${conversationId}`;
const conversationActivityAt = (conversation: AppConversation) => new Date(conversation.lastMessage?.createdAt || conversation.createdAt).getTime();
const conversationRelationshipRank = (conversation: AppConversation) => {
  if (conversation.kind !== 'direct') return 0;
  const relationship = conversation.members.find((member) => member.relationship && member.relationship !== 'self')?.relationship;
  if (relationship === 'friend') return 0;
  if (relationship === 'incoming') return 1;
  return 2;
};
export const sortConversationsByActivity = (items: AppConversation[]) => [...items].sort((left, right) =>
  Number(right.kind === 'saved') - Number(left.kind === 'saved')
  || conversationRelationshipRank(left) - conversationRelationshipRank(right)
  || conversationActivityAt(right) - conversationActivityAt(left),
);
export const updateConversationLastMessage = (items: AppConversation[], message: AppMessage, onlyIfCurrent = false) => {
  const { author: _author, ...lastMessage } = message;
  return sortConversationsByActivity(
    items.map((conversation) =>
      conversation.id === message.conversationId && (!onlyIfCurrent || conversation.lastMessage?.id === message.id)
        ? { ...conversation, lastMessage, isDraft: false }
        : conversation,
    ),
  );
};
export const updateConversationUser = (conversation: AppConversation, updatedUser: AppUser, currentUserId: string) => {
  if (!conversation.members.some((member) => member.id === updatedUser.id)) return conversation;
  return {
    ...conversation,
    members: conversation.members.map((member) => member.id === updatedUser.id ? { ...member, ...updatedUser } : member),
    title: conversation.kind === 'direct' && updatedUser.id !== currentUserId ? updatedUser.name : conversation.title,
  };
};
const conversationPreviewText = (conversation: AppConversation, currentUserId: string) => {
  const message = conversation.lastMessage;
  if (message?.kind === 'friend_request' && message.friendRequest) {
    if (message.friendRequest.status === 'accepted') return 'Теперь вы друзья';
    if (message.friendRequest.status === 'declined') return 'Заявка в друзья отклонена';
    if (message.friendRequest.status === 'cancelled') return 'Заявка в друзья отменена';
    return message.friendRequest.requestedBy === currentUserId ? 'Заявка в друзья отправлена' : 'Хочет добавить тебя в друзья';
  }
  return message?.content || (message?.attachment ? (message.attachment.type.startsWith('image/') ? 'Фотография' : attachmentLabel(message.attachment)) : conversation.kind === 'group' ? `${conversation.members.length} участников` : 'Начните разговор');
};
export const reconcileClientMessage = (items: AppMessage[], message: AppMessage) => {
  const matchingClientId = message.clientId ? items.findIndex((item) => item.clientId === message.clientId) : -1;
  if (matchingClientId >= 0) return items.map((item, index) => (index === matchingClientId ? message : item));
  if (items.some((item) => item.id === message.id)) return items.map((item) => (item.id === message.id ? message : item));
  return [...items, message];
};
export const mergeMessageHistory = (current: AppMessage[], incoming: AppMessage[]) => {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const optimistic = message.clientId ? [...messages.values()].find((item) => item.clientId === message.clientId) : undefined;
    if (optimistic && optimistic.id !== message.id) messages.delete(optimistic.id);
    messages.set(message.id, message);
  }
  return [...messages.values()].sort((first, second) => first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id));
};
const preferredConversation = (items: AppConversation[]) => {
  const visibleItems = items.filter((item) => !item.isDraft);
  const notificationConversation = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('conversation');
  const preferred = notificationConversation || sessionStorage.getItem('mova-active-call') || sessionStorage.getItem('mova-pending-call') || localStorage.getItem('mova-selected-conversation');
  return (preferred && visibleItems.some((item) => item.id === preferred) ? preferred : visibleItems[0]?.id) || null;
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
type GlobalSearchTab = 'users' | 'chats' | 'links';
const messageLinks = (content: string) => content.match(/(?:https?:\/\/|www\.)[^\s<>()]+/giu) || [];
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
  const matches = () =>
    typeof window !== 'undefined'
    && !window.movaDesktopShell
    && Boolean(window.matchMedia?.(mobileNavigationQuery).matches);
  const [mobile, setMobile] = useState(matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(mobileNavigationQuery);
    const update = () => setMobile(!window.movaDesktopShell && media.matches);
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
  if (message.deliveryState === 'queued')
    return (
      <span className="mova-message-status-slot">
        <span className="mova-message-status is-queued" role="img" aria-label="В очереди — отправится после подключения" title="В очереди — отправится после подключения">
          <CloudOff size={13} aria-hidden="true" />
        </span>
      </span>
    );
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

type AvatarCropDraft = { file: File; previewUrl: string };
type AvatarCropPosition = { x: number; y: number };
const clampCropPosition = (value: number) => Math.min(1, Math.max(-1, value));

function AvatarCropEditor({ draft, onCancel, onApply, showError, subject = 'avatar' }: { draft: AvatarCropDraft; onCancel: () => void; onApply: (dataUrl: string) => void; showError: (message: string) => void; subject?: 'avatar' | 'group' }) {
  const [position, setPosition] = useState<AvatarCropPosition>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [processing, setProcessing] = useState(false);
  const cropStage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; position: AvatarCropPosition } | null>(null);
  useEffect(() => cropStage.current?.focus(), []);
  const aspect = imageSize.width / imageSize.height;
  const renderedWidth = zoom * (aspect >= 1 ? aspect : 1);
  const renderedHeight = zoom * (aspect >= 1 ? 1 : 1 / aspect);
  const horizontalOverflow = Math.max(0, renderedWidth - 1);
  const verticalOverflow = Math.max(0, renderedHeight - 1);
  const nudge = (x: number, y: number) => setPosition((current) => ({ x: clampCropPosition(current.x + x), y: clampCropPosition(current.y + y) }));
  const applyCrop = async () => {
    setProcessing(true);
    try {
      const cropped = await cropImageFile(draft.file, { ...position, zoom }, { outputSize: 1024, maxBytes: 650_000, quality: 0.94 });
      onApply(await fileToDataUrl(cropped));
    } catch (cropError) {
      showError(cropError instanceof Error ? cropError.message : subject === 'group' ? 'Не удалось кадрировать фото группы' : 'Не удалось кадрировать фотографию');
    } finally {
      setProcessing(false);
    }
  };
  return (
    <>
      <header>
        <div>
          <h2 id={subject === 'group' ? 'group-photo-crop-title' : 'avatar-crop-title'}>{subject === 'group' ? 'Кадрирование фото группы' : 'Кадрирование аватара'}</h2>
          <p id="avatar-crop-help">Перетащите фотографию и настройте масштаб</p>
        </div>
        <IconButton data-dialog-close label={subject === 'group' ? 'Закрыть кадрирование фото группы' : 'Закрыть кадрирование'} onClick={onCancel}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="mova-avatar-crop__body">
        <div
          ref={cropStage}
          className="mova-avatar-crop__stage"
          role="group"
          aria-label={subject === 'group' ? 'Область кадрирования фото группы' : 'Область кадрирования аватара'}
          tabIndex={0}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.025;
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            nudge(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, position };
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const maxX = bounds.width * horizontalOverflow / 2;
            const maxY = bounds.height * verticalOverflow / 2;
            setPosition({
              x: maxX ? clampCropPosition(drag.current.position.x + (event.clientX - drag.current.clientX) / maxX) : 0,
              y: maxY ? clampCropPosition(drag.current.position.y + (event.clientY - drag.current.clientY) / maxY) : 0,
            });
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) drag.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; }}
        >
          <img
            src={draft.previewUrl}
            alt={subject === 'group' ? 'Предпросмотр фото группы' : 'Предпросмотр аватара'}
            draggable={false}
            onLoad={(event) => setImageSize({ width: Math.max(1, event.currentTarget.naturalWidth), height: Math.max(1, event.currentTarget.naturalHeight) })}
            style={{
              width: `${renderedWidth * 100}%`,
              height: `${renderedHeight * 100}%`,
              left: `${50 + position.x * horizontalOverflow * 50}%`,
              top: `${50 + position.y * verticalOverflow * 50}%`,
            }}
          />
          <i aria-hidden="true" />
        </div>
        <label className="mova-avatar-crop__zoom">
          <span>Масштаб</span>
          <input aria-label={subject === 'group' ? 'Масштаб фото группы' : 'Масштаб аватара'} type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <output>{Math.round(zoom * 100)}%</output>
        </label>
      </div>
      <footer>
        <Button data-dialog-cancel variant="ghost" onClick={onCancel}>Отмена</Button>
        <Button loading={processing} onClick={() => void applyCrop()}>Применить</Button>
      </footer>
    </>
  );
}

export function ProfileEditor({ user, open, onClose, onSaved }: { user: AppUser; open: boolean; onClose: () => void; onSaved: (user: AppUser) => void }) {
  const [form, setForm] = useState({
    name: user.name,
    handle: editableHandle(user.handle),
    bio: user.bio || '',
    avatarDataUrl: user.avatarDataUrl || '',
    bannerDataUrl: user.bannerDataUrl || '',
  });
  const [loading, setLoading] = useState(false);
  const [avatarCrop, setAvatarCrop] = useState<AvatarCropDraft | null>(null);
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
      if (field === 'avatarDataUrl') {
        setAvatarCrop({ file, previewUrl: await fileToDataUrl(file) });
        return;
      }
      const prepared = await prepareImageDataUrl(file, { maxDimension: 2560, maxBytes: 1_600_000, quality: 0.94, skipBelowBytes: 180_000 });
      setForm((current) => ({ ...current, [field]: prepared.dataUrl }));
    } catch (imageError) {
      showError(imageError instanceof Error ? imageError.message : 'Не удалось обработать фотографию');
    }
  };
  const closeEditor = () => avatarCrop ? setAvatarCrop(null) : onClose();
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
    <DialogSurface open={open} onClose={closeEditor} className={`mova-glass-card ${avatarCrop ? 'mova-profile-avatar-crop' : 'mova-profile-editor'}`} labelledBy={avatarCrop ? 'avatar-crop-title' : 'profile-title'} describedBy={avatarCrop ? 'avatar-crop-help' : undefined}>
      {avatarCrop ? (
        <AvatarCropEditor
          draft={avatarCrop}
          onCancel={() => setAvatarCrop(null)}
          onApply={(avatarDataUrl) => {
            setForm((current) => ({ ...current, avatarDataUrl }));
            setAvatarCrop(null);
          }}
          showError={showError}
        />
      ) : <>
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
                onChange={(event) => {
                  void selectProfileImage(event.target.files?.[0], 'bannerDataUrl');
                  event.currentTarget.value = '';
                }}
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
                onChange={(event) => {
                  void selectProfileImage(event.target.files?.[0], 'avatarDataUrl');
                  event.currentTarget.value = '';
                }}
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
      </>}
    </DialogSurface>
  );
}

const emailDeliveryHint = 'Письмо с кодом может попасть в «Спам» или «Промоакции». Если кода нет, проверьте эти папки.';

function AccountEmailSettings({ user, onUserUpdate }: { user: AppUser; onUserUpdate: (user: AppUser) => void }) {
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [verificationChallenge, setVerificationChallenge] = useState<EmailChallenge | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationResendSeconds, setVerificationResendSeconds] = useState(0);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);
  useEffect(() => {
    if (verificationResendSeconds <= 0) return;
    const timer = window.setTimeout(() => setVerificationResendSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [verificationResendSeconds]);
  const requestVerification = async (resent = false) => {
    setVerificationLoading(true);
    setVerificationError('');
    setSuccess('');
    try {
      const result = await api.requestEmailVerification();
      setVerificationChallenge(result);
      setVerificationCode('');
      setVerificationResendSeconds(result.resendAfterSeconds);
      if (resent) setSuccess('Новый код отправлен.');
    } catch (requestError) {
      setVerificationError(requestError instanceof Error ? requestError.message : 'Не удалось отправить код');
    } finally {
      setVerificationLoading(false);
    }
  };
  const confirmVerification = async (event: FormEvent) => {
    event.preventDefault();
    if (!verificationChallenge) return;
    setVerificationLoading(true);
    setVerificationError('');
    setSuccess('');
    try {
      const result = await api.confirmEmailVerification(verificationChallenge.challengeId, verificationCode);
      onUserUpdate(result.user);
      setVerificationChallenge(null);
      setVerificationCode('');
      setVerificationResendSeconds(0);
      setSuccess('Почта подтверждена.');
    } catch (confirmError) {
      setVerificationError(confirmError instanceof Error ? confirmError.message : 'Не удалось подтвердить почту');
    } finally {
      setVerificationLoading(false);
    }
  };
  const requestChange = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.requestEmailChange(email, password);
      setChallenge(result);
      setStep('verify');
      setCode('');
      setResendSeconds(result.resendAfterSeconds);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };
  const confirmChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.confirmEmailChange(challenge.challengeId, code);
      session.set(result.token);
      onUserUpdate(result.user);
      setStep('request');
      setEmail('');
      setPassword('');
      setCode('');
      setChallenge(null);
      setResendSeconds(0);
      setSuccess('Почта аккаунта изменена.');
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Не удалось подтвердить почту');
    } finally {
      setLoading(false);
    }
  };
  const resend = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.requestEmailChange(email, password);
      setChallenge(result);
      setCode('');
      setResendSeconds(result.resendAfterSeconds);
      setSuccess('Новый код отправлен.');
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Не удалось отправить новый код');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="mova-account-settings">
      <section>
        <h3><AtSign size={18} /> Почта аккаунта</h3>
        {!user.emailVerifiedAt && user.email && (
          <div className="mova-email-verification-notice" role="alert">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>Подтвердите текущую почту</strong>
              <p>Мы добавили подтверждение адреса после создания вашего аккаунта. Отправим код на <b>{user.email}</b>.</p>
              {!verificationChallenge ? (
                <Button type="button" loading={verificationLoading} onClick={() => void requestVerification()}>Отправить код</Button>
              ) : (
                <form onSubmit={confirmVerification}>
                  <p className="mova-email-delivery-hint">{emailDeliveryHint}</p>
                  <label>
                    <span>Код из письма</span>
                    <input className="mova-auth-code" aria-label="Код подтверждения текущей почты" required pattern="[0-9]{6}" inputMode="numeric" maxLength={6} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} placeholder="000000" autoComplete="one-time-code" />
                  </label>
                  <div className="mova-account-settings__actions">
                    <Button type="submit" loading={verificationLoading}>Подтвердить</Button>
                    <Button type="button" variant="ghost" disabled={verificationLoading || verificationResendSeconds > 0} onClick={() => void requestVerification(true)}>{verificationResendSeconds > 0 ? `Повторить через ${verificationResendSeconds} сек.` : 'Отправить ещё раз'}</Button>
                  </div>
                </form>
              )}
              {verificationError && <div className="mova-auth-error">{verificationError}</div>}
            </div>
          </div>
        )}
        <div className="mova-account-email-current">
          <span>Текущий адрес</span>
          <strong>{user.email}</strong>
          <em className={user.emailVerifiedAt ? 'is-verified' : 'is-unverified'}>{user.emailVerifiedAt ? 'Подтверждена' : 'Требуется подтверждение'}</em>
        </div>
        {step === 'request' ? <form onSubmit={requestChange}>
          <label>
            <span>Новая почта</span>
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new@example.com" autoComplete="email" />
          </label>
          <label>
            <span>Текущий пароль</span>
            <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Подтвердите, что это вы" autoComplete="current-password" />
          </label>
          <Button type="submit" loading={loading}>Отправить код</Button>
        </form> : <form onSubmit={confirmChange}>
          <p>Мы отправили шестизначный код на <strong>{challenge?.email}</strong>. Он действует 10 минут.</p>
          <p className="mova-email-delivery-hint">{emailDeliveryHint}</p>
          <label>
            <span>Код из письма</span>
            <input className="mova-auth-code" required pattern="[0-9]{6}" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} placeholder="000000" autoComplete="one-time-code" />
          </label>
          <div className="mova-account-settings__actions">
            <Button type="submit" loading={loading}>Подтвердить почту</Button>
            <Button type="button" variant="ghost" disabled={loading || resendSeconds > 0} onClick={() => void resend()}>{resendSeconds > 0 ? `Повторить через ${resendSeconds} сек.` : 'Отправить ещё раз'}</Button>
            <Button type="button" variant="ghost" onClick={() => { setStep('request'); setCode(''); setChallenge(null); setResendSeconds(0); setError(''); setSuccess(''); }}>Назад</Button>
          </div>
        </form>}
        {error && <div className="mova-auth-error">{error}</div>}
        {success && <div className="mova-auth-success">{success}</div>}
      </section>
    </div>
  );
}

export function SettingsModal({ user, open, onClose, onEditProfile, onUserUpdate = () => undefined }: { user: AppUser; open: boolean; onClose: () => void; onEditProfile: () => void; onUserUpdate?: (user: AppUser) => void }) {
  const [section, setSection] = useState<'profile' | 'account' | 'appearance' | 'audio' | 'screen' | 'application'>('audio');
  const [settings, setSettings] = useState<AudioSettings>(defaultAudioSettings);
  const [screenSettings, setScreenSettings] = useState<ScreenShareSettings>(defaultScreenShareSettings);
  const [backgroundColor, setBackgroundColor] = useState(defaultBackgroundColor);
  const [accentColor, setAccentColor] = useState(defaultAccentColor);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [testProcessingStatus, setTestProcessingStatus] = useState('');
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [desktopSettingsError, setDesktopSettingsError] = useState('');
  const [gameActivityEnabled, setGameActivityEnabled] = useState(true);
  const [registeredGames, setRegisteredGames] = useState<DesktopRegisteredGame[]>([]);
  const [runningApplications, setRunningApplications] = useState<DesktopRunningApplication[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [registeredGameTitle, setRegisteredGameTitle] = useState('');
  const [gameRegistryLoading, setGameRegistryLoading] = useState(false);
  const testStream = useRef<MediaStream | null>(null);
  const testPipeline = useRef<MicrophonePipeline | null>(null);
  const testContext = useRef<AudioContext | null>(null);
  const animation = useRef<number | null>(null);
  const outputSelectionSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const stopTest = useCallback(() => {
    if (animation.current) cancelAnimationFrame(animation.current);
    animation.current = null;
    testPipeline.current?.close();
    testPipeline.current = null;
    testStream.current?.getTracks().forEach((track) => track.stop());
    testStream.current = null;
    void testContext.current?.close();
    testContext.current = null;
    setTesting(false);
    setLevel(0);
    setTestProcessingStatus('');
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
  const applyGameActivitySettings = useCallback((next: DesktopGameActivitySettings) => {
    setGameActivityEnabled(next.enabled);
    setRegisteredGames(next.registeredGames);
  }, []);
  const refreshRunningApplications = useCallback(async () => {
    const desktopShell = window.movaDesktopShell;
    if (!desktopShell?.listRunningApplications) return;
    setGameRegistryLoading(true);
    try {
      setDesktopSettingsError('');
      const applications = await desktopShell.listRunningApplications();
      setRunningApplications(applications);
      setSelectedApplicationId((current) => applications.some((item) => item.id === current && !item.registered)
        ? current
        : applications.find((item) => !item.registered)?.id || '');
    } catch {
      setDesktopSettingsError('Не удалось получить список запущенных приложений.');
    } finally {
      setGameRegistryLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open) {
      setSettings(loadAudioSettings());
      setScreenSettings(loadScreenShareSettings());
      setBackgroundColor(loadBackgroundColor());
      setAccentColor(loadAccentColor());
      setDesktopSettingsError('');
      if (window.movaDesktopShell?.getAutoLaunch) {
        void window.movaDesktopShell.getAutoLaunch().then(setAutoLaunch).catch(() => setDesktopSettingsError('Не удалось прочитать настройку автозапуска.'));
      }
      if (window.movaDesktopShell?.getGameActivitySettings) {
        void window.movaDesktopShell.getGameActivitySettings().then(applyGameActivitySettings).catch(() => setDesktopSettingsError('Не удалось прочитать настройки игровой активности.'));
      }
      void refreshDevices(false);
    } else stopTest();
  }, [applyGameActivitySettings, open, refreshDevices, stopTest]);
  useEffect(() => {
    if (open && section === 'application') void refreshRunningApplications();
  }, [open, refreshRunningApplications, section]);
  useEffect(() => {
    const application = runningApplications.find((item) => item.id === selectedApplicationId);
    setRegisteredGameTitle(application?.name || '');
  }, [runningApplications, selectedApplicationId]);
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
      const pipeline = await createMicrophonePipeline(stream, settings);
      testPipeline.current = pipeline;
      const context = new AudioContext();
      testContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(pipeline.stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setTesting(true);
      setTestProcessingStatus(
        settings.noiseSuppressionMode === 'enhanced'
          ? pipeline.enhanced
            ? 'Усиленное шумоподавление работает во время теста.'
            : 'Усиленный режим недоступен — используется встроенное шумоподавление.'
          : settings.noiseSuppressionMode === 'standard'
            ? 'Используется встроенное шумоподавление устройства.'
            : 'Шумоподавление выключено.',
      );
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
  const addRegisteredGame = async () => {
    const desktopShell = window.movaDesktopShell;
    if (!desktopShell?.registerGame || !selectedApplicationId) return;
    setGameRegistryLoading(true);
    try {
      setDesktopSettingsError('');
      applyGameActivitySettings(await desktopShell.registerGame(selectedApplicationId, registeredGameTitle));
      await refreshRunningApplications();
    } catch (error) {
      setDesktopSettingsError(error instanceof Error ? error.message : 'Не удалось добавить игру.');
    } finally {
      setGameRegistryLoading(false);
    }
  };
  const removeRegisteredGame = async (gameId: string) => {
    const desktopShell = window.movaDesktopShell;
    if (!desktopShell?.unregisterGame) return;
    setGameRegistryLoading(true);
    try {
      setDesktopSettingsError('');
      applyGameActivitySettings(await desktopShell.unregisterGame(gameId));
      await refreshRunningApplications();
    } catch (error) {
      setDesktopSettingsError(error instanceof Error ? error.message : 'Не удалось удалить игру из списка.');
    } finally {
      setGameRegistryLoading(false);
    }
  };
  const save = async () => {
    try {
      setDesktopSettingsError('');
      if (window.movaDesktopShell?.setAutoLaunch) await window.movaDesktopShell.setAutoLaunch(autoLaunch);
      if (window.movaDesktopShell?.setGameActivityEnabled) applyGameActivitySettings(await window.movaDesktopShell.setGameActivityEnabled(gameActivityEnabled));
    } catch {
      setDesktopSettingsError('Не удалось изменить автозапуск Mova.');
      return;
    }
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
          <button type="button" className={`${section === 'account' ? 'is-active' : ''}${!user.emailVerifiedAt && user.email ? ' has-notice' : ''}`} onClick={() => setSection('account')}>
            <AtSign size={17} />
            Аккаунт
            {!user.emailVerifiedAt && user.email && <i className="mova-settings-notice-dot" aria-hidden="true" />}
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
          {window.movaDesktopShell && (
            <button type="button" className={section === 'application' ? 'is-active' : ''} onClick={() => setSection('application')}>
              <Power size={17} />
              Приложение
            </button>
          )}
        </aside>
        <main>
          <header>
            <div>
              <h2 id="settings-title">{section === 'profile' ? 'Профиль' : section === 'account' ? 'Аккаунт' : section === 'appearance' ? 'Оформление' : section === 'screen' ? 'Демонстрация экрана' : section === 'application' ? 'Приложение' : 'Голос и звук'}</h2>
              <p>{section === 'profile' ? 'Отображение вашего аккаунта' : section === 'account' ? 'Почта и безопасность входа' : section === 'appearance' ? 'Цвет фона и акцента' : section === 'screen' ? 'Качество при включении демонстрации' : section === 'application' ? 'Запуск Mova и desktop-возможности' : 'Устройства и обработка голоса'}</p>
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
          ) : section === 'account' ? (
            <AccountEmailSettings user={user} onUserUpdate={onUserUpdate} />
          ) : section === 'appearance' ? (
            <BackgroundDefaults color={backgroundColor} onChange={setBackgroundColor} accentColor={accentColor} onAccentChange={setAccentColor} />
          ) : section === 'screen' ? (
            <ScreenShareDefaults settings={screenSettings} onChange={setScreenSettings} />
          ) : section === 'application' ? (
            <div className="mova-audio-settings mova-application-settings">
              <section>
                <h3><Power size={18} /> Запуск системы</h3>
                <ToggleSetting label="Запускать Mova с системой" description="Mova запустится свёрнутой в область уведомлений. По умолчанию включено." checked={autoLaunch} onChange={setAutoLaunch} />
              </section>
              <section className="mova-game-registry">
                <h3><Gamepad2 size={18} /> Игровая активность</h3>
                <ToggleSetting label="Показывать игровую активность" description="Mova определяет игры только на этом устройстве и отправляет друзьям название и иконку текущей игры." checked={gameActivityEnabled} onChange={setGameActivityEnabled} />
                {user.activity && gameActivityEnabled && (
                  <div className="mova-game-registry__current">
                    <GameActivityIcon activity={user.activity} size={34} />
                    <span><small>Сейчас определяется</small><strong>{user.activity.name}</strong></span>
                  </div>
                )}
                <div className="mova-game-registry__add">
                  <label>
                    <span>Добавить запущенное приложение как игру</span>
                    <select aria-label="Запущенное приложение" value={selectedApplicationId} onChange={(event) => setSelectedApplicationId(event.target.value)} disabled={gameRegistryLoading || !gameActivityEnabled}>
                      <option value="">{gameRegistryLoading ? 'Обновляем список…' : 'Выберите приложение'}</option>
                      {runningApplications.filter((item) => !item.registered).map((item) => <option key={item.id} value={item.id}>{item.name} — {item.executableName}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Название в Mova</span>
                    <input aria-label="Название добавляемой игры" value={registeredGameTitle} maxLength={80} disabled={!selectedApplicationId || gameRegistryLoading || !gameActivityEnabled} onChange={(event) => setRegisteredGameTitle(event.target.value)} />
                  </label>
                  <Button type="button" size="sm" leadingIcon={<Plus size={15} />} disabled={!selectedApplicationId || !registeredGameTitle.trim() || gameRegistryLoading || !gameActivityEnabled} onClick={() => void addRegisteredGame()}>Добавить игру</Button>
                  <Button type="button" size="sm" variant="ghost" leadingIcon={gameRegistryLoading ? <LoaderCircle className="mova-spin" size={15} /> : <RotateCcw size={15} />} disabled={gameRegistryLoading} onClick={() => void refreshRunningApplications()}>Обновить</Button>
                </div>
                <small>Steam, Epic Games, GOG и игры из macOS-категории Games распознаются автоматически, включая новые инди-игры. Ручное добавление нужно для самостоятельных игр и нестандартных лаунчеров.</small>
                {registeredGames.length > 0 && (
                  <div className="mova-game-registry__list" aria-label="Добавленные вручную игры">
                    <b>Добавленные игры</b>
                    {registeredGames.map((game) => (
                      <div key={game.id}>
                        <GameActivityIcon activity={{ name: game.title, iconDataUrl: game.iconDataUrl }} size={30} />
                        <span><strong>{game.title}</strong><small>{game.executableName}</small></span>
                        <IconButton label={`Удалить ${game.title}`} size="sm" disabled={gameRegistryLoading} onClick={() => void removeRegisteredGame(game.id)}><Trash2 size={15} /></IconButton>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {desktopSettingsError && <div className="mova-auth-error">{desktopSettingsError}</div>}
            </div>
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
                {testProcessingStatus && <small>{testProcessingStatus}</small>}
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
                <label>
                  <span>Шумоподавление</span>
                  <select
                    value={settings.noiseSuppressionMode}
                    onChange={(event) => setSettings(withNoiseSuppressionMode(settings, event.target.value as NoiseSuppressionMode))}
                  >
                    <option value="enhanced">Усиленное — голосовой фильтр RNNoise</option>
                    <option value="standard">Стандартное — обработка браузера</option>
                    <option value="off">Выключено</option>
                  </select>
                </label>
                <small>Усиленный режим лучше подавляет клавиатуру, клики и нерегулярные звуки, но немного увеличивает нагрузку на устройство.</small>
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
              {section === 'account' ? 'Закрыть' : 'Отмена'}
            </Button>
            {section !== 'account' && <Button onClick={() => void save()}>Сохранить настройки</Button>}
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
          <GameActivityIcon activity={user.activity} size={28} />
          <span>
            <strong>Играет в {user.activity.name}</strong>
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
        <span>Неактивен</span>
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

export function AuthScreen({ onAuth }: { onAuth: (user: AppUser) => void }) {
  const [flow, setFlow] = useState<'login' | 'register' | 'register-code' | 'forgot' | 'reset-code'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [code, setCode] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);
  const registrationFlow = flow === 'register' || flow === 'register-code';
  const switchFlow = (next: 'login' | 'register' | 'forgot') => {
    setFlow(next);
    setChallenge(null);
    setResendSeconds(0);
    setCode('');
    setNewPassword('');
    setError('');
    setSuccess('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      if (flow === 'login') {
        const result = await api.login(form);
        session.set(result.token);
        onAuth(result.user);
      } else if (flow === 'register') {
        const result = await api.register(form);
        setChallenge(result);
        setResendSeconds(result.resendAfterSeconds);
        setFlow('register-code');
      } else if (flow === 'register-code' && challenge) {
        const result = await api.verifyRegistration(challenge.challengeId, code);
        session.set(result.token);
        onAuth(result.user);
      } else if (flow === 'forgot') {
        const result = await api.requestPasswordReset(form.email);
        setChallenge(result);
        setResendSeconds(result.resendAfterSeconds);
        setFlow('reset-code');
      } else if (flow === 'reset-code' && challenge) {
        await api.confirmPasswordReset(challenge.challengeId, code, newPassword);
        setFlow('login');
        setForm({ ...form, password: '' });
        setChallenge(null);
        setResendSeconds(0);
        setCode('');
        setNewPassword('');
        setSuccess('Пароль изменён. Теперь можно войти.');
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };
  const resend = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = flow === 'register-code' ? await api.register(form) : await api.requestPasswordReset(form.email);
      setChallenge(result);
      setCode('');
      setResendSeconds(result.resendAfterSeconds);
      setSuccess('Новый код отправлен.');
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Не удалось отправить новый код');
    } finally {
      setLoading(false);
    }
  };
  const title = flow === 'register-code' ? 'Подтвердите почту' : flow === 'forgot' ? 'Восстановление пароля' : flow === 'reset-code' ? 'Новый пароль' : 'Mova';
  const subtitle = flow === 'register-code' || flow === 'reset-code'
    ? `Код отправлен на ${challenge?.email || form.email}`
    : flow === 'forgot'
      ? 'Отправим код на почту аккаунта'
      : flow === 'register'
        ? 'Создайте аккаунт'
        : 'Войдите в свой аккаунт';
  return (
    <main className="mova-auth">
      <div className="mova-auth__aurora" />
      <section className="mova-auth__panel">
        <div className="mova-glass-card mova-auth-card">
          <header>
            <img className="mova-auth-logo" src="/mova-logo.png" alt="" />
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>
          {!['register-code', 'forgot', 'reset-code'].includes(flow) && <div className="mova-auth-tabs" role="tablist" aria-label="Вход или регистрация">
            <button type="button" role="tab" aria-selected={flow === 'login'} className={flow === 'login' ? 'is-active' : ''} onClick={() => switchFlow('login')}>Вход</button>
            <button type="button" role="tab" aria-selected={flow === 'register'} className={flow === 'register' ? 'is-active' : ''} onClick={() => switchFlow('register')}>Регистрация</button>
          </div>}
          <form onSubmit={submit}>
            {['register-code', 'reset-code'].includes(flow) && <p className="mova-email-delivery-hint">{emailDeliveryHint}</p>}
            {flow === 'register' && (
              <label>
                <span>Имя</span>
                <input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ваше имя" autoComplete="name" />
              </label>
            )}
            {['login', 'register', 'forgot'].includes(flow) && <label>
              <span>Почта</span>
              <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" autoComplete="email" />
            </label>}
            {['login', 'register'].includes(flow) && <label>
              <span>Пароль</span>
              <input required minLength={8} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Не менее 8 символов" autoComplete={flow === 'register' ? 'new-password' : 'current-password'} />
            </label>}
            {['register-code', 'reset-code'].includes(flow) && <label>
              <span>Код из письма</span>
              <input className="mova-auth-code" required pattern="[0-9]{6}" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} placeholder="000000" autoComplete="one-time-code" />
            </label>}
            {flow === 'reset-code' && <label>
              <span>Новый пароль</span>
              <input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Не менее 8 символов" autoComplete="new-password" />
            </label>}
            {error && <div className="mova-auth-error">{error}</div>}
            {success && <div className="mova-auth-success">{success}</div>}
            <Button type="submit" size="lg" loading={loading}>
              {flow === 'register' ? 'Получить код' : flow === 'register-code' ? 'Подтвердить и войти' : flow === 'forgot' ? 'Отправить код' : flow === 'reset-code' ? 'Изменить пароль' : 'Войти'}
            </Button>
            {flow === 'login' && <button type="button" className="mova-auth-link" onClick={() => switchFlow('forgot')}>Забыли пароль?</button>}
            {['register-code', 'reset-code'].includes(flow) && <button type="button" className="mova-auth-link" disabled={loading || resendSeconds > 0} onClick={() => void resend()}>{resendSeconds > 0 ? `Новый код через ${resendSeconds} сек.` : 'Отправить код ещё раз'}</button>}
            {['register-code', 'forgot', 'reset-code'].includes(flow) && <button type="button" className="mova-auth-link" onClick={() => switchFlow(registrationFlow ? 'register' : 'login')}>Назад</button>}
          </form>
          <footer>Продолжая, вы соглашаетесь с правилами сервиса.</footer>
        </div>
      </section>
    </main>
  );
}

function ConversationAvatar({ conversation, currentUser }: { conversation: AppConversation; currentUser: AppUser }) {
  if (conversation.kind === 'saved') return <span className="mova-avatar mova-avatar--lg mova-saved-avatar" aria-label="Избранное"><Bookmark size={25} fill="currentColor" /></span>;
  if (conversation.kind === 'group') return <Avatar name={conversation.title} src={conversation.avatarDataUrl} color="#ff9638" size="lg" />;
  const person = conversation.members.find((member) => member.id !== currentUser.id) ?? currentUser;
  return <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} status={avatarStatus(person.presence, person.isOnline)} size="lg" />;
}

const groupMemberRole = (conversation: AppConversation, userId: string): 'owner' | 'admin' | 'member' =>
  conversation.memberRoles?.[userId] || (conversation.createdBy === userId ? 'owner' : 'member');

const groupRoleLabel = (role: 'owner' | 'admin' | 'member') => role === 'owner' ? 'Владелец' : role === 'admin' ? 'Администратор' : '';

export function CreateGroup({ open, users, onClose, onCreated }: { open: boolean; users: AppUser[]; onClose: () => void; onCreated: (conversation: AppConversation) => void }) {
  const [step, setStep] = useState<'members' | 'details'>('members');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (open) {
      setStep('members');
      setTitle('');
      setSelected([]);
      setMemberQuery('');
      setAvatarDataUrl('');
      setImageLoading(false);
      setError('');
    }
  }, [open]);
  const friends = useMemo(() => users.filter((user) => user.relationship === 'friend'), [users]);
  const selectedUsers = useMemo(
    () => selected.map((id) => friends.find((user) => user.id === id)).filter((user): user is AppUser => Boolean(user)),
    [friends, selected],
  );
  const visibleUsers = useMemo(() => {
    const normalizedQuery = memberQuery.trim().toLocaleLowerCase();
    return normalizedQuery
      ? friends.filter((user) => `${user.name} ${user.handle}`.toLocaleLowerCase().includes(normalizedQuery))
      : friends;
  }, [friends, memberQuery]);
  const selectGroupImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Выберите изображение для группы');
      return;
    }
    setImageLoading(true);
    setError('');
    try {
      const prepared = await prepareImageDataUrl(file, { maxDimension: 1024, maxBytes: 650_000, quality: 0.94, skipBelowBytes: 120_000 });
      setAvatarDataUrl(prepared.dataUrl);
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : 'Не удалось подготовить изображение');
    } finally {
      setImageLoading(false);
    }
  };
  const create = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.createConversation({
        kind: 'group',
        title,
        memberIds: selected,
        avatarDataUrl,
      });
      onCreated(result.conversation);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Не удалось создать чат');
    } finally {
      setLoading(false);
    }
  };
  return (
    <DialogSurface open={open} onClose={onClose} className="mova-group-create-modal" labelledBy="group-create-title" initialFocus="first">
      <header>
        <IconButton
          data-dialog-close={step === 'members' || undefined}
          label={step === 'members' ? 'Закрыть создание группы' : 'Назад к выбору участников'}
          onClick={step === 'members' ? onClose : () => { setStep('members'); setError(''); }}
        >
          <ArrowLeft size={23} />
        </IconButton>
        <h2 id="group-create-title">{step === 'members' ? 'Добавить участников' : 'Создать группу'}</h2>
      </header>
      {step === 'members' ? (
        <div className="mova-group-members-step">
          <label className="mova-group-create-search">
            <Search size={20} />
            <input data-dialog-initial autoFocus value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск друзей" />
            {memberQuery && <button type="button" aria-label="Очистить поиск друзей" onClick={() => setMemberQuery('')}><X size={16} /></button>}
          </label>
          <div className="mova-group-friends" aria-label="Друзья">
            {!friends.length ? (
              <div className="mova-group-create-empty"><UserPlus size={28} /><strong>Сначала добавьте друзей</strong><span>В группу можно пригласить людей из списка друзей.</span></div>
            ) : !visibleUsers.length ? (
              <div className="mova-group-create-empty"><Search size={28} /><strong>Ничего не найдено</strong><span>Попробуйте изменить запрос.</span></div>
            ) : visibleUsers.map((person) => {
              const active = selected.includes(person.id);
              return (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  key={person.id}
                  className={active ? 'is-active' : ''}
                  onClick={() => setSelected((items) => active ? items.filter((id) => id !== person.id) : items.length < 199 ? [...items, person.id] : items)}
                >
                  <i>{active && <Check size={15} />}</i>
                  <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} size="md" />
                  <span><strong><AppleEmoji text={person.name} /></strong><small>{formatPresenceStatus(person)}</small></span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mova-group-details-step">
          <section className="mova-group-details-card">
            <label className={`mova-group-photo${avatarDataUrl ? ' has-image' : ''}`} aria-label="Выбрать фото группы">
              {avatarDataUrl ? <img src={avatarDataUrl} alt="Фото группы" /> : <><Camera size={39} /><Plus size={20} /></>}
              {imageLoading && <span><LoaderCircle className="mova-spin" size={25} /></span>}
              <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void selectGroupImage(file); }} />
            </label>
            <label className="mova-group-title-field">
              <span>Название группы</span>
              <input data-dialog-initial autoFocus value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} aria-label="Название группы" />
            </label>
          </section>
          <section className="mova-group-selected-card" aria-label="Участники группы">
            <h3>{selectedUsers.length} {russianCount(selectedUsers.length, 'участник', 'участника', 'участников')}</h3>
            {selectedUsers.map((person) => (
              <div key={person.id}>
                <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} size="md" />
                <span><strong><AppleEmoji text={person.name} /></strong><small>{formatPresenceStatus(person)}</small></span>
              </div>
            ))}
          </section>
        </div>
      )}
      {error && <div className="mova-group-create-error" role="alert">{error}</div>}
      <button
        type="button"
        className="mova-group-create-next"
        aria-label={step === 'members' ? 'Перейти к названию группы' : 'Создать группу'}
        aria-busy={loading || imageLoading || undefined}
        disabled={!selected.length || loading || imageLoading || (step === 'details' && title.trim().length < 2)}
        onClick={() => step === 'members' ? setStep('details') : void create()}
      >
        {loading ? <LoaderCircle className="mova-spin" size={24} /> : <ArrowRight size={27} />}
        {selected.length > 0 && step === 'members' && <b>{selected.length}</b>}
      </button>
    </DialogSurface>
  );
}

type GroupEditorView = 'details' | 'members' | 'admins' | 'add';

function GroupEditor({ conversation, currentUser, users, onClose, onUpdated }: { conversation: AppConversation; currentUser: AppUser; users: AppUser[]; onClose: () => void; onUpdated: (conversation: AppConversation) => void }) {
  const [view, setView] = useState<GroupEditorView>('details');
  const [localConversation, setLocalConversation] = useState(conversation);
  const [title, setTitle] = useState(conversation.title);
  const [titleChanged, setTitleChanged] = useState(false);
  const [avatarDataUrl, setAvatarDataUrl] = useState(conversation.avatarDataUrl || '');
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [avatarCrop, setAvatarCrop] = useState<AvatarCropDraft | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [removingUser, setRemovingUser] = useState<AppUser | null>(null);
  const draftConversationId = useRef(conversation.id);
  useEffect(() => {
    const conversationChanged = draftConversationId.current !== conversation.id;
    draftConversationId.current = conversation.id;
    setLocalConversation(conversation);
    if (conversationChanged || !titleChanged) {
      setTitle(conversation.title);
      if (conversationChanged) setTitleChanged(false);
    }
    if (conversationChanged || (!avatarChanged && !avatarCrop)) {
      setAvatarDataUrl(conversation.avatarDataUrl || '');
      if (conversationChanged) {
        setAvatarChanged(false);
        setAvatarCrop(null);
      }
    }
  }, [conversation, titleChanged, avatarChanged, avatarCrop]);
  useEffect(() => {
    setView('details');
    setQuery('');
    setError('');
    setRemovingUser(null);
  }, [conversation.id]);
  const currentRole = groupMemberRole(localConversation, currentUser.id);
  const isOwner = currentRole === 'owner';
  const adminCount = localConversation.members.filter((member) => ['owner', 'admin'].includes(groupMemberRole(localConversation, member.id))).length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleMembers = localConversation.members.filter((member) => !normalizedQuery || `${member.name} ${member.handle}`.toLocaleLowerCase().includes(normalizedQuery));
  const addableMembers = users.filter((member) => member.relationship === 'friend' && !localConversation.members.some((existing) => existing.id === member.id) && (!normalizedQuery || `${member.name} ${member.handle}`.toLocaleLowerCase().includes(normalizedQuery)));
  const applyConversation = (updated: AppConversation) => {
    draftConversationId.current = updated.id;
    setLocalConversation(updated);
    setTitle(updated.title);
    setTitleChanged(false);
    setAvatarDataUrl(updated.avatarDataUrl || '');
    setAvatarChanged(false);
    setAvatarCrop(null);
    onUpdated(updated);
  };
  const selectGroupImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Выберите изображение для группы');
      return;
    }
    if (file.size > 30_000_000) {
      setError('Фотография должна быть меньше 30 МБ');
      return;
    }
    setImageLoading(true);
    setError('');
    try {
      setAvatarCrop({ file, previewUrl: await fileToDataUrl(file) });
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : 'Не удалось подготовить изображение');
    } finally {
      setImageLoading(false);
    }
  };
  const saveDetails = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.updateConversation(localConversation.id, { title, ...(avatarChanged ? { avatarDataUrl } : {}) });
      applyConversation(result.conversation);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить группу');
    } finally {
      setBusy(false);
    }
  };
  const addMember = async (member: AppUser) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.addConversationMembers(localConversation.id, [member.id]);
      applyConversation(result.conversation);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Не удалось добавить участника');
    } finally {
      setBusy(false);
    }
  };
  const changeRole = async (member: AppUser, role: 'admin' | 'member') => {
    setBusy(true);
    setError('');
    try {
      const result = await api.setConversationMemberRole(localConversation.id, member.id, role);
      applyConversation(result.conversation);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Не удалось изменить роль');
    } finally {
      setBusy(false);
    }
  };
  const removeMember = async () => {
    if (!removingUser) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.removeConversationMember(localConversation.id, removingUser.id);
      applyConversation(result.conversation);
      setRemovingUser(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Не удалось удалить участника');
      setRemovingUser(null);
    } finally {
      setBusy(false);
    }
  };
  const titleByView = view === 'details' ? 'Изменить' : view === 'members' ? 'Участники' : view === 'admins' ? 'Администраторы' : 'Добавить участников';
  const goBack = () => {
    setError('');
    setQuery('');
    if (view === 'add') setView('members');
    else if (view !== 'details') setView('details');
    else onClose();
  };
  const renderMember = (member: AppUser, mode: 'members' | 'admins' | 'add') => {
    const role = groupMemberRole(localConversation, member.id);
    const canRemove = mode === 'members' && role !== 'owner' && (isOwner || role === 'member');
    const isAdmin = role === 'admin';
    return (
      <div className="mova-group-manage-member" key={member.id}>
        <Avatar name={member.name} src={member.avatarDataUrl} color={member.color} status={avatarStatus(member.presence, member.isOnline)} size="md" />
        <span><strong><AppleEmoji text={member.name} /></strong><small>{groupRoleLabel(role) || formatPresenceStatus(member)}</small></span>
        {mode === 'add' && <button type="button" disabled={busy} onClick={() => void addMember(member)}>Добавить</button>}
        {mode === 'members' && canRemove && <IconButton label={`Удалить ${member.name} из группы`} disabled={busy} onClick={() => setRemovingUser(member)}><UserMinus size={19} /></IconButton>}
        {mode === 'admins' && role === 'owner' && <b>Владелец</b>}
        {mode === 'admins' && role !== 'owner' && isOwner && <button type="button" disabled={busy} onClick={() => void changeRole(member, isAdmin ? 'member' : 'admin')}>{isAdmin ? 'Снять' : 'Назначить'}</button>}
      </div>
    );
  };
  return (
    <>
      <div className="mova-group-editor">
        {avatarCrop ? (
          <div className="mova-group-crop-view">
            <AvatarCropEditor
              draft={avatarCrop}
              subject="group"
              onCancel={() => setAvatarCrop(null)}
              onApply={(nextAvatarDataUrl) => {
                setAvatarDataUrl(nextAvatarDataUrl);
                setAvatarChanged(true);
                setAvatarCrop(null);
              }}
              showError={setError}
            />
          </div>
        ) : <>
          <header>
            <IconButton label="Назад" onClick={goBack}><ArrowLeft size={23} /></IconButton>
            <h2 key={view} id="group-edit-title">{titleByView}</h2>
            {view === 'details' && <button type="button" className="mova-group-edit-save" disabled={busy || imageLoading || title.trim().length < 2 || (title.trim() === localConversation.title && !avatarChanged)} onClick={() => void saveDetails()}>{busy ? <LoaderCircle className="mova-spin" size={19} /> : 'Готово'}</button>}
          </header>
          {view === 'details' ? (
          <div key={view} className="mova-group-edit-body mova-group-editor-view">
            <section className="mova-group-edit-profile">
              <label className="mova-group-edit-photo" aria-label="Изменить фото группы">
                <Avatar name={localConversation.title} src={avatarDataUrl} color="#ff9638" size="xl" />
                <span>{imageLoading ? <LoaderCircle className="mova-spin" size={24} /> : <><Camera size={31} /><Plus size={17} /></>}</span>
                <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void selectGroupImage(file); }} />
              </label>
              <label className="mova-group-title-field"><span>Название группы</span><input value={title} maxLength={80} onChange={(event) => { setTitle(event.target.value); setTitleChanged(true); }} aria-label="Название группы" /></label>
            </section>
            <section className="mova-group-edit-actions">
              <button type="button" onClick={() => setView('admins')}><ShieldCheck size={24} /><span><strong>Администраторы</strong><small>{adminCount}</small></span><ChevronRight size={19} /></button>
              <button type="button" onClick={() => setView('members')}><Users size={24} /><span><strong>Участники</strong><small>{localConversation.members.length}</small></span><ChevronRight size={19} /></button>
            </section>
            {!isOwner && <p className="mova-group-edit-hint">Назначать администраторов может только владелец группы.</p>}
          </div>
        ) : (
          <div key={view} className="mova-group-manage-body mova-group-editor-view">
            {(view === 'members' || view === 'add') && <label className="mova-group-create-search"><Search size={20} /><input data-dialog-initial autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" aria-label={view === 'add' ? 'Поиск новых участников' : 'Поиск участников'} />{query && <button type="button" aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={16} /></button>}</label>}
            {view === 'members' && <button type="button" className="mova-group-add-members" onClick={() => { setView('add'); setQuery(''); }}><UserPlus size={21} /><span>Добавить участников</span><ChevronRight size={18} /></button>}
            {view === 'admins' && !isOwner && <p className="mova-group-manage-note">Список администраторов. Изменять роли может только владелец.</p>}
            <section className="mova-group-manage-list" aria-label={titleByView}>
              {view === 'add'
                ? (addableMembers.length ? addableMembers.map((member) => renderMember(member, 'add')) : <div className="mova-group-create-empty"><UserPlus size={28} /><strong>Некого добавлять</strong><span>Здесь появятся друзья, которых ещё нет в группе.</span></div>)
                : view === 'admins'
                  ? localConversation.members.filter((member) => ['owner', 'admin'].includes(groupMemberRole(localConversation, member.id)) || isOwner).map((member) => renderMember(member, 'admins'))
                  : visibleMembers.map((member) => renderMember(member, 'members'))}
            </section>
          </div>
          )}
        </>}
        {error && <div className="mova-group-edit-error" role="alert">{error}</div>}
      </div>
      <ConfirmDialog open={Boolean(removingUser)} title="Удалить участника?" description={removingUser ? `${removingUser.name} больше не сможет читать и отправлять сообщения в этой группе.` : ''} confirmLabel="Удалить из группы" onCancel={() => !busy && setRemovingUser(null)} onConfirm={() => void removeMember()} />
    </>
  );
}

function LegacyVoiceCallBar({ conversation, currentUser, onOpenSettings = () => window.dispatchEvent(new Event('mova-open-settings')) }: { conversation: AppConversation; currentUser: AppUser; onOpenSettings?: () => void }) {
  const call = useVoiceCall(conversation.id, currentUser.id, { direct: conversation.kind === 'direct' });
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

function CallFloatingLayer({ portalled, children }: { portalled: boolean; children: ReactNode }) {
  return portalled ? createPortal(<>{children}</>, document.body) : children;
}

const selfViewMinWidth = 72;
const selfViewMaxWidth = 320;
function ResizableSelfView({ children }: { children: ReactNode }) {
  const mobile = useMobileNavigationViewport();
  const [width, setWidth] = useState<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; width: number } | null>(null);
  const clampWidth = useCallback((value: number) => {
    const viewportWidth = window.visualViewport?.width || window.innerWidth || 390;
    const maximum = Math.max(selfViewMinWidth, Math.min(selfViewMaxWidth, viewportWidth - 20, viewportWidth * .72));
    return Math.round(Math.min(maximum, Math.max(selfViewMinWidth, value)));
  }, []);
  const beginPinch = (element: HTMLDivElement) => {
    if (pointers.current.size !== 2) return;
    const [first, second] = [...pointers.current.values()];
    pinch.current = {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      width: element.getBoundingClientRect().width || width || 112,
    };
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mobile || event.pointerType !== 'touch') return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginPinch(event.currentTarget);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mobile || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size !== 2) return;
    if (!pinch.current) beginPinch(event.currentTarget);
    const gesture = pinch.current;
    if (!gesture) return;
    const [first, second] = [...pointers.current.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    event.preventDefault();
    setWidth(clampWidth(gesture.width * distance / gesture.distance));
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  useEffect(() => {
    if (mobile) return;
    pointers.current.clear();
    pinch.current = null;
  }, [mobile]);
  return (
    <div
      className="mova-call-self-view"
      data-pinch-resizable={mobile ? 'true' : undefined}
      style={mobile && width ? { width: `${width}px` } : undefined}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      {children}
    </div>
  );
}

const screenAudioWarningPrefix = 'Экран демонстрируется без звука.';
const browserScreenAudioToastText = 'Демонстрация без звука. Включите «Поделиться аудио» при выборе экрана.';
const desktopScreenAudioToastText = 'Системный звук отключён, чтобы голоса звонка не дублировались.';
const isScreenAudioWarning = (error: string) => error.startsWith(screenAudioWarningPrefix);
type VoiceCallController = ReturnType<typeof useVoiceCall>;

function VoiceCallBar({ conversation, callConversation, currentUser, call, canvasOpen, stageHost, bannerHost, chatOpen, unreadCount, onToggleChat, onOpenCanvas, onMinimizeCanvas, onStartCall, canCall = true, onOpenSettings = () => window.dispatchEvent(new Event('mova-open-settings')) }: { conversation: AppConversation; callConversation: AppConversation; currentUser: AppUser; call: VoiceCallController; canvasOpen: boolean; stageHost: HTMLElement | null; bannerHost: HTMLElement | null; chatOpen: boolean; unreadCount: number; onToggleChat: () => void; onOpenCanvas: () => void; onMinimizeCanvas: () => void; onStartCall: (video: boolean) => void; canCall?: boolean; onOpenSettings?: () => void }) {
  const callState = normalizeCallState(call.state);
  const sameConversation = conversation.id === callConversation.id;
  const [moreOpen, setMoreOpen] = useState(false);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  const [showSelf, setShowSelf] = useState(true);
  const [showNoVideo, setShowNoVideo] = useState(true);
  const [participantRailVisible, setParticipantRailVisible] = useState(true);
  const [expandedMedia, setExpandedMedia] = useState(false);
  const [screenAudioToast, setScreenAudioToast] = useState('');
  const [screenAudioToastVisible, setScreenAudioToastVisible] = useState(false);
  const [screenQuality, setScreenQuality] = useState<ScreenShareQuality>(() => loadScreenShareSettings());
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [diagnosticCopyState, setDiagnosticCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const diagnosticCopyTimer = useRef<number | null>(null);
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
  useEffect(() => () => {
    if (diagnosticCopyTimer.current !== null) window.clearTimeout(diagnosticCopyTimer.current);
  }, []);
  const copyCallDiagnostics = useCallback(async () => {
    try {
      await copyDiagnosticReport(buildCallDiagnosticReport({ state: callState, startedAt: call.startedAt, diagnostics: call.diagnostics }));
      setDiagnosticCopyState('copied');
    } catch {
      setDiagnosticCopyState('error');
    }
    if (diagnosticCopyTimer.current !== null) window.clearTimeout(diagnosticCopyTimer.current);
    diagnosticCopyTimer.current = window.setTimeout(() => setDiagnosticCopyState('idle'), 2_500);
  }, [call.diagnostics, call.startedAt, callState]);
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
    setScreenAudioToast(window.movaDesktopShell ? desktopScreenAudioToastText : browserScreenAudioToastText);
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
  const callButton = (
    <Button variant="secondary" size="sm" aria-label={canCall ? 'Позвонить' : 'Звонки доступны только друзьям'} disabled={!canCall} leadingIcon={<Phone size={16} />} onClick={() => onStartCall(false)}>
      Позвонить
    </Button>
  );
  const callButtonWithHint = canCall ? callButton : <Tooltip label="Вы не в друзьях" side="bottom">{callButton}</Tooltip>;
  if (!sameConversation)
    return callButtonWithHint;
  if (callState === 'idle')
    return callButtonWithHint;
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
    const microphoneSending = call.localSpeaking;
    const microphoneReceiving = peerDiagnostics.some((peer) => peer.inboundAudioBytes > 0);
    const networkQuality = !peerDiagnostics.length ? 'unknown' : peerDiagnostics.some((peer) => peer.quality === 'poor') ? 'poor' : peerDiagnostics.some((peer) => peer.quality === 'fair') ? 'fair' : 'good';
    const latency = peerDiagnostics.reduce<number | undefined>((maximum, peer) => (peer.roundTripTimeMs === undefined ? maximum : Math.max(maximum ?? 0, peer.roundTripTimeMs)), undefined);
    const latencyLabel = latency === undefined ? 'Измеряем задержку…' : `Задержка ${latency} мс`;
    const relayed = peerDiagnostics.some((peer) => peer.candidateType?.includes('relay'));
    const routeProtocol = peerDiagnostics.find((peer) => peer.protocol)?.protocol?.toUpperCase();
    const routeLabel = peerDiagnostics.length ? `${relayed ? 'Маршрут через TURN' : 'Прямой маршрут'}${routeProtocol ? ` · ${routeProtocol}` : ''}` : '';
    const screenFpsValues = peerDiagnostics.map((peer) => peer.outboundScreenFramesPerSecond).filter((value): value is number => value !== undefined);
    const screenBitrateValues = peerDiagnostics.map((peer) => peer.outboundScreenBitrateKbps).filter((value): value is number => value !== undefined);
    const outboundScreenFps = screenFpsValues.length ? Math.min(...screenFpsValues) : undefined;
    const outboundScreenBitrate = screenBitrateValues.length ? Math.min(...screenBitrateValues) : undefined;
    const screenLimit = peerDiagnostics.find((peer) => peer.screenQualityLimitationReason)?.screenQualityLimitationReason;
    const screenLimitLabel = screenLimit === 'bandwidth' ? 'ограничено сетью' : screenLimit === 'cpu' ? 'ограничено процессором' : screenLimit ? 'качество ограничено браузером' : '';
    const screenTelemetryLabel = localScreen && outboundScreenFps !== undefined
      ? `Демонстрация ${outboundScreenFps} FPS${outboundScreenBitrate === undefined ? '' : ` · ${(outboundScreenBitrate / 1000).toFixed(1)} Мбит/с`}${screenLimitLabel ? ` · ${screenLimitLabel}` : ''}`
      : '';
    const networkTooltip = [latencyLabel, routeLabel, screenTelemetryLabel].filter(Boolean).join(' · ');
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
          <CallVideoTile key="local-camera" participantId={currentUser.id} stream={localCamera} label={`${currentUser.name} · вы`} mirrored kind="camera" muted={call.muted} deafened={call.deafened} speaking={microphoneSending} connectionState={selfConnectionState} screenSharing={Boolean(localScreen)} selfView onExpandedStateChange={setExpandedMedia} />
        ) : (
          <CallAvatarTile key="local-avatar" participantId={currentUser.id} user={currentUser} label={`${currentUser.name} · вы`} muted={call.muted} deafened={call.deafened} speaking={microphoneSending} connectionState={selfConnectionState} screenSharing={Boolean(localScreen)} selfView />
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
        <CallVideoTile key={`${userId}-${cameraTile.streamId}`} {...sharedProps} stream={cameraTile.stream} kind="camera" onExpandedStateChange={setExpandedMedia} />
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
                <div className={`mova-network-quality is-${networkQuality}`} aria-label={`Качество соединения: ${networkLabel}. ${networkTooltip}`} data-tooltip={networkTooltip}>
                  <span className="mova-network-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <IconButton
                  label={diagnosticCopyState === 'copied' ? 'Отчёт о звонке скопирован' : diagnosticCopyState === 'error' ? 'Не удалось скопировать отчёт' : 'Скопировать отчёт о звонке'}
                  className={`mova-call-diagnostics-copy${diagnosticCopyState === 'copied' ? ' is-copied' : diagnosticCopyState === 'error' ? ' is-error' : ''}`}
                  onClick={() => void copyCallDiagnostics()}
                >
                  {diagnosticCopyState === 'copied' ? <Check size={17} /> : <Copy size={17} />}
                </IconButton>
              </div>
              <span>
                <strong>{callConversation.title}</strong>
                <small>{formatCallDuration(activeSeconds)} · голосовой разговор</small>
              </span>
            </header>
            {hasScreen ? (
              <div className={`mova-call-grid has-screen${participantRailVisible ? '' : ' is-rail-collapsed'}`} data-call-layout="screen-share" data-participant-count={participantTiles.length} data-participant-layout={participantTiles.length >= 5 ? 'many' : participantTiles.length} data-participant-rail={participantRailVisible ? 'visible' : 'hidden'}>
                <div className="mova-call-screen-area">
                  {localScreen && <CallVideoTile participantId={currentUser.id} stream={localScreen} label="Ваш экран" kind="screen" muted={call.muted} deafened={call.deafened} connectionState={selfConnectionState} screenSharing onExpandedStateChange={setExpandedMedia} />}
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
                        onExpandedStateChange={setExpandedMedia}
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
                {selfTile && remoteParticipantTiles.length > 0 && <ResizableSelfView>{selfTile}</ResizableSelfView>}
              </div>
            )}
            <CallFloatingLayer portalled={expandedMedia}>
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
                badge={!chatOpen && unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined}
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
            </CallFloatingLayer>
            {screenMenuOpen && localScreen && (
              <CallFloatingLayer portalled={expandedMedia}>
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
              </CallFloatingLayer>
            )}
            {moreOpen && (
              <CallFloatingLayer portalled={expandedMedia}>
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
              </CallFloatingLayer>
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
  const mobileCallLayout = typeof window !== 'undefined' && !window.movaDesktopShell && (window.matchMedia?.(mobileNavigationQuery).matches ?? false);
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
      {!(mobileCallLayout && className.includes('is-self')) && <CallTileLabel label={label} muted={muted} deafened={deafened} screen={screen} screenSharing={screenSharing} />}
      {menuPoint && volume && <CallVolumeMenu control={volume} point={menuPoint} onClose={() => setMenuPoint(null)} />}
    </article>
  );
  return expanded && !mobileCallLayout ? createPortal(tile, document.body) : tile;
}
function CallVideoTile({ participantId, stream, label, kind, mirrored = false, muted, deafened, speaking = false, connectionState, screenSharing = false, selfView = false, volume, onExpandedStateChange }: { participantId: string; stream: MediaStream; label: string; kind: 'camera' | 'screen'; mirrored?: boolean; muted?: boolean; deafened?: boolean; speaking?: boolean; connectionState: ParticipantConnectionState; screenSharing?: boolean; selfView?: boolean; volume?: CallVolumeControl; onExpandedStateChange?: (expanded: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [sourceAspectRatio, setSourceAspectRatio] = useState(() => kind === 'screen' ? streamAspectRatio(stream) : undefined);
  const changeExpanded = useCallback((next: boolean) => {
    setExpanded(next);
    onExpandedStateChange?.(next);
  }, [onExpandedStateChange]);
  useEffect(() => () => {
    if (expanded) onExpandedStateChange?.(false);
  }, [expanded, onExpandedStateChange]);
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
    <CallTileShell className={`has-video is-${kind}${selfView ? ' is-self' : ''}`} participantId={participantId} label={label} muted={muted} deafened={deafened} screen={kind === 'screen'} screenSharing={screenSharing || kind === 'screen'} speaking={speaking} connectionState={connectionState} expandable={!selfView} expanded={expanded} onExpandedChange={changeExpanded} volume={volume} mediaAspectRatio={sourceAspectRatio}>
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
  unreadCount?: number;
  loading?: boolean;
  historyError?: boolean;
  hasOlderMessages?: boolean;
  loadingOlderMessages?: boolean;
  olderHistoryError?: boolean;
  typingUserIds?: string[];
  mobileActive?: boolean;
  onMobileBack?: () => void;
  onCallOpenChange?: (open: boolean) => void;
  onSend: (content: string, attachment?: MessageAttachment, replyToId?: string) => Promise<void>;
  onRetry?: (message: AppMessage) => Promise<void>;
  onRetryHistory?: () => void;
  onLoadOlder?: () => Promise<void>;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  availableConversations?: AppConversation[];
  onPinMessage?: (messageId: string, pinned: boolean) => Promise<void>;
  onForwardMessage?: (messageId: string, conversationId: string) => Promise<void>;
  onOpenForwardSource?: (source: ForwardedMessageSource) => Promise<void>;
  onDeleteMessage?: (messageId: string, scope?: 'self' | 'everyone') => Promise<void>;
  onDeleteConversation?: () => void;
  availableUsers?: AppUser[];
  onConversationChange?: (conversation: AppConversation) => void;
  onOpenDirectConversation?: (user: AppUser) => void | Promise<void>;
  onStartDirectCall?: (user: AppUser, video: boolean) => void | Promise<void>;
  onRelationshipChange?: (user: AppUser) => void;
  onMarkRead?: (throughMessageId: string) => Promise<void>;
  onVoiceListen?: (messageId: string) => Promise<void>;
  draftText?: string;
  onDraftChange?: (text: string) => void;
  focusMessageId?: string | null;
  onFocusMessageHandled?: () => void;
}

interface RealMessagesViewProps extends RealMessagesProps {
  voiceSession: VoiceCallController;
  voiceConversation: AppConversation;
  callCanvasOpen: boolean;
  onOpenCallCanvas: () => void;
  onMinimizeCallCanvas: () => void;
  onStartCall: (video: boolean) => void;
}

function RealMessagesView({ conversation, currentUser, messages, unreadCount = 0, loading = false, historyError = false, hasOlderMessages = false, loadingOlderMessages = false, olderHistoryError = false, typingUserIds = [], mobileActive = true, onMobileBack, onCallOpenChange, voiceSession, voiceConversation, callCanvasOpen, onOpenCallCanvas, onMinimizeCallCanvas, onStartCall, onSend, onRetry, onRetryHistory, onLoadOlder, onEdit, availableConversations = [], onPinMessage, onForwardMessage, onOpenForwardSource, onDeleteMessage, onDeleteConversation = () => undefined, availableUsers = [], onConversationChange = () => undefined, onOpenDirectConversation = () => undefined, onStartDirectCall = () => undefined, onRelationshipChange, onMarkRead, onVoiceListen, draftText = '', onDraftChange, focusMessageId = null, onFocusMessageHandled }: RealMessagesViewProps) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [profileInfoOpen, setProfileInfoOpen] = useState(false);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [selectedGroupMember, setSelectedGroupMember] = useState<AppUser | null>(null);
  const [groupMemberMenuOpen, setGroupMemberMenuOpen] = useState(false);
  const [, setPresenceTick] = useState(0);
  const [muted, setMuted] = useState(() => localStorage.getItem(`mova-muted-${conversation.id}`) === 'true');
  const [relationshipOverride, setRelationshipOverride] = useState<AppUser | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [atMessageBottom, setAtMessageBottom] = useState(true);
  const [friendRequestOverrides, setFriendRequestOverrides] = useState<Record<string, NonNullable<AppMessage['friendRequest']>['status']>>({});
  const [selectingMessages, setSelectingMessages] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachment, setAttachment] = useState<MessageAttachment | undefined>();
  const [preparingAttachment, setPreparingAttachment] = useState<Pick<MessageAttachment, 'name' | 'size'> | undefined>();
  const [attachmentError, setAttachmentError] = useState('');
  const retryingMessagesRef = useRef(new Set<string>());
  const [retryingMessageIds, setRetryingMessageIds] = useState<Set<string>>(() => new Set());
  const [replyingTo, setReplyingTo] = useState<AppMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<AppMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: AppMessage; x: number; y: number } | null>(null);
  const [forwardingMessages, setForwardingMessages] = useState<AppMessage[] | null>(null);
  const [deletingMessages, setDeletingMessages] = useState<{ messages: AppMessage[]; scope: 'self' | 'everyone'; fromSelection: boolean } | null>(null);
  const [selectionDeleteOpen, setSelectionDeleteOpen] = useState(false);
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const [replyHighlightId, setReplyHighlightId] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [imagePreviewId, setImagePreviewId] = useState<string | null>(null);
  const [callStageHost, setCallStageHost] = useState<HTMLElement | null>(null);
  const [callBannerHost, setCallBannerHost] = useState<HTMLElement | null>(null);
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [callChatUnread, setCallChatUnread] = useState(0);
  const voiceRecorder = useVoiceRecorder();
  const voicePlayer = useVoiceMessagePlayer();
  const [callChatWidth, setCallChatWidth] = useState(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('mova-call-chat-width');
    const saved = stored === null ? NaN : Number(stored);
    return Number.isFinite(saved) ? Math.min(720, Math.max(320, saved)) : 420;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const composerMirror = useRef<HTMLDivElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const composerSelection = useRef({ start: 0, end: 0 });
  const threadRef = useRef<HTMLElement>(null);
  const threadHeaderRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const messagesContainer = useRef<HTMLDivElement>(null);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const previousMessageCount = useRef(0);
  const pendingHistoryPrepend = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const positionedAtBottom = useRef(false);
  const dragDepth = useRef(0);
  const typingStopTimer = useRef<number | null>(null);
  const typingActive = useRef(false);
  const lastTypingSentAt = useRef(0);
  const replyHighlightTimer = useRef<number | null>(null);
  const replyScrollAnimation = useRef<number | null>(null);
  const knownCallMessageIds = useRef(new Set(messages.map((message) => message.id)));
  const storedOther = conversation.members.find((member) => member.id !== currentUser.id);
  const other = storedOther && relationshipOverride?.id === storedOther.id ? { ...storedOther, ...relationshipOverride } : storedOther;
  const relationship = other?.relationship || 'none';
  const blocked = relationship === 'blocked' || relationship === 'blocked_by';
  const canCall = conversation.kind === 'group' || (conversation.kind === 'direct' && relationship === 'friend');
  const currentGroupRole = conversation.kind === 'group' ? groupMemberRole(conversation, currentUser.id) : 'member';
  const canEditGroup = conversation.kind === 'group' && ['owner', 'admin'].includes(currentGroupRole);
  const messageStructure = useMemo(() => getMessageStructure(messages), [messages]);
  const mediaGallery = useMemo(() => buildMediaGallery(messages), [messages]);
  const pinnedMessages = useMemo(() => [...messages].filter((message) => message.pinnedAt).sort((left, right) => String(right.pinnedAt).localeCompare(String(left.pinnedAt))), [messages]);
  const pinnedMessage = pinnedMessages[0] || null;
  const forwardDestinations = useMemo(() => availableConversations.filter((item) => item.id !== conversation.id).sort((left, right) => Number(right.kind === 'saved') - Number(left.kind === 'saved')), [availableConversations, conversation.id]);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchingMessages = useMemo(() => (normalizedSearch ? messages.filter((message) => message.content.toLocaleLowerCase().includes(normalizedSearch) || message.attachment?.name.toLocaleLowerCase().includes(normalizedSearch)).reverse() : []), [messages, normalizedSearch]);
  const selectedMessageItems = useMemo(() => messages.filter((message) => selectedMessages.includes(message.id)), [messages, selectedMessages]);
  const canDeleteSelectionForEveryone = selectedMessageItems.length > 0 && selectedMessageItems.every((message) => message.authorId === currentUser.id && (!message.kind || message.kind === 'user'));
  const activeMatchId = matchingMessages[activeMatchIndex]?.id || matchingMessages[0]?.id;
  const matchCount = matchingMessages.length;
  const status = conversation.kind === 'saved' ? 'Личное хранилище' : conversation.kind === 'direct' ? formatPresenceStatus(other) : `${conversation.members.length} участников`;
  const typingLabel = conversationTypingLabel(conversation, currentUser.id, typingUserIds);
  const voiceState = normalizeCallState(voiceSession.state);
  const callOpen = callCanvasOpen && voiceConversation.id === conversation.id && voiceState !== 'idle' && voiceState !== 'available';

  useEffect(() => {
    if (mobileActive) return;
    setSearchOpen(false);
    setSearchQuery('');
    setDetailsOpen(false);
    setProfileInfoOpen(false);
    setGroupEditorOpen(false);
    setSelectedGroupMember(null);
    setGroupMemberMenuOpen(false);
    setEmojiOpen(false);
    setMessageMenu(null);
    setForwardingMessages(null);
    setDeletingMessages(null);
    setSelectionDeleteOpen(false);
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
    const closeWhenPointerLeaves = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const menuRight = messageMenu.x + 194;
      const menuBottom = messageMenu.y + 234;
      const horizontalDistance = event.clientX < messageMenu.x ? messageMenu.x - event.clientX : event.clientX > menuRight ? event.clientX - menuRight : 0;
      const verticalDistance = event.clientY < messageMenu.y ? messageMenu.y - event.clientY : event.clientY > menuBottom ? event.clientY - menuBottom : 0;
      if (Math.hypot(horizontalDistance, verticalDistance) > 88) setMessageMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('pointermove', closeWhenPointerLeaves, { passive: true });
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('pointermove', closeWhenPointerLeaves);
    };
  }, [messageMenu]);

  useEffect(() => {
    if (!selectingMessages) return;
    const closeSelection = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectingMessages(false);
      setSelectedMessages([]);
      setSelectionDeleteOpen(false);
    };
    window.addEventListener('keydown', closeSelection);
    return () => window.removeEventListener('keydown', closeSelection);
  }, [selectingMessages]);

  useLayoutEffect(() => {
    const input = composerInput.current;
    if (!input) return;
    input.style.height = '0px';
    const height = Math.min(120, Math.max(40, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [value, editingMessage]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    const header = threadHeaderRef.current;
    const composer = composerRef.current;
    if (!thread || !header || !composer) return;
    const topOverlays = [header, ...thread.querySelectorAll<HTMLElement>('.mova-voice-player,.mova-pinned-message')];
    const updateOverlayMetrics = () => {
      const threadRect = thread.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const overlayBottom = Math.max(...topOverlays.map((element) => element.getBoundingClientRect().bottom));
      thread.style.setProperty('--mova-chat-header-overlay-height', `${Math.max(0, overlayBottom - threadRect.top)}px`);
      thread.style.setProperty('--mova-chat-composer-overlay-height', `${Math.max(0, threadRect.bottom - composerRect.top)}px`);
    };
    updateOverlayMetrics();
    let animationFrame = 0;
    const transitionStartedAt = performance.now();
    const followOverlayTransition = (timestamp: number) => {
      updateOverlayMetrics();
      if (timestamp - transitionStartedAt < 240) animationFrame = window.requestAnimationFrame(followOverlayTransition);
    };
    if (typeof window.requestAnimationFrame === 'function') animationFrame = window.requestAnimationFrame(followOverlayTransition);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOverlayMetrics);
    observer?.observe(thread);
    topOverlays.forEach((element) => observer?.observe(element));
    observer?.observe(composer);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
    };
  }, [pinnedMessage?.id, voicePlayer.active?.id, voicePlayer.open]);

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
    if (!editingMessage) onDraftChange?.(nextValue);
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
    onDraftChange?.('');
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
  const copyMessage = async (message: AppMessage) => {
    setMessageMenu(null);
    const text = message.content || attachmentLabel(message.attachment) || 'Вложение';
    try {
      if (window.movaDesktopShell?.writeClipboardText) await window.movaDesktopShell.writeClipboardText(text);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const copyBuffer = document.createElement('textarea');
        copyBuffer.value = text;
        copyBuffer.style.position = 'fixed';
        copyBuffer.style.opacity = '0';
        document.body.append(copyBuffer);
        copyBuffer.select();
        const copied = document.execCommand('copy');
        copyBuffer.remove();
        if (!copied) throw new Error('Копирование недоступно');
      }
      toast.push('Сообщение скопировано.', 'success');
    } catch {
      toast.push('Не удалось скопировать сообщение.', 'danger');
    }
  };
  const translateMessage = (message: AppMessage) => {
    setMessageMenu(null);
    if (!message.content.trim()) {
      toast.push('В сообщении нет текста для перевода.', 'info');
      return;
    }
    const targetLanguage = /[а-яё]/iu.test(message.content) ? 'en' : 'ru';
    const url = new URL('https://translate.google.com/');
    url.searchParams.set('sl', 'auto');
    url.searchParams.set('tl', targetLanguage);
    url.searchParams.set('text', message.content);
    url.searchParams.set('op', 'translate');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };
  const togglePinnedMessage = async (message: AppMessage) => {
    setMessageMenu(null);
    if (!onPinMessage) {
      toast.push('Закрепление пока недоступно.', 'danger');
      return;
    }
    setMessageActionBusy(true);
    try {
      const pinned = !message.pinnedAt;
      await onPinMessage(message.id, pinned);
      toast.push(pinned ? 'Сообщение закреплено.' : 'Сообщение откреплено.', 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось изменить закрепление.', 'danger');
    } finally {
      setMessageActionBusy(false);
    }
  };
  const openMessageSelection = (message: AppMessage) => {
    setMessageMenu(null);
    setSelectingMessages(true);
    setSelectedMessages([message.id]);
  };
  const forwardMessageTo = async (targetConversationId: string) => {
    if (!forwardingMessages?.length || !onForwardMessage || messageActionBusy) return;
    setMessageActionBusy(true);
    try {
      await Promise.all(forwardingMessages.map((message) => onForwardMessage(message.id, targetConversationId)));
      const count = forwardingMessages.length;
      setForwardingMessages(null);
      setSelectingMessages(false);
      setSelectedMessages([]);
      toast.push(count === 1 ? 'Сообщение переслано.' : `${count} ${russianCount(count, 'сообщение переслано', 'сообщения пересланы', 'сообщений пересланы')}.`, 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось переслать сообщения.', 'danger');
    } finally {
      setMessageActionBusy(false);
    }
  };
  const deleteChosenMessages = async () => {
    if (!deletingMessages?.messages.length || !onDeleteMessage || messageActionBusy) return;
    setMessageActionBusy(true);
    try {
      await Promise.all(deletingMessages.messages.map((message) => onDeleteMessage(message.id, deletingMessages.scope)));
      const count = deletingMessages.messages.length;
      const fromSelection = deletingMessages.fromSelection;
      setDeletingMessages(null);
      if (fromSelection) {
        setSelectingMessages(false);
        setSelectedMessages([]);
        setSelectionDeleteOpen(false);
      }
      toast.push(count === 1 ? 'Сообщение удалено.' : `${count} ${russianCount(count, 'сообщение удалено', 'сообщения удалены', 'сообщений удалены')}.`, 'success');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось удалить сообщения.', 'danger');
    } finally {
      setMessageActionBusy(false);
    }
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
  const loadOlderHistory = useCallback(() => {
    const container = messagesContainer.current;
    if (!container || !onLoadOlder || !hasOlderMessages || loadingOlderMessages || pendingHistoryPrepend.current) return;
    pendingHistoryPrepend.current = { scrollHeight: container.scrollHeight, scrollTop: container.scrollTop };
    void onLoadOlder().catch(() => undefined).finally(() => {
      if (pendingHistoryPrepend.current && messagesContainer.current?.scrollHeight === pendingHistoryPrepend.current.scrollHeight) pendingHistoryPrepend.current = null;
    });
  }, [hasOlderMessages, loadingOlderMessages, onLoadOlder]);
  const syncMessageBottom = useCallback(() => {
    const container = messagesContainer.current;
    if (!container) return;
    const bottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 32;
    positionedAtBottom.current = bottom;
    setAtMessageBottom(bottom);
    if (container.scrollTop <= 160) loadOlderHistory();
  }, [loadOlderHistory]);
  const scrollToLatestMessage = useCallback(() => {
    const container = messagesContainer.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    else container.scrollTop = container.scrollHeight;
    positionedAtBottom.current = true;
    setAtMessageBottom(true);
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
    if ((!content && !attachment) || preparingAttachment || (editingMessage && sending)) return;
    setSendError('');
    announceTyping(false);
    if (!editingMessage) {
      const outgoingAttachment = attachment;
      const replyToId = replyingTo?.id;
      setValue('');
      onDraftChange?.('');
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
  const startVoiceRecording = async () => {
    if (blocked || value.trim() || attachment || editingMessage) return;
    setSendError('');
    setAttachmentError('');
    setEmojiOpen(false);
    announceTyping(false);
    await voiceRecorder.start();
  };
  const sendVoiceRecording = async () => {
    setSendError('');
    const recording = await voiceRecorder.finish();
    if (!recording) {
      if (!voiceRecorder.error) setSendError('Запись слишком короткая');
      return;
    }
    const replyToId = replyingTo?.id;
    setReplyingTo(null);
    try {
      await onSend('', recording.attachment, replyToId);
    } catch (sendFailure) {
      setSendError(sendFailure instanceof Error ? sendFailure.message : 'Не удалось отправить голосовое сообщение');
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
    setPreparingAttachment({ name: file.name || 'Файл', size: file.size });
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
    } finally {
      setPreparingAttachment(undefined);
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
    setGroupEditorOpen(false);
    setSelectedGroupMember(null);
    setGroupMemberMenuOpen(false);
    setDetailsOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
    setValue(draftText);
    setAttachment(undefined);
    setAttachmentError('');
    setSendError('');
    setReplyingTo(null);
    setEditingMessage(null);
    setEmojiOpen(false);
    setMessageMenu(null);
    setForwardingMessages(null);
    setDeletingMessages(null);
    setSelectionDeleteOpen(false);
    setSelectingMessages(false);
    setSelectedMessages([]);
    setImagePreviewId(null);
    composerSelection.current = { start: 0, end: 0 };
    setMuted(localStorage.getItem(`mova-muted-${conversation.id}`) === 'true');
    setRelationshipOverride(null);
    setFriendRequestOverrides({});
    setRelationshipBusy(false);
    positionedAtBottom.current = false;
    setAtMessageBottom(true);
    previousMessageCount.current = 0;
    void voiceRecorder.cancel();
  }, [conversation.id]);
  useLayoutEffect(() => {
    pendingHistoryPrepend.current = null;
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
    const previousCount = previousMessageCount.current;
    const messageAdded = messageCount > previousCount;
    const ownMessageAdded = messageAdded && messages.at(-1)?.authorId === currentUser.id;
    const shouldScroll = previousCount === 0 || ownMessageAdded || positionedAtBottom.current;
    if (messageCount && shouldScroll) {
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
      setAtMessageBottom(true);
    }
    previousMessageCount.current = messageCount;
  }, [messages, currentUser.id]);
  useLayoutEffect(() => {
    const pending = pendingHistoryPrepend.current;
    const container = messagesContainer.current;
    if (!pending || !container || container.scrollHeight === pending.scrollHeight) return;
    container.scrollTop = pending.scrollTop + container.scrollHeight - pending.scrollHeight;
    previousMessageCount.current = messages.length;
    pendingHistoryPrepend.current = null;
  }, [messages]);
  useEffect(() => {
    if (!focusMessageId || !messages.some((message) => message.id === focusMessageId)) return;
    const frame = window.requestAnimationFrame(() => {
      jumpToMessage(focusMessageId);
      positionedAtBottom.current = false;
      setAtMessageBottom(false);
      onFocusMessageHandled?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusMessageId, jumpToMessage, messages, onFocusMessageHandled]);
  useEffect(() => {
    const markRead = () => {
      if (!onMarkRead || !mobileActive || !atMessageBottom || document.visibilityState !== 'visible') return;
      const latestUnread = [...messages].reverse().find((message) => message.authorId !== currentUser.id && !message.readBy?.some((receipt) => receipt.userId === currentUser.id));
      if (latestUnread) void onMarkRead(latestUnread.id);
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    window.addEventListener('focus', markRead);
    return () => {
      document.removeEventListener('visibilitychange', markRead);
      window.removeEventListener('focus', markRead);
    };
  }, [atMessageBottom, currentUser.id, messages, mobileActive, onMarkRead]);

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
  const commitRelationship = (updatedUser: AppUser) => {
    setRelationshipOverride(updatedUser);
    onRelationshipChange?.(updatedUser);
  };
  const resolvePendingFriendRequest = (requestedBy: string, status: NonNullable<AppMessage['friendRequest']>['status']) => {
    setFriendRequestOverrides((items) => ({
      ...items,
      ...Object.fromEntries(messages.filter((message) => message.friendRequest?.requestedBy === requestedBy && message.friendRequest.status === 'pending').map((message) => [message.id, status])),
    }));
  };
  const changeFriendship = async () => {
    if (!other || relationshipBusy || blocked) return;
    setRelationshipBusy(true);
    try {
      const result = relationship === 'incoming'
        ? await api.acceptFriend(other.id)
        : relationship === 'friend' || relationship === 'outgoing'
          ? await api.removeFriend(other.id)
          : await api.requestFriend(other.id);
      commitRelationship(result.user);
      if (relationship === 'incoming') resolvePendingFriendRequest(other.id, 'accepted');
      if (relationship === 'outgoing') resolvePendingFriendRequest(currentUser.id, 'cancelled');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Не удалось изменить статус дружбы');
    } finally {
      setRelationshipBusy(false);
    }
  };
  const rejectFriendship = async () => {
    if (!other || relationshipBusy || relationship !== 'incoming') return;
    setRelationshipBusy(true);
    try {
      const result = await api.rejectFriend(other.id);
      commitRelationship(result.user);
      resolvePendingFriendRequest(other.id, 'declined');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Не удалось отклонить заявку');
    } finally {
      setRelationshipBusy(false);
    }
  };
  const toggleBlocked = async () => {
    if (!other || relationshipBusy || relationship === 'blocked_by') return;
    setRelationshipBusy(true);
    try {
      const result = relationship === 'blocked' ? await api.unblockUser(other.id) : await api.blockUser(other.id);
      commitRelationship(result.user);
      setDetailsOpen(false);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Не удалось изменить блокировку');
    } finally {
      setRelationshipBusy(false);
    }
  };
  const friendshipActionLabel = relationship === 'incoming'
    ? 'Принять заявку в друзья'
    : relationship === 'outgoing'
      ? 'Отменить заявку в друзья'
      : relationship === 'friend'
        ? 'Удалить из друзей'
        : 'Добавить в друзья';
  const callMenuItem = (video: boolean) => {
    const label = video ? 'Видеозвонок' : 'Позвонить';
    const item = (
      <button type="button" role="menuitem" disabled={!canCall} onClick={() => startCall(video)}>
        {video ? <Video size={22} /> : <Phone size={22} />}
        <span>{label}</span>
      </button>
    );
    return canCall ? item : <Tooltip label="Вы не в друзьях">{item}</Tooltip>;
  };

  return (
    <section ref={threadRef} className={`mova-real-thread mova-open-chat ${callOpen ? 'is-in-call' : ''} ${callOpen && callChatOpen ? 'is-call-chat-open' : ''} ${voicePlayer.open ? 'has-voice-player' : ''} ${pinnedMessage ? 'has-pinned-message' : ''} ${selectingMessages ? 'is-selecting-messages' : ''} ${draggingFile ? 'is-file-dragging' : ''}`} style={{ '--mova-call-chat-width': `${callChatWidth}px` } as CSSProperties} aria-hidden={!mobileActive} inert={!mobileActive ? true : undefined} onDragEnter={enterFile} onDragOver={(event) => event.preventDefault()} onDragLeave={leaveFile} onDrop={dropFile}>
      <VoicePlaybackAudio player={voicePlayer} />
      {draggingFile && (
        <div className="mova-file-drop-overlay">
          <Upload size={28} />
          <strong>Отпустите, чтобы прикрепить</strong>
          <span>Изображение или файл до 8 МБ</span>
        </div>
      )}
      <VoiceMessagePlayerBar player={voicePlayer} />
      <header ref={threadHeaderRef} className="mova-real-thread__header">
        {onMobileBack && (
          <IconButton label="К списку диалогов" className="mova-mobile-chat-back" onClick={onMobileBack}>
            <ArrowLeft size={23} />
          </IconButton>
        )}
        <button
          type="button"
          className="mova-chat-identity"
          aria-label={conversation.kind === 'saved' ? 'Избранное' : `Открыть информацию о ${conversation.title}`}
          aria-expanded={profileInfoOpen}
          disabled={conversation.kind === 'saved'}
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
          {conversation.kind !== 'saved' && <VoiceCallBar
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
            canCall={canCall}
          />}
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
        <aside
          className={`mova-contact-info${conversation.kind === 'group' ? ' is-group' : ''}${groupEditorOpen ? ' is-editor' : ''}${selectedGroupMember ? ' is-member-profile' : ''}`}
          aria-label={groupEditorOpen ? `Редактирование группы ${conversation.title}` : selectedGroupMember ? `Информация о ${selectedGroupMember.name}` : `Информация о ${conversation.title}`}
        >
          {conversation.kind === 'group' && groupEditorOpen ? (
            <GroupEditor conversation={conversation} currentUser={currentUser} users={availableUsers} onClose={() => setGroupEditorOpen(false)} onUpdated={onConversationChange} />
          ) : conversation.kind === 'group' && selectedGroupMember ? (
            <>
              <header>
                <IconButton label="Назад к информации о группе" onClick={() => { setSelectedGroupMember(null); setGroupMemberMenuOpen(false); }}><ArrowLeft size={23} /></IconButton>
                <h2>Информация</h2>
              </header>
              <section className="mova-contact-info__profile">
                <Avatar name={selectedGroupMember.name} src={selectedGroupMember.avatarDataUrl} color={selectedGroupMember.color} status={avatarStatus(selectedGroupMember.presence, selectedGroupMember.isOnline)} size="xl" />
                <h3><AppleEmoji text={selectedGroupMember.name} /></h3>
                <p>{formatPresenceStatus(selectedGroupMember)}</p>
                {selectedGroupMember.id !== currentUser.id && (
                  <div className="mova-group-member-profile-actions">
                    <Button variant="secondary" size="sm" leadingIcon={<MessageCircle size={18} />} onClick={() => void onOpenDirectConversation(selectedGroupMember)}>Написать</Button>
                    <div className="mova-group-member-more" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setGroupMemberMenuOpen(false); }}>
                      <IconButton label={`Действия с ${selectedGroupMember.name}`} aria-expanded={groupMemberMenuOpen} onClick={() => setGroupMemberMenuOpen((open) => !open)}><MoreHorizontal size={21} /></IconButton>
                      <PopoverSurface open={groupMemberMenuOpen} className="mova-group-member-menu" ariaLabel={`Действия с ${selectedGroupMember.name}`}>
                        <button type="button" role="menuitem" disabled={selectedGroupMember.relationship !== 'friend'} onClick={() => { setGroupMemberMenuOpen(false); void onStartDirectCall(selectedGroupMember, false); }}><Phone size={19} /><span>Позвонить</span></button>
                        <button type="button" role="menuitem" disabled={selectedGroupMember.relationship !== 'friend'} onClick={() => { setGroupMemberMenuOpen(false); void onStartDirectCall(selectedGroupMember, true); }}><Video size={19} /><span>Видеозвонок</span></button>
                      </PopoverSurface>
                    </div>
                  </div>
                )}
              </section>
              <section className="mova-contact-info__card">
                {selectedGroupMember.activity && (selectedGroupMember.isOnline ?? selectedGroupMember.presence === 'online') && <div><GameActivityIcon activity={selectedGroupMember.activity} size={34} /><span><strong>{selectedGroupMember.activity.name}</strong><small>Играет уже {activityTime(selectedGroupMember.activity.startedAt)}</small></span></div>}
                <div><AtSign size={25} /><span><strong>{selectedGroupMember.handle?.replace(/^@/, '') || 'не указан'}</strong><small>Имя пользователя</small></span></div>
                <div><Info size={25} /><span><strong>{selectedGroupMember.bio || 'Информация о себе не указана'}</strong><small>О себе</small></span></div>
              </section>
            </>
          ) : (
            <>
              <header>
                <IconButton label="Закрыть информацию" onClick={() => setProfileInfoOpen(false)}><X size={25} /></IconButton>
                <h2>{conversation.kind === 'group' ? 'Информация о группе' : 'Информация'}</h2>
                {canEditGroup && <IconButton label="Изменить группу" onClick={() => setGroupEditorOpen(true)}><Pencil size={21} /></IconButton>}
              </header>
              <section className="mova-contact-info__profile">
                <ConversationAvatar conversation={conversation} currentUser={currentUser} />
                <h3><AppleEmoji text={conversation.title} /></h3>
                <p>{status}</p>
                {conversation.kind === 'direct' && other && (
                  <div className="mova-contact-info__relationship-actions">
                    {relationship !== 'blocked' && relationship !== 'blocked_by' && <Button variant="secondary" size="sm" leadingIcon={relationship === 'incoming' ? <Check size={17} /> : <UserPlus size={17} />} loading={relationshipBusy} onClick={() => void changeFriendship()}>{friendshipActionLabel}</Button>}
                    <Button variant="ghost" size="sm" leadingIcon={<Ban size={17} />} disabled={relationshipBusy || relationship === 'blocked_by'} onClick={() => void toggleBlocked()}>{relationship === 'blocked' ? 'Разблокировать' : relationship === 'blocked_by' ? 'Вы заблокированы' : 'Заблокировать'}</Button>
                  </div>
                )}
              </section>
              <section className="mova-contact-info__card">
                {conversation.kind === 'direct' && other?.activity && (other.isOnline ?? other.presence === 'online') && <div><GameActivityIcon activity={other.activity} size={34} /><span><strong>{other.activity.name}</strong><small>Играет уже {activityTime(other.activity.startedAt)}</small></span></div>}
                {conversation.kind === 'direct' && <div className="mova-message-body"><AtSign size={25} /><span><strong>{other?.handle?.replace(/^@/, '') || 'не указан'}</strong><small>Имя пользователя</small></span></div>}
                {conversation.kind === 'direct' ? <div><Info size={25} /><span><strong>{other?.bio || 'Информация о себе не указана'}</strong><small>О себе</small></span></div> : <div><Users size={25} /><span><strong>{conversation.members.length} {russianCount(conversation.members.length, 'участник', 'участника', 'участников')}</strong><small>Участники</small></span></div>}
                <label><Bell size={25} /><span><strong>Уведомления</strong><small>{muted ? 'Выключены' : 'Включены'}</small></span><input type="checkbox" checked={!muted} onChange={toggleMuted} aria-label="Уведомления" /><i /></label>
              </section>
              {conversation.kind === 'group' && (
                <section className="mova-group-info-members" aria-label="Участники группы">
                  <h3>Участники <span>{conversation.members.length}</span></h3>
                  {conversation.members.map((member) => {
                    const role = groupMemberRole(conversation, member.id);
                    return <button type="button" key={member.id} aria-label={`Открыть информацию о ${member.name}`} onClick={() => { setSelectedGroupMember(member); setGroupMemberMenuOpen(false); }}><Avatar name={member.name} src={member.avatarDataUrl} color={member.color} status={avatarStatus(member.presence, member.isOnline)} size="md" /><span><strong><AppleEmoji text={member.name} /></strong><small>{formatPresenceStatus(member)}</small></span>{role !== 'member' && <b>{groupRoleLabel(role)}</b>}</button>;
                  })}
                </section>
              )}
            </>
          )}
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
          {conversation.kind !== 'saved' && callMenuItem(false)}
          {conversation.kind !== 'saved' && callMenuItem(true)}
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
          {conversation.kind === 'direct' && <button type="button" role="menuitem" disabled={relationshipBusy || relationship === 'blocked_by'} onClick={() => void toggleBlocked()}>
            <Ban size={22} />
            <span>{relationship === 'blocked' ? 'Разблокировать' : relationship === 'blocked_by' ? 'Вы заблокированы' : 'Заблокировать'}</span>
          </button>}
          {(conversation.kind === 'direct' || currentGroupRole === 'owner') && <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setDetailsOpen(false);
              setDeleteConfirmOpen(true);
            }}
          >
            <Trash2 size={22} />
            <span>{conversation.kind === 'group' ? 'Удалить группу' : 'Удалить чат'}</span>
          </button>}
      </PopoverSurface>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title={conversation.kind === 'group' ? 'Удалить группу?' : 'Удалить чат?'}
        description={conversation.kind === 'group' ? `Группа «${conversation.title}» и вся её история будут удалены у всех участников. Это действие нельзя отменить.` : `Чат «${conversation.title}» исчезнет из списка. Это действие нельзя отменить.`}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          onDeleteConversation();
        }}
      />
      {pinnedMessage && (
        <div className="mova-pinned-message" aria-label="Закреплённое сообщение">
          <button type="button" className="mova-pinned-message__jump" onClick={() => jumpToMessage(pinnedMessage.id)}>
            <span className="mova-pinned-message__pin"><Pin size={19} aria-hidden="true" /></span>
            <i className="mova-pinned-message__accent" aria-hidden="true" />
            {pinnedMessage.attachment?.type.startsWith('image/') && (
              <CachedImage className="mova-pinned-message__thumbnail" src={attachmentSource(pinnedMessage.attachment)} alt="" />
            )}
            <span className="mova-pinned-message__copy">
              <strong>Закреплённое сообщение{pinnedMessages.length > 1 ? ' #1' : ''}</strong>
              <small><AppleEmoji text={pinnedMessage.content || attachmentLabel(pinnedMessage.attachment) || 'Вложение'} /></small>
            </span>
          </button>
          <button type="button" className="mova-pinned-message__close" aria-label="Открепить сообщение" disabled={messageActionBusy} onClick={() => void togglePinnedMessage(pinnedMessage)}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}
      {selectingMessages && (
        <div className="mova-message-selection-bar" role="toolbar" aria-label="Действия с выбранными сообщениями">
          <div className="mova-message-selection-bar__delete" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSelectionDeleteOpen(false);
          }}>
            <button
              type="button"
              className="is-danger"
              aria-label="Удалить выбранные сообщения"
              aria-haspopup="menu"
              aria-expanded={selectionDeleteOpen}
              disabled={!selectedMessages.length || messageActionBusy || !onDeleteMessage}
              onClick={() => setSelectionDeleteOpen((open) => !open)}
            >
              <Trash2 size={21} />
            </button>
            {selectionDeleteOpen && (
              <div className="mova-message-selection-delete-menu" role="menu" aria-label="Как удалить сообщения">
                <button type="button" role="menuitem" onClick={() => {
                  setDeletingMessages({ messages: selectedMessageItems, scope: 'self', fromSelection: true });
                  setSelectionDeleteOpen(false);
                }}>Удалить у себя</button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  disabled={!canDeleteSelectionForEveryone}
                  title={canDeleteSelectionForEveryone ? undefined : 'У всех можно удалить только свои сообщения'}
                  onClick={() => {
                    setDeletingMessages({ messages: selectedMessageItems, scope: 'everyone', fromSelection: true });
                    setSelectionDeleteOpen(false);
                  }}
                >Удалить у всех</button>
              </div>
            )}
          </div>
          <strong>{selectedMessages.length ? `${selectedMessages.length} ${russianCount(selectedMessages.length, 'сообщение', 'сообщения', 'сообщений')}` : 'Выберите сообщения'}</strong>
          <button
            type="button"
            aria-label="Переслать выбранные сообщения"
            disabled={!selectedMessages.length || messageActionBusy || !onForwardMessage}
            onClick={() => setForwardingMessages(selectedMessageItems)}
          >
            <Forward size={22} />
          </button>
        </div>
      )}
      <div className="mova-real-messages" ref={messagesContainer} onScroll={syncMessageBottom}>
        {(hasOlderMessages || loadingOlderMessages || olderHistoryError) && (
          <div className="mova-history-pagination" role="status">
            {olderHistoryError ? <button type="button" onClick={loadOlderHistory}>Не удалось загрузить ранние сообщения · Повторить</button> : loadingOlderMessages ? <span>Загружаем ранние сообщения…</span> : <button type="button" onClick={loadOlderHistory}>Загрузить ранние сообщения</button>}
          </div>
        )}
        <div className="mova-real-thread-intro">
          <ConversationAvatar conversation={conversation} currentUser={currentUser} />
          <h1><AppleEmoji text={conversation.title} /></h1>
          <p>{conversation.kind === 'saved' ? 'Здесь можно хранить сообщения, фотографии и файлы — их видите только вы.' : conversation.kind === 'direct' ? `Это начало вашей переписки${other ? ` с ${other.name}` : ''}.` : 'Группа создана. Можно начинать разговор.'}</p>
          {conversation.kind === 'direct' && other && (
            <div className="mova-thread-intro-actions">
              {relationship !== 'friend' && relationship !== 'blocked' && relationship !== 'blocked_by' && (
                <Button variant="secondary" size="sm" leadingIcon={relationship === 'incoming' ? <Check size={16} /> : <UserPlus size={16} />} loading={relationshipBusy} onClick={() => void changeFriendship()}>
                  {friendshipActionLabel}
                </Button>
              )}
              <Button variant="ghost" size="sm" leadingIcon={<Ban size={16} />} disabled={relationshipBusy || relationship === 'blocked_by'} onClick={() => void toggleBlocked()}>
                {relationship === 'blocked' ? 'Разблокировать' : relationship === 'blocked_by' ? 'Вы заблокированы' : 'Заблокировать'}
              </Button>
            </div>
          )}
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
          if (message.kind === 'friend_request' && message.friendRequest) {
            const requestStatus = friendRequestOverrides[message.id] || message.friendRequest.status;
            const sentByCurrentUser = message.friendRequest.requestedBy === currentUser.id;
            const title = requestStatus === 'accepted'
              ? 'Теперь вы друзья'
              : requestStatus === 'declined'
                ? 'Заявка отклонена'
                : requestStatus === 'cancelled'
                  ? 'Заявка отменена'
                  : sentByCurrentUser
                    ? 'Заявка в друзья отправлена'
                    : `${message.author.name} хочет добавить тебя в друзья`;
            const description = requestStatus === 'pending'
              ? sentByCurrentUser
                ? 'Ожидаем ответа пользователя'
                : 'После принятия станут доступны звонки и звуковые уведомления'
              : requestStatus === 'accepted'
                ? 'Теперь доступны звонки и обычные уведомления'
                : requestStatus === 'declined'
                  ? 'Повторную заявку можно будет отправить через 24 часа'
                  : 'Эта заявка больше не активна';
            return (
              <Fragment key={messageKey}>
                {daySeparator}
                <article
                  ref={(element) => {
                    if (element) messageElements.current.set(message.id, element);
                    else messageElements.current.delete(message.id);
                  }}
                  className={`mova-friend-request-message is-${requestStatus} ${matches ? 'is-search-match' : ''} ${message.id === activeMatchId ? 'is-active-search-match' : ''}`}
                  aria-label={title}
                >
                  <span className="mova-friend-request-message__icon" aria-hidden="true">
                    {requestStatus === 'accepted' ? <Check size={21} /> : <UserPlus size={21} />}
                  </span>
                  <span className="mova-friend-request-message__copy">
                    <strong><AppleEmoji text={title} /></strong>
                    <small>{description}</small>
                  </span>
                  {requestStatus === 'pending' && !sentByCurrentUser && relationship === 'incoming' && (
                    <span className="mova-friend-request-message__actions">
                      <Button size="sm" loading={relationshipBusy} onClick={() => void changeFriendship()}>Принять</Button>
                      <Button variant="ghost" size="sm" disabled={relationshipBusy} onClick={() => void rejectFriendship()}>Отклонить</Button>
                    </span>
                  )}
                  <time>{new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>
                </article>
              </Fragment>
            );
          }
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
          const voiceAttachment = isVoiceAttachment(message.attachment);
          const fileUploading = Boolean(message.attachment && !imageAttachment && !voiceAttachment && message.deliveryState === 'sending' && message.attachment.dataUrl && !message.attachment.url);
          const voiceRecipients = voiceAttachment ? conversation.members.filter((member) => member.id !== message.authorId) : [];
          const voiceUnlistened = voiceAttachment && (own
            ? voiceRecipients.some((member) => !message.listenedBy?.some((receipt) => receipt.userId === member.id))
            : !message.listenedBy?.some((receipt) => receipt.userId === currentUser.id));
          const imageCaption = imageAttachment && Boolean(message.content.trim() || message.replyTo || message.forwardedFrom);
          const selectedForAction = selectedMessages.includes(message.id);
          return (
            <Fragment key={messageKey}>
              {daySeparator}
              <article
                ref={(element) => {
                  if (element) messageElements.current.set(message.id, element);
                  else messageElements.current.delete(message.id);
                }}
                className={`mova-real-message ${own ? 'is-own' : ''} ${grouped ? 'is-grouped' : 'is-group-start'} ${continuesGroup ? '' : 'is-group-end'} ${message.deliveryState === 'queued' ? 'is-queued' : message.deliveryState === 'sending' ? 'is-sending' : message.deliveryState === 'failed' ? 'is-failed' : ''} ${matches ? 'is-search-match' : ''} ${message.id === activeMatchId ? 'is-active-search-match' : ''} ${message.id === replyHighlightId ? 'is-reply-target' : ''} ${selectingMessages ? 'is-selectable' : ''} ${selectedForAction ? 'is-selected' : ''}`}
                onClick={selectingMessages ? () => setSelectedMessages((items) => (selectedForAction ? items.filter((id) => id !== message.id) : [...items, message.id])) : undefined}
                onContextMenu={(event) => {
                  if (selectingMessages) return;
                  event.preventDefault();
                  const width = 194;
                  const height = 234;
                  setDetailsOpen(false);
                  setEmojiOpen(false);
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
                  {!selectingMessages && own && onEdit && !message.forwardedFrom && Boolean(message.content.trim()) && (!message.kind || message.kind === 'user') && (
                    <div className="mova-message-quick-actions" aria-label="Действия с сообщением">
                      <button type="button" aria-label="Редактировать сообщение" title="Редактировать" onClick={(event) => { event.stopPropagation(); editOwnMessage(message); }}>
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <div className={`mova-real-bubble${message.forwardedFrom ? ' has-forward' : ''}${message.replyTo ? ' has-reply' : ''}${message.attachment && !imageAttachment && !voiceAttachment ? ' has-file' : ''}${voiceAttachment ? ' has-voice' : ''}${imageAttachment ? ` has-image ${imageCaption ? 'has-caption' : 'is-image-only'}` : ''}`}>
                  {message.forwardedFrom && (
                    <div className="mova-message-forwarded" aria-label={`Переслано от ${message.forwardedFrom.authorName}`}>
                      <Forward size={14} aria-hidden="true" />
                      <span>
                        <small>Переслано от</small>
                        <strong><AppleEmoji text={message.forwardedFrom.authorName} /></strong>
                      </span>
                      {message.forwardedFrom.canOpen && message.forwardedFrom.conversationId && message.forwardedFrom.messageId && onOpenForwardSource && (
                        <button
                          type="button"
                          aria-label={`Перейти к исходному сообщению ${message.forwardedFrom.authorName}`}
                          title="Перейти в диалог"
                          onClick={() => void onOpenForwardSource(message.forwardedFrom!)}
                        >
                          <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
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
                        <small><AppleEmoji text={message.replyTo.content || attachmentLabel(message.replyTo.attachment) || message.replyTo.attachmentName || 'Вложение'} /></small>
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
                    ) : voiceAttachment ? (
                      <VoiceMessage
                        attachment={message.attachment}
                        messageId={message.id}
                        authorName={message.author.name}
                        createdAt={message.createdAt}
                        player={voicePlayer}
                        unlistened={voiceUnlistened}
                        onListen={!own && voiceUnlistened && onVoiceListen ? () => onVoiceListen(message.id) : undefined}
                      />
                    ) : (
                      <a
                        className={`mova-message-file${fileUploading ? ' is-uploading' : ''}`}
                        href={fileUploading ? undefined : attachmentDownloadSource(message.attachment)}
                        download={fileUploading ? undefined : message.attachment.name}
                        role={fileUploading ? 'status' : undefined}
                        aria-label={fileUploading ? `Загружается ${message.attachment.name}` : undefined}
                        aria-busy={fileUploading || undefined}
                        onClick={fileUploading ? (event) => event.preventDefault() : undefined}
                      >
                        {fileUploading ? <LoaderCircle className="mova-spin" size={20} aria-hidden="true" /> : <FileText size={20} />}
                        <span>
                          <strong>{message.attachment.name}</strong>
                          <small>{fileUploading ? 'Загрузка…' : formatFileSize(message.attachment.size)}</small>
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
      {!atMessageBottom && (
        <button
          type="button"
          className="mova-jump-to-latest"
          aria-label={unreadCount > 0 ? `Перейти к последним сообщениям, непрочитанных: ${unreadCount}` : 'Перейти к последним сообщениям'}
          onClick={scrollToLatestMessage}
        >
          <ArrowDown size={25} aria-hidden="true" />
          {unreadCount > 0 && <b>{unreadCount > 9 ? '9+' : unreadCount}</b>}
        </button>
      )}
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
                <small><AppleEmoji text={(editingMessage || replyingTo)?.content || attachmentLabel((editingMessage || replyingTo)?.attachment) || 'Вложение'} /></small>
              </span>
              <button type="button" className="mova-composer-row__remove" aria-label={editingMessage ? 'Отменить редактирование' : 'Отменить ответ'} onClick={() => { setEditingMessage(null); setReplyingTo(null); setValue(''); if (!editingMessage) onDraftChange?.(''); }}>
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
                <small>{formatFileSize(attachment.size)}</small>
              </span>
              <button type="button" className="mova-composer-row__remove" aria-label="Убрать вложение" onClick={() => setAttachment(undefined)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {preparingAttachment && (
            <div className="mova-attachment-draft is-preparing" role="status" aria-label={`Подготавливается ${preparingAttachment.name}`} aria-busy="true">
              <span className="mova-composer-row__icon"><LoaderCircle className="mova-spin" size={17} aria-hidden="true" /></span>
              <span className="mova-composer-row__copy">
                <strong><AppleEmoji text={preparingAttachment.name} /></strong>
                <small>Подготовка… · {formatFileSize(preparingAttachment.size)}</small>
              </span>
            </div>
          )}
          <div className={`mova-composer-input-row${voiceRecorder.state !== 'idle' ? ' is-recording' : ''}`}>
            <input ref={fileInput} type="file" hidden onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
            {voiceRecorder.state !== 'idle' ? (
              <div className="mova-voice-recorder" role="status" aria-label="Запись голосового сообщения">
                <button type="button" className="mova-voice-recorder__cancel" aria-label="Удалить запись" disabled={voiceRecorder.state === 'stopping'} onClick={() => void voiceRecorder.cancel()}>
                  <Trash2 size={20} aria-hidden="true" />
                </button>
                <span className="mova-voice-recorder__status"><i aria-hidden="true" /><strong>{voiceRecorder.state === 'requesting' ? 'Микрофон…' : formatVoiceDuration(voiceRecorder.durationMs)}</strong></span>
                <span className="mova-voice-recorder__waveform" aria-hidden="true">
                  {voiceRecorder.liveWaveform.map((height, index) => <i key={index} style={{ '--mova-live-height': height } as CSSProperties} />)}
                </span>
                <button type="button" className="mova-voice-recorder__send" aria-label="Отправить голосовое сообщение" disabled={voiceRecorder.state !== 'recording'} onClick={() => void sendVoiceRecording()}>
                  <Send size={18} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <IconButton label="Прикрепить файл" disabled={Boolean(editingMessage)} onClick={() => fileInput.current?.click()}>
                  <Paperclip size={22} aria-hidden="true" />
                </IconButton>
                <div className={`mova-composer-textarea${value ? ' has-value' : ''}`}>
                  {value && (
                    <div ref={composerMirror} className="mova-composer-textarea__mirror" aria-hidden="true">
                      <AppleEmoji text={value} />
                    </div>
                  )}
                  <textarea
                    ref={composerInput}
                    rows={1}
                    value={value}
                    disabled={blocked}
                    onChange={(event) => {
                      setValue(event.target.value);
                      if (!editingMessage) onDraftChange?.(event.target.value);
                      composerSelection.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
                      if (!editingMessage) announceTyping(Boolean(event.target.value.trim()));
                    }}
                    onScroll={(event) => {
                      if (!composerMirror.current) return;
                      composerMirror.current.scrollTop = event.currentTarget.scrollTop;
                      composerMirror.current.scrollLeft = event.currentTarget.scrollLeft;
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
                        if (!editingMessage) onDraftChange?.('');
                        return;
                      }
                      if (event.key === 'ArrowUp' && !value && !editingMessage && !replyingTo && !attachment && !preparingAttachment && onEdit) {
                        const latestEditableMessage = [...messages].reverse().find((message) => message.authorId === currentUser.id && !message.forwardedFrom && (!message.kind || message.kind === 'user') && Boolean(message.content.trim()));
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
                    placeholder={blocked ? 'Пользователь заблокирован' : editingMessage ? 'Измените сообщение…' : 'Сообщение'}
                  />
                </div>
                <IconButton
                  ref={emojiButton}
                  label="Эмодзи"
                  className={emojiOpen ? 'is-active' : ''}
                  aria-haspopup="dialog"
                  aria-expanded={emojiOpen}
                  onPointerDown={rememberComposerSelection}
                  onClick={() => setEmojiOpen((open) => !open)}
                >
                  <Smile size={21} aria-hidden="true" />
                </IconButton>
                {value.trim() || attachment || preparingAttachment || editingMessage ? (
                  <button className="mova-composer-send" type="submit" aria-label={editingMessage ? 'Сохранить изменения' : 'Отправить'} disabled={Boolean(preparingAttachment) || (!value.trim() && !attachment) || Boolean(editingMessage && sending)}>
                    {preparingAttachment ? <LoaderCircle className="mova-spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                  </button>
                ) : (
                  <IconButton label="Записать голосовое сообщение" className="mova-composer-mic" disabled={blocked} onClick={() => void startVoiceRecording()}>
                    <Mic size={23} aria-hidden="true" />
                  </IconButton>
                )}
              </>
            )}
          </div>
        </div>
        {emojiOpen && <EmojiPicker onSelect={insertEmoji} onClose={() => closeEmojiPicker(true)} />}
        <div className="mova-composer-errors" aria-live="polite">
          {attachmentError && <span className="mova-attachment-error">{attachmentError}</span>}
          {sendError && <span className="mova-send-error" role="alert">{sendError}</span>}
          {voiceRecorder.error && <span className="mova-send-error" role="alert">{voiceRecorder.error}</span>}
        </div>
      </form>
      {imagePreviewId && mediaGallery.some((item) => item.id === imagePreviewId) &&
        createPortal(
          <MediaViewer items={mediaGallery} activeId={imagePreviewId} onClose={() => setImagePreviewId(null)} />,
          document.body,
        )}
      <DialogSurface open={Boolean(forwardingMessages)} onClose={() => !messageActionBusy && setForwardingMessages(null)} className="mova-forward-message-dialog" labelledBy="mova-forward-message-title">
        <header>
          <h2 id="mova-forward-message-title">{forwardingMessages && forwardingMessages.length > 1 ? `Переслать ${forwardingMessages.length} ${russianCount(forwardingMessages.length, 'сообщение', 'сообщения', 'сообщений')}` : 'Переслать сообщение'}</h2>
          <IconButton data-dialog-close label="Закрыть" disabled={messageActionBusy} onClick={() => setForwardingMessages(null)}><X size={19} /></IconButton>
        </header>
        <div className="mova-forward-message-list">
          {forwardDestinations.length ? forwardDestinations.map((item) => (
            <button type="button" key={item.id} disabled={messageActionBusy} onClick={() => void forwardMessageTo(item.id)}>
              <ConversationAvatar conversation={item} currentUser={currentUser} />
              <span>
                <strong><AppleEmoji text={item.title} /></strong>
                <small>{item.kind === 'saved' ? 'Только для вас' : item.kind === 'group' ? `${item.members.length} участников` : item.members.find((member) => member.id !== currentUser.id)?.handle || 'Личный чат'}</small>
              </span>
              <Forward size={18} aria-hidden="true" />
            </button>
          )) : <p>Нет других чатов, в которые можно переслать сообщение.</p>}
        </div>
      </DialogSurface>
      <ConfirmDialog
        open={Boolean(deletingMessages)}
        title={deletingMessages && deletingMessages.messages.length > 1 ? `Удалить ${deletingMessages.messages.length} ${russianCount(deletingMessages.messages.length, 'сообщение', 'сообщения', 'сообщений')}?` : 'Удалить сообщение?'}
        description={deletingMessages?.scope === 'everyone'
          ? 'Выбранные сообщения исчезнут у всех участников чата.'
          : 'Выбранные сообщения исчезнут из истории на этом устройстве и в других ваших активных сессиях.'}
        confirmLabel={deletingMessages?.scope === 'everyone' ? 'Удалить у всех' : 'Удалить у себя'}
        onCancel={() => !messageActionBusy && setDeletingMessages(null)}
        onConfirm={() => void deleteChosenMessages()}
      />
      {createPortal(
          <div className="mova-message-context-layer" style={{ pointerEvents: messageMenu ? 'auto' : 'none' }} onPointerDown={(event) => { if (event.target === event.currentTarget) setMessageMenu(null); }} onContextMenu={(event) => event.preventDefault()}>
            <PopoverSurface open={Boolean(messageMenu)} className="mova-message-context-menu" ariaLabel="Действия с сообщением" style={messageMenu ? { left: messageMenu.x, top: messageMenu.y } : undefined}>
              <button type="button" role="menuitem" onClick={() => messageMenu && replyToMessage(messageMenu.message)}>
                <Reply size={19} />
                <span>Ответить</span>
              </button>
              <button type="button" role="menuitem" onClick={() => messageMenu && void copyMessage(messageMenu.message)}>
                <Copy size={18} />
                <span>Копировать</span>
              </button>
              <button type="button" role="menuitem" onClick={() => messageMenu && translateMessage(messageMenu.message)}>
                <Languages size={19} />
                <span>Перевести</span>
              </button>
              <button type="button" role="menuitem" onClick={() => messageMenu && void togglePinnedMessage(messageMenu.message)}>
                <Pin size={18} />
                <span>{messageMenu?.message.pinnedAt ? 'Открепить' : 'Закрепить'}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => {
                if (!messageMenu) return;
                setForwardingMessages([messageMenu.message]);
                setMessageMenu(null);
              }}>
                <Forward size={19} />
                <span>Переслать</span>
              </button>
              <button type="button" role="menuitem" onClick={() => messageMenu && openMessageSelection(messageMenu.message)}>
                <CircleCheck size={19} />
                <span>Выбрать</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => {
                if (!messageMenu) return;
                if (!onDeleteMessage) {
                  setMessageMenu(null);
                  toast.push('Удаление пока недоступно.', 'danger');
                  return;
                }
                setDeletingMessages({ messages: [messageMenu.message], scope: 'self', fromSelection: false });
                setMessageMenu(null);
              }}>
                <Trash2 size={18} />
                <span>Удалить</span>
              </button>
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
  const voiceSession = useVoiceCall(voiceConversation.id, props.currentUser.id, { direct: voiceConversation.kind === 'direct' });
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
    if (props.conversation.kind === 'saved') return;
    const contact = props.conversation.kind === 'direct' ? props.conversation.members.find((member) => member.id !== props.currentUser.id) : null;
    if (contact && contact.relationship !== 'friend') return;
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

function NotificationPermissionDialog({ open, loading, onAllow, onLater }: { open: boolean; loading: boolean; onAllow: () => void; onLater: () => void }) {
  return (
    <DialogSurface open={open} onClose={onLater} className="mova-modal mova-notification-permission" labelledBy="notification-permission-title" describedBy="notification-permission-description" initialFocus="cancel">
      <header>
        <h2 id="notification-permission-title">Не пропускайте сообщения и звонки</h2>
        <IconButton data-dialog-close label="Закрыть" onClick={onLater}><X size={19} /></IconButton>
      </header>
      <div className="mova-modal__body">
        <span className="mova-notification-permission__icon"><Bell size={26} /></span>
        <p id="notification-permission-description">Разрешите Mova отправлять уведомления о новых сообщениях и входящих звонках.</p>
      </div>
      <footer>
        <Button data-dialog-cancel variant="secondary" onClick={onLater}>Позже</Button>
        <Button loading={loading} onClick={onAllow}>Разрешить уведомления</Button>
      </footer>
    </DialogSurface>
  );
}

export function Product({ currentUser, onUserUpdate, onLogout }: { currentUser: AppUser; onUserUpdate: (user: AppUser) => void; onLogout: () => void }) {
  const SIDEBAR_COMPACT_WIDTH = 76;
  const SIDEBAR_MIN_WIDTH = 260;
  const SIDEBAR_MAX_WIDTH = 560;
  const SIDEBAR_COLLAPSE_THRESHOLD = 220;
  const initialConversations = conversationCache.get(currentUser.id)?.value || [];
  const initialSelectedId = preferredConversation(initialConversations);
  const initialMessageCache = initialSelectedId ? messageCache.get(messageCacheKey(currentUser.id, initialSelectedId)) : undefined;
  const initialVoiceConversationId = sessionStorage.getItem('mova-active-call') || sessionStorage.getItem('mova-pending-call') || initialSelectedId;
  const [conversations, setConversations] = useState<AppConversation[]>(initialConversations);
  const [users, setUsers] = useState<AppUser[]>(userCache.get(currentUser.id)?.value || []);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<AppMessage[]>(() => initialMessageCache?.value || []);
  const [focusedMessage, setFocusedMessage] = useState<{ conversationId: string; messageId: string } | null>(null);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<ConversationDrafts>(() => loadConversationDrafts(currentUser.id));
  const [loading, setLoading] = useState(!isFresh(conversationCache.get(currentUser.id)) || !isFresh(userCache.get(currentUser.id)));
  const [messagesLoading, setMessagesLoading] = useState(() => Boolean(initialSelectedId && !isFresh(messageCache.get(messageCacheKey(currentUser.id, initialSelectedId)))));
  const [messagesErrorFor, setMessagesErrorFor] = useState<string | null>(null);
  const [messagesLoadAttempt, setMessagesLoadAttempt] = useState(0);
  const [messageHistoryCursor, setMessageHistoryCursor] = useState<string | null>(() => initialMessageCache?.nextCursor || null);
  const [hasOlderMessages, setHasOlderMessages] = useState(() => Boolean(initialMessageCache?.hasMore));
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [olderHistoryError, setOlderHistoryError] = useState(false);
  const [persistentReady, setPersistentReady] = useState(false);
  const [networkAvailable, setNetworkAvailable] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [backgroundColor, setBackgroundColor] = useState(loadBackgroundColor);
  const [accentColor, setAccentColor] = useState(loadAccentColor);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [voiceConversationId, setVoiceConversationId] = useState<string | null>(initialVoiceConversationId);
  const [callCanvasOpen, setCallCanvasOpen] = useState(Boolean(sessionStorage.getItem('mova-pending-call')));
  const [query, setQuery] = useState('');
  const [composeMenuOpen, setComposeMenuOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchTab, setSearchTab] = useState<GlobalSearchTab>('users');
  const [searchMessages, setSearchMessages] = useState<Record<string, AppMessage[]>>({});
  const [searchMessagesLoading, setSearchMessagesLoading] = useState(false);
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(shouldPromptForNotifications);
  const [notificationPermissionLoading, setNotificationPermissionLoading] = useState(false);
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
  const totalUnreadCount = conversations.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0);
  useEffect(
    () => startUnreadTitleBlink(window.movaDesktopShell ? 0 : totalUnreadCount),
    [totalUnreadCount],
  );
  const updateConversationDraft = useCallback((conversationId: string, text: string) => {
    setDrafts((current) => {
      const next = { ...current };
      if (text.trim()) next[conversationId] = { text: text.slice(0, 4_000), updatedAt: new Date().toISOString() };
      else delete next[conversationId];
      persistConversationDrafts(currentUser.id, next);
      return next;
    });
  }, [currentUser.id]);
  const activeVoiceConversation = conversations.find((conversation) => conversation.id === voiceConversationId) || null;
  const voiceSession = useVoiceCall(voiceConversationId, currentUser.id, { direct: activeVoiceConversation?.kind === 'direct' });
  const voiceState = normalizeCallState(voiceSession.state);
  const voiceConversation = activeVoiceConversation;
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
  const outboxEntries = useRef(new Map<string, OutboxEntry>());
  const flushOutboxRef = useRef<() => Promise<void>>(async () => undefined);
  const acknowledgeMessageRef = useRef<(message: AppMessage) => Promise<void>>(async () => undefined);
  const outboxFlushInFlight = useRef<Promise<void> | null>(null);
  const firstHistoryRevalidation = useRef(true);
  const notifiedRealtimeMessageIds = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  productOverlayOpenRef.current = createOpen || profileOpen || settingsOpen || notificationPromptOpen || accountOpen || composeMenuOpen || searchActive;
  useEffect(() => {
    let active = true;
    void loadPersistentClientState(currentUser.id).then((state) => {
      if (!active) return;
      if (state.users) userCache.set(currentUser.id, state.users);
      for (const [conversationId, cache] of state.messages) messageCache.set(messageCacheKey(currentUser.id, conversationId), cache);
      outboxEntries.current = new Map(state.outbox.map((entry) => {
        const restoredMessage = { ...entry.message, deliveryState: 'queued' as const };
        const restoredEntry = { ...entry, message: restoredMessage };
        const key = messageCacheKey(currentUser.id, entry.conversationId);
        const cached = messageCache.get(key);
        messageCache.set(key, { ...cached, value: mergeMessageHistory(cached?.value || [], [restoredMessage]), updatedAt: cached?.updatedAt || 0 });
        void persistOutbox(restoredEntry).catch(() => undefined);
        return [entry.clientId, restoredEntry];
      }));
      const restoredConversations = state.conversations?.value || conversationCache.get(currentUser.id)?.value || [];
      const withPendingPreviews = state.outbox.reduce((items, entry) => updateConversationLastMessage(items, { ...entry.message, deliveryState: 'queued' }), restoredConversations);
      if (state.conversations) conversationCache.set(currentUser.id, { ...state.conversations, value: withPendingPreviews });
      setConversations(withPendingPreviews);
      setUsers(state.users?.value || userCache.get(currentUser.id)?.value || []);
      setSelectedId(preferredConversation(withPendingPreviews));
      setPersistentReady(true);
    }).catch(() => active && setPersistentReady(true));
    return () => { active = false; };
  }, [currentUser.id]);
  const setMobileNavigationView = useCallback((view: MobileNavigationView) => {
    mobileViewRef.current = view;
    setMobileView(view);
  }, []);
  const closeProductOverlays = useCallback(() => {
    setCreateOpen(false);
    setProfileOpen(false);
    setSettingsOpen(false);
    setAccountOpen(false);
    setComposeMenuOpen(false);
    setSearchActive(false);
    setQuery('');
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
  const applyRelationshipUser = useCallback((updatedUser: AppUser) => {
    setUsers((items) => {
      const next = items.some((item) => item.id === updatedUser.id)
        ? items.map((item) => item.id === updatedUser.id ? { ...item, ...updatedUser } : item)
        : [...items, updatedUser];
      userCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
      return next;
    });
    setConversations((items) => {
      const next = sortConversationsByActivity(items.map((conversation) => updateConversationUser(conversation, updatedUser, currentUserRef.current.id)));
      conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  }, []);
  const applyConversationUpdate = useCallback((updatedConversation: AppConversation) => {
    setConversations((items) => {
      const next = sortConversationsByActivity(items.map((conversation) => conversation.id === updatedConversation.id ? { ...conversation, ...updatedConversation } : conversation));
      conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  }, []);
  const removeConversationFromClient = useCallback((conversationId: string) => {
    messageCache.delete(messageCacheKey(currentUserRef.current.id, conversationId));
    void deletePersistentConversation(currentUserRef.current.id, conversationId).catch(() => undefined);
    for (const [clientId, entry] of outboxEntries.current) if (entry.conversationId === conversationId) outboxEntries.current.delete(clientId);
    setConversations((items) => {
      const next = items.filter((item) => item.id !== conversationId);
      conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
      return next;
    });
    if (selectedIdRef.current === conversationId) {
      selectedIdRef.current = null;
      setSelectedId(null);
      setMessages([]);
      if (window.localStorage.getItem('mova-selected-conversation') === conversationId) window.localStorage.removeItem('mova-selected-conversation');
      if (mobileNavigationRef.current) {
        window.history.replaceState(mobileHistoryState('list'), '');
        setMobileNavigationView('list');
      }
    }
    if (voiceConversationIdRef.current === conversationId) setVoiceConversationId(null);
  }, [setMobileNavigationView]);
  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await api.deleteConversation(conversationId);
      removeConversationFromClient(conversationId);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось удалить чат', 'danger');
    }
  }, [removeConversationFromClient, toast]);
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
    if (!window.movaDesktopShell) void restoreMessageNotifications();
  }, [currentUser.id]);
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
          const conversation = conversationsRef.current.find((item) => item.id === event.message.conversationId);
          const senderRelationship = conversation?.members.find((member) => member.id === event.message.authorId)?.relationship;
          const nativeNotificationSoundAvailable = Boolean(window.movaDesktopShell)
            || ('Notification' in window && window.Notification.permission === 'granted');
          const shouldPlayInPage = shouldPlayMessageSoundInPage(
            document.visibilityState === 'visible',
            document.hasFocus(),
            nativeNotificationSoundAvailable,
          );
          if ((!event.message.kind || event.message.kind === 'user') && senderRelationship === 'friend' && shouldPlayInPage) {
            const settings = loadAudioSettings();
            const audio = new Audio(messageSoundUrl);
            audio.volume = settings.systemVolume / 100;
            const sinkId = settings.outputDeviceId === 'default' ? '' : settings.outputDeviceId;
            const setSinkId = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
            const play = () => void audio.play().catch(() => undefined);
            if (setSinkId) void setSinkId.call(audio, sinkId).then(play).catch(play);
            else play();
          }
          showMessageNotification(event.message, conversation, () => {
            setSelectedId(event.message.conversationId);
            window.localStorage.setItem('mova-selected-conversation', event.message.conversationId);
            showMobileConversation(event.message.conversationId);
          });
        }
      }),
    [showMobileConversation],
  );
  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;
  const selectConversation = useCallback((conversationId: string) => {
    setSelectedId(conversationId);
    window.localStorage.setItem('mova-selected-conversation', conversationId);
    showMobileConversation(conversationId);
  }, [showMobileConversation]);
  const clearFocusedMessage = useCallback(() => setFocusedMessage(null), []);
  useEffect(() => {
    const handleNotificationClick = (event: MessageEvent<{ type?: string; conversationId?: string }>) => {
      if (event.data?.type === 'mova:notification-click' && event.data.conversationId) selectConversation(event.data.conversationId);
    };
    navigator.serviceWorker?.addEventListener('message', handleNotificationClick);
    const disposeDesktop = window.movaDesktopShell?.onNotificationClick?.(({ conversationId }) => conversationId && selectConversation(conversationId));
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleNotificationClick);
      disposeDesktop?.();
    };
  }, [selectConversation]);
  const requestCall = useCallback((conversationId: string, video: boolean) => {
    const callConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId);
    if (callConversation?.kind === 'saved') {
      toast.push('В Избранном звонки недоступны.', 'info');
      return;
    }
    const callContact = callConversation?.kind === 'direct' ? callConversation.members.find((member) => member.id !== currentUserRef.current.id) : null;
    if (callContact && callContact.relationship !== 'friend') {
      toast.push('Звонки доступны только друзьям.', 'info');
      return;
    }
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
  const withOutboxPreviews = useCallback((items: AppConversation[]) =>
    [...outboxEntries.current.values()].reduce((conversations, entry) => updateConversationLastMessage(conversations, entry.message), items), []);
  const reloadConversations = useCallback(async (force = false) => {
    const cached = conversationCache.get(currentUser.id);
    if (!force && isFresh(cached)) {
      setConversations(cached!.value);
      setSelectedId((current) => (current && cached!.value.some((item) => item.id === current) ? current : preferredConversation(cached!.value)));
      return;
    }
    const result = await api.conversations();
    const nextConversations = withOutboxPreviews(sortConversationsByActivity(result.conversations));
    conversationCache.set(currentUser.id, { value: nextConversations, updatedAt: Date.now() });
    setConversations(nextConversations);
    setSelectedId((current) => {
      return current && nextConversations.some((item) => item.id === current) ? current : preferredConversation(nextConversations);
    });
  }, [currentUser.id, withOutboxPreviews]);
  const syncOverview = useCallback(() => {
    if (overviewSyncInFlight.current) return overviewSyncInFlight.current;
    const sync = Promise.all([api.conversations(), api.users()])
      .then(([conversationResult, userResult]) => {
        const nextConversations = withOutboxPreviews(sortConversationsByActivity(conversationResult.conversations));
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
  }, [currentUser.id, withOutboxPreviews]);
  const syncActiveMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    if (!conversationId) return;
    const result = await api.messages(conversationId);
    if (selectedIdRef.current !== conversationId) return;
    setMessages((items) => {
      const cacheKey = messageCacheKey(currentUser.id, conversationId);
      const cached = messageCache.get(cacheKey);
      const next = mergeMessageHistory(items, result.messages);
      const hadExpandedHistory = items.length > result.messages.length;
      messageCache.set(cacheKey, {
        value: next,
        updatedAt: Date.now(),
        hasMore: hadExpandedHistory ? cached?.hasMore : Boolean(result.hasMore),
        nextCursor: hadExpandedHistory ? cached?.nextCursor : result.nextCursor || null,
      });
      if (!hadExpandedHistory) {
        setHasOlderMessages(Boolean(result.hasMore));
        setMessageHistoryCursor(result.nextCursor || null);
      }
      return next;
    });
  }, [currentUser.id]);
  const applyVoiceListenReceipt = useCallback((result: { conversationId: string; messageId: string; userId: string; listenedAt: string }) => {
    const update = (items: AppMessage[]) => items.map((message) =>
      message.id === result.messageId && !message.listenedBy?.some((receipt) => receipt.userId === result.userId)
        ? { ...message, listenedBy: [...(message.listenedBy || []), { userId: result.userId, listenedAt: result.listenedAt }] }
        : message,
    );
    const cacheKey = messageCacheKey(currentUserRef.current.id, result.conversationId);
    const cached = messageCache.get(cacheKey);
    if (cached) messageCache.set(cacheKey, { ...cached, value: update(cached.value), updatedAt: Date.now() });
    if (selectedIdRef.current === result.conversationId) setMessages(update);
    setConversations((items) => {
      const next = items.map((conversation) => conversation.id === result.conversationId && conversation.lastMessage?.id === result.messageId
        ? {
            ...conversation,
            lastMessage: {
              ...conversation.lastMessage,
              listenedBy: conversation.lastMessage.listenedBy?.some((receipt) => receipt.userId === result.userId)
                ? conversation.lastMessage.listenedBy
                : [...(conversation.lastMessage.listenedBy || []), { userId: result.userId, listenedAt: result.listenedAt }],
            },
          }
        : conversation);
      conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  }, []);
  useEffect(() => {
    if (!persistentReady) return;
    const loadUsers = async () => {
      const result = await api.users();
      userCache.set(currentUser.id, { value: result.users, updatedAt: Date.now() });
      setUsers(result.users);
    };
    Promise.all([reloadConversations(true), loadUsers()]).catch(() => undefined).finally(() => setLoading(false));
    realtime.connect();
    const unsubscribe = realtime.subscribe((event: RealtimeEvent) => {
      if (event.type === 'realtime:disconnected') setNetworkAvailable(false);
      if (event.type === 'message:new') {
        if (event.message.clientId && event.message.authorId === currentUserRef.current.id) void acknowledgeMessageRef.current(event.message);
        updateTypingUser(event.message.conversationId, event.message.authorId, false);
        const cacheKey = messageCacheKey(currentUserRef.current.id, event.message.conversationId);
        const cachedEntry = messageCache.get(cacheKey);
        const cached = cachedEntry?.value || [];
        messageCache.set(cacheKey, { ...cachedEntry, value: reconcileClientMessage(cached, event.message), updatedAt: cachedEntry ? Date.now() : 0 });
        setMessages((items) => (event.message.conversationId === selectedIdRef.current ? reconcileClientMessage(items, event.message) : items));
        setConversations((items) => {
          const alreadyCounted = items.some((conversation) => conversation.id === event.message.conversationId && conversation.lastMessage?.id === event.message.id);
          const incoming = event.message.authorId !== currentUserRef.current.id;
          const next = updateConversationLastMessage(items, event.message).map((conversation) =>
            conversation.id === event.message.conversationId && incoming && !alreadyCounted
              ? { ...conversation, unreadCount: (conversation.unreadCount || 0) + 1 }
              : conversation,
          );
          conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
      }
      if (event.type === 'message:update') {
        const cacheKey = messageCacheKey(currentUserRef.current.id, event.message.conversationId);
        const cachedEntry = messageCache.get(cacheKey);
        if (cachedEntry) messageCache.set(cacheKey, { ...cachedEntry, value: cachedEntry.value.map((message) => (message.id === event.message.id ? event.message : message)), updatedAt: Date.now() });
        if (event.message.conversationId === selectedIdRef.current) setMessages((items) => items.map((message) => (message.id === event.message.id ? event.message : message)));
        setConversations((items) => {
          const next = updateConversationLastMessage(items, event.message, true);
          conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
      }
      if (event.type === 'message:delete' && event.userId === currentUserRef.current.id) {
        const cacheKey = messageCacheKey(currentUserRef.current.id, event.conversationId);
        const cachedEntry = messageCache.get(cacheKey);
        if (cachedEntry) messageCache.set(cacheKey, { ...cachedEntry, value: cachedEntry.value.filter((message) => message.id !== event.messageId), updatedAt: Date.now() });
        if (event.conversationId === selectedIdRef.current) setMessages((items) => items.filter((message) => message.id !== event.messageId));
        setConversations((items) => {
          const next = items.map((conversation) => conversation.id === event.conversationId ? { ...conversation, lastMessage: event.lastMessage } : conversation);
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
      if (event.type === 'message:voice-listened') applyVoiceListenReceipt(event);
      if (event.type === 'call:invite') {
        if (voiceStateRef.current !== 'idle' && voiceConversationIdRef.current !== event.conversationId) {
          const activeTitle = conversationsRef.current.find((conversation) => conversation.id === voiceConversationIdRef.current)?.title || 'другом чате';
          toast.push(`Входящий звонок пропущен: вы уже разговариваете в «${activeTitle}».`, 'info');
          return;
        }
        showIncomingCallNotification(event.conversationId, event.from, () => {
          selectConversation(event.conversationId);
          setCallCanvasOpen(true);
        });
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
      if (event.type === 'conversation:delete') removeConversationFromClient(event.conversationId);
      if (event.type === 'ready') {
        setNetworkAvailable(true);
        void flushOutboxRef.current();
        realtimeReadyCount.current += 1;
        if (realtimeReadyCount.current > 1) {
          void syncOverview();
          void syncActiveMessages().catch(() => undefined);
        }
      }
      if (event.type === 'relationship:update') applyRelationshipUser(event.user);
      if (event.type === 'profile:update' || event.type === 'presence:update') {
        if (event.user.id === currentUserRef.current.id) onUserUpdate(event.user);
        setUsers((items) => {
          const next = items.map((user) => (user.id === event.user.id ? { ...event.user, relationship: user.relationship } : user));
          userCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
        setConversations((items) => {
          const next = items.map((conversation) => {
            const member = conversation.members.find((item) => item.id === event.user.id);
            return updateConversationUser(
              conversation,
              member ? { ...event.user, relationship: member.relationship } : event.user,
              currentUserRef.current.id,
            );
          });
          conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
          return next;
        });
      }
    });
    const refreshOverview = () => {
      setNetworkAvailable(navigator.onLine);
      if (navigator.onLine) void flushOutboxRef.current();
      if (navigator.onLine && document.visibilityState === 'visible') void syncOverview();
    };
    const markOffline = () => setNetworkAvailable(false);
    const refreshTimer = window.setInterval(refreshOverview, 5 * 60_000);
    window.addEventListener('focus', refreshOverview);
    window.addEventListener('online', refreshOverview);
    window.addEventListener('offline', markOffline);
    document.addEventListener('visibilitychange', refreshOverview);
    return () => {
      unsubscribe();
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshOverview);
      window.removeEventListener('online', refreshOverview);
      window.removeEventListener('offline', markOffline);
      document.removeEventListener('visibilitychange', refreshOverview);
      typingExpiryTimers.current.forEach((timer) => window.clearTimeout(timer));
      typingExpiryTimers.current.clear();
      realtime.close();
    };
  }, [applyRelationshipUser, applyVoiceListenReceipt, reloadConversations, removeConversationFromClient, selectConversation, currentUser.id, onUserUpdate, persistentReady, syncActiveMessages, syncOverview, toast, updateTypingUser]);
  useEffect(() => {
    const desktopShell = window.movaDesktopShell;
    if (desktopShell?.getSystemIdleTime) {
      let active = true;
      let checking = false;
      const synchronizeDesktopPresence = async () => {
        if (checking) return;
        checking = true;
        try {
          const idleSeconds = await desktopShell.getSystemIdleTime!();
          if (!active) return;
          const nextPresence = presenceUpdateForSystemIdle(currentUserRef.current.presence, idleSeconds);
          if (nextPresence) {
            const result = await api.updatePresence(nextPresence);
            if (active) onUserUpdate(result.user);
          }
        } catch {
          // A temporary IPC/network failure is retried on the next interval.
        } finally {
          checking = false;
        }
      };
      void synchronizeDesktopPresence();
      const timer = window.setInterval(() => void synchronizeDesktopPresence(), 30_000);
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }
    const markActive = () => {
      lastActivity.current = Date.now();
      if (currentUserRef.current.presence === 'idle') void api.updatePresence('online').then((result) => onUserUpdate(result.user)).catch(() => undefined);
    };
    const events = ['pointerdown', 'keydown', 'mousemove'];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (currentUserRef.current.presence === 'online' && Date.now() - lastActivity.current >= 15 * 60_000) void api.updatePresence('idle').then((result) => onUserUpdate(result.user)).catch(() => undefined);
    }, 30_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActive));
      window.clearInterval(timer);
    };
  }, [onUserUpdate]);
  useEffect(() => {
    const desktopShell = window.movaDesktopShell;
    if (!desktopShell?.getGameActivity || !desktopShell.onGameActivityChange) return;
    let active = true;
    const synchronizeGame = (activity: DesktopGameActivity | null) => {
      const name = activity?.name?.trim() || null;
      realtime.send({ type: 'activity:update', name, iconDataUrl: activity?.iconDataUrl || '' });
    };
    const dispose = desktopShell.onGameActivityChange(synchronizeGame);
    const disposeRealtime = realtime.subscribe((event) => {
      if (event.type === 'ready') void desktopShell.getGameActivity!().then((activity) => active && synchronizeGame(activity)).catch(() => undefined);
    });
    void desktopShell.getGameActivity().then((activity) => active && synchronizeGame(activity)).catch(() => undefined);
    return () => {
      active = false;
      dispose();
      disposeRealtime();
    };
  }, [currentUser.id, onUserUpdate]);
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
    if (!persistentReady) return;
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
    setHasOlderMessages(Boolean(cached?.hasMore));
    setMessageHistoryCursor(cached?.nextCursor || null);
    setLoadingOlderMessages(false);
    setOlderHistoryError(false);
    setMessagesErrorFor(null);
    const mustRevalidate = firstHistoryRevalidation.current;
    firstHistoryRevalidation.current = false;
    if (isFresh(cached) && !mustRevalidate) {
      setMessagesLoading(false);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    api.messages(selectedId)
      .then((result) => {
        const pending = [...outboxEntries.current.values()].filter((entry) => entry.conversationId === selectedId).map((entry) => entry.message);
        const nextMessages = mergeMessageHistory(result.messages, pending);
        messageCache.set(key, { value: nextMessages, updatedAt: Date.now(), hasMore: Boolean(result.hasMore), nextCursor: result.nextCursor || null });
        if (!cancelled) {
          setMessages(nextMessages);
          setHasOlderMessages(Boolean(result.hasMore));
          setMessageHistoryCursor(result.nextCursor || null);
        }
      })
      .catch(() => {
        if (!cancelled) setMessagesErrorFor(selectedId);
      })
      .finally(() => !cancelled && setMessagesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, currentUser.id, messagesLoadAttempt, persistentReady]);
  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    if (!conversationId || !messageHistoryCursor || loadingOlderMessages || !hasOlderMessages) return;
    setLoadingOlderMessages(true);
    setOlderHistoryError(false);
    try {
      const result = await api.messages(conversationId, { before: messageHistoryCursor });
      if (selectedIdRef.current !== conversationId) return;
      setMessages((items) => {
        const next = mergeMessageHistory(items, result.messages);
        messageCache.set(messageCacheKey(currentUser.id, conversationId), { value: next, updatedAt: Date.now(), hasMore: Boolean(result.hasMore), nextCursor: result.nextCursor || null });
        return next;
      });
      setHasOlderMessages(Boolean(result.hasMore));
      setMessageHistoryCursor(result.nextCursor || null);
    } catch {
      if (selectedIdRef.current === conversationId) setOlderHistoryError(true);
      throw new Error('Не удалось загрузить ранние сообщения');
    } finally {
      if (selectedIdRef.current === conversationId) setLoadingOlderMessages(false);
    }
  }, [currentUser.id, hasOlderMessages, loadingOlderMessages, messageHistoryCursor]);
  const markConversationRead = useCallback(async (conversationId: string, throughMessageId: string) => {
    if (markingReadThrough.current === throughMessageId || document.visibilityState !== 'visible') return;
    markingReadThrough.current = throughMessageId;
    try {
      const result = await api.markConversationRead(conversationId, throughMessageId);
      const readIds = new Set(result.messageIds);
      const applyReceipts = (items: AppMessage[]) => items.map((message) =>
        readIds.has(message.id) && !message.readBy?.some((receipt) => receipt.userId === result.userId)
          ? { ...message, readBy: [...(message.readBy || []), { userId: result.userId, readAt: result.readAt }] }
          : message,
      );
      const cacheKey = messageCacheKey(currentUserRef.current.id, conversationId);
      const cached = messageCache.get(cacheKey);
      if (cached) messageCache.set(cacheKey, { ...cached, value: applyReceipts(cached.value), updatedAt: Date.now() });
      if (selectedIdRef.current === conversationId) setMessages(applyReceipts);
      setConversations((items) => {
        const next = items.map((conversation) => conversation.id === conversationId
          ? { ...conversation, unreadCount: Math.max(0, (conversation.unreadCount || 0) - result.messageIds.length) }
          : conversation);
        conversationCache.set(currentUserRef.current.id, { value: next, updatedAt: Date.now() });
        return next;
      });
    } finally {
      if (markingReadThrough.current === throughMessageId) markingReadThrough.current = null;
    }
  }, []);
  const markVoiceListened = useCallback(async (conversationId: string, messageId: string) => {
    const result = await api.markVoiceListened(conversationId, messageId);
    applyVoiceListenReceipt(result);
  }, [applyVoiceListenReceipt]);
  const updatePendingMessage = (conversationId: string, clientId: string, patch: Partial<AppMessage>) => {
    const update = (items: AppMessage[]) => items.map((message) => (message.clientId === clientId && !message.sentAt ? { ...message, ...patch } : message));
    const cacheKey = messageCacheKey(currentUser.id, conversationId);
    const cached = messageCache.get(cacheKey)?.value || [];
    const cachedEntry = messageCache.get(cacheKey);
    messageCache.set(cacheKey, { ...cachedEntry, value: update(cached), updatedAt: Date.now() });
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
    const entry = outboxEntries.current.get(clientId);
    if (!entry) return Promise.resolve();
    const nextEntry = { ...entry, message: { ...entry.message, ...patch }, updatedAt: Date.now() };
    outboxEntries.current.set(clientId, nextEntry);
    return persistOutbox(nextEntry).catch(() => undefined);
  };
  const acknowledgeMessage = async (message: AppMessage) => {
    const persistence: Promise<void>[] = [];
    if (message.clientId) {
      for (const entry of outboxEntries.current.values()) {
        if (entry.message.replyToId !== message.clientId) continue;
        const replyTo = entry.message.replyTo ? { ...entry.message.replyTo, id: message.id } : entry.message.replyTo;
        persistence.push(updatePendingMessage(entry.conversationId, entry.clientId, { replyToId: message.id, replyTo }));
      }
      outboxEntries.current.delete(message.clientId);
      persistence.push(removeOutbox(message.clientId).catch(() => undefined));
    }
    const cacheKey = messageCacheKey(currentUser.id, message.conversationId);
    const cached = messageCache.get(cacheKey)?.value || [];
    const cachedEntry = messageCache.get(cacheKey);
    messageCache.set(cacheKey, { ...cachedEntry, value: reconcileClientMessage(cached, message), updatedAt: Date.now() });
    setMessages((items) => (selectedIdRef.current === message.conversationId ? reconcileClientMessage(items, message) : items));
    setConversations((items) => {
      const next = updateConversationLastMessage(items, message);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
    await Promise.all(persistence);
  };
  acknowledgeMessageRef.current = acknowledgeMessage;
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
      deliveryState: navigator.onLine ? 'sending' : 'queued',
    };
    const outboxEntry: OutboxEntry = { clientId, userId: currentUser.id, conversationId, message: optimisticMessage, attempts: 0, updatedAt: Date.now() };
    outboxEntries.current.set(clientId, outboxEntry);
    setMessages((items) => {
      const next = [...items, optimisticMessage];
      const cacheKey = messageCacheKey(currentUser.id, conversationId);
      messageCache.set(cacheKey, { ...messageCache.get(cacheKey), value: next, updatedAt: Date.now() });
      return next;
    });
    setConversations((items) => {
      const next = updateConversationLastMessage(items, optimisticMessage);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
    await persistOutbox(outboxEntry).catch(() => undefined);
    if (!navigator.onLine) {
      setNetworkAvailable(false);
      return;
    }
    try {
      outboxEntry.attempts += 1;
      outboxEntry.updatedAt = Date.now();
      await persistOutbox(outboxEntry).catch(() => undefined);
      const result = await sendMessageAttempt(optimisticMessage);
      await acknowledgeMessage(result.message);
    } catch (sendFailure) {
      const queued = !navigator.onLine || sendFailure instanceof TypeError;
      await updatePendingMessage(conversationId, clientId, { deliveryState: queued ? 'queued' : 'failed' });
      if (queued) {
        setNetworkAvailable(false);
        return;
      }
      throw sendFailure;
    }
  };
  const retry = async (message: AppMessage) => {
    const clientId = message.clientId;
    if (!clientId || retryingClientIds.current.has(clientId)) return;
    const existingEntry = outboxEntries.current.get(clientId);
    const pendingMessage = existingEntry?.message || message;
    let initialPersistence: Promise<void> = Promise.resolve();
    if (!existingEntry) {
      const entry = { clientId, userId: currentUser.id, conversationId: message.conversationId, message, attempts: 0, updatedAt: Date.now() };
      outboxEntries.current.set(clientId, entry);
      initialPersistence = persistOutbox(entry).catch(() => undefined);
    }
    if (!navigator.onLine) {
      await updatePendingMessage(message.conversationId, clientId, { deliveryState: 'queued' });
      setNetworkAvailable(false);
      return;
    }
    retryingClientIds.current.add(clientId);
    const sendingPersistence = updatePendingMessage(message.conversationId, clientId, { deliveryState: 'sending' });
    try {
      const entry = outboxEntries.current.get(clientId);
      let attemptPersistence: Promise<void> = Promise.resolve();
      if (entry) {
        entry.attempts += 1;
        entry.updatedAt = Date.now();
        attemptPersistence = persistOutbox(entry).catch(() => undefined);
      }
      const sendPromise = sendMessageAttempt(pendingMessage);
      await Promise.all([initialPersistence, sendingPersistence, attemptPersistence]);
      const result = await sendPromise;
      await acknowledgeMessage(result.message);
    } catch (retryFailure) {
      const queued = !navigator.onLine || retryFailure instanceof TypeError;
      await updatePendingMessage(message.conversationId, clientId, { deliveryState: queued ? 'queued' : 'failed' });
      if (queued) {
        setNetworkAvailable(false);
        return;
      }
      throw retryFailure;
    } finally {
      retryingClientIds.current.delete(clientId);
    }
  };
  const flushOutbox = useCallback(() => {
    if (outboxFlushInFlight.current) return outboxFlushInFlight.current;
    const flush = (async () => {
      if (!navigator.onLine) return;
      const entries = [...outboxEntries.current.values()].sort((first, second) => first.message.createdAt.localeCompare(second.message.createdAt));
      for (const entry of entries) {
        if (retryingClientIds.current.has(entry.clientId)) continue;
        retryingClientIds.current.add(entry.clientId);
        await updatePendingMessage(entry.conversationId, entry.clientId, { deliveryState: 'sending' });
        try {
          const currentEntry = outboxEntries.current.get(entry.clientId) || entry;
          const attemptedEntry = { ...currentEntry, attempts: currentEntry.attempts + 1, updatedAt: Date.now() };
          outboxEntries.current.set(entry.clientId, attemptedEntry);
          await persistOutbox(attemptedEntry).catch(() => undefined);
          const result = await sendMessageAttempt(attemptedEntry.message);
          await acknowledgeMessage(result.message);
        } catch (error) {
          await updatePendingMessage(entry.conversationId, entry.clientId, { deliveryState: !navigator.onLine || error instanceof TypeError ? 'queued' : 'failed' });
          if (!navigator.onLine) break;
        } finally {
          retryingClientIds.current.delete(entry.clientId);
        }
      }
    })().finally(() => {
      if (outboxFlushInFlight.current === flush) outboxFlushInFlight.current = null;
    });
    outboxFlushInFlight.current = flush;
    return flush;
  }, [currentUser.id]);
  flushOutboxRef.current = flushOutbox;
  useEffect(() => {
    if (persistentReady && navigator.onLine) void flushOutbox();
  }, [flushOutbox, persistentReady]);
  const edit = async (messageId: string, content: string) => {
    if (!selectedId) return;
    const pending = outboxEntries.current.get(messageId);
    if (pending) {
      await updatePendingMessage(selectedId, messageId, { content });
      return;
    }
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
  const setMessagePinned = async (messageId: string, pinned: boolean) => {
    if (!selectedId) return;
    const result = await api.setMessagePinned(selectedId, messageId, pinned);
    setMessages((items) => {
      const next = items.map((message) => message.id === result.message.id ? result.message : message);
      const cached = messageCache.get(messageCacheKey(currentUser.id, selectedId));
      messageCache.set(messageCacheKey(currentUser.id, selectedId), { ...cached, value: next, updatedAt: Date.now() });
      return next;
    });
    setConversations((items) => {
      const next = updateConversationLastMessage(items, result.message, true);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  };
  const forwardMessage = async (messageId: string, targetConversationId: string) => {
    if (!selectedId) return;
    const result = await api.forwardMessage(selectedId, messageId, targetConversationId);
    const targetCacheKey = messageCacheKey(currentUser.id, targetConversationId);
    const cached = messageCache.get(targetCacheKey);
    if (cached) messageCache.set(targetCacheKey, { ...cached, value: reconcileClientMessage(cached.value, result.message), updatedAt: Date.now() });
    if (selectedIdRef.current === targetConversationId) setMessages((items) => reconcileClientMessage(items, result.message));
    setConversations((items) => {
      const next = updateConversationLastMessage(items, result.message);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  };
  const openForwardSource = async (source: ForwardedMessageSource) => {
    if (!source.canOpen || !source.conversationId || !source.messageId) {
      toast.push('Исходный диалог недоступен.', 'info');
      return;
    }
    try {
      const [latest, context] = await Promise.all([
        api.messages(source.conversationId),
        api.messageContext(source.conversationId, source.messageId),
      ]);
      const nextMessages = mergeMessageHistory(latest.messages, context.messages);
      const cacheKey = messageCacheKey(currentUser.id, source.conversationId);
      messageCache.set(cacheKey, {
        value: nextMessages,
        updatedAt: Date.now(),
        hasMore: Boolean(latest.hasMore),
        nextCursor: latest.nextCursor || null,
      });
      if (selectedIdRef.current === source.conversationId) {
        setMessages(nextMessages);
        setHasOlderMessages(Boolean(latest.hasMore));
        setMessageHistoryCursor(latest.nextCursor || null);
      }
      setFocusedMessage({ conversationId: source.conversationId, messageId: source.messageId });
      selectConversation(source.conversationId);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось открыть исходное сообщение.', 'danger');
    }
  };
  const deleteMessage = async (messageId: string, scope: 'self' | 'everyone' = 'self') => {
    if (!selectedId) return;
    const result = await api.deleteMessage(selectedId, messageId, scope);
    const cacheKey = messageCacheKey(currentUser.id, selectedId);
    const cached = messageCache.get(cacheKey);
    if (cached) messageCache.set(cacheKey, { ...cached, value: cached.value.filter((message) => message.id !== messageId), updatedAt: Date.now() });
    setMessages((items) => items.filter((message) => message.id !== messageId));
    setConversations((items) => {
      const next = items.map((conversation) => conversation.id === selectedId ? { ...conversation, lastMessage: result.lastMessage } : conversation);
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      return next;
    });
  };
  const openGlobalSearch = useCallback((tab: GlobalSearchTab = 'users') => {
    setComposeMenuOpen(false);
    setAccountOpen(false);
    setSearchTab(tab);
    setSearchActive(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);
  const closeGlobalSearch = useCallback(() => {
    setSearchActive(false);
    setQuery('');
  }, []);
  const normalizedSearchQuery = query.trim().toLocaleLowerCase();
  const searchQueryReady = normalizedSearchQuery.length >= 2;
  useEffect(() => {
    if (!searchActive) return;
    searchInputRef.current?.focus();
    if (searchTab !== 'links' || !searchQueryReady) {
      setSearchMessages({});
      setSearchMessagesLoading(false);
      return;
    }
    const cachedMessages = Object.fromEntries(
      conversations.flatMap((conversation) => {
        const cached = messageCache.get(messageCacheKey(currentUser.id, conversation.id));
        return cached ? [[conversation.id, cached.value] as const] : [];
      }),
    );
    setSearchMessages(cachedMessages);
    const missing = conversations.filter((conversation) => !cachedMessages[conversation.id]);
    if (!missing.length) return;
    let active = true;
    setSearchMessagesLoading(true);
    void Promise.allSettled(missing.map(async (conversation) => {
      const result = await api.messages(conversation.id);
      messageCache.set(messageCacheKey(currentUser.id, conversation.id), { value: result.messages, updatedAt: Date.now() });
      return [conversation.id, result.messages] as const;
    })).then((results) => {
      if (!active) return;
      setSearchMessages((current) => ({
        ...current,
        ...Object.fromEntries(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))),
      }));
    }).finally(() => active && setSearchMessagesLoading(false));
    return () => {
      active = false;
    };
  }, [conversations, currentUser.id, searchActive, searchQueryReady, searchTab]);
  const listedConversations = useMemo(() => conversations.filter((conversation) => !conversation.isDraft || Boolean(drafts[conversation.id]?.text.trim())).sort((left, right) => {
    const savedOrder = Number(right.kind === 'saved') - Number(left.kind === 'saved');
    if (savedOrder) return savedOrder;
    const relationshipOrder = conversationRelationshipRank(left) - conversationRelationshipRank(right);
    if (relationshipOrder) return relationshipOrder;
    const leftActivity = new Date(drafts[left.id]?.updatedAt || left.lastMessage?.createdAt || left.createdAt).getTime();
    const rightActivity = new Date(drafts[right.id]?.updatedAt || right.lastMessage?.createdAt || right.createdAt).getTime();
    return rightActivity - leftActivity;
  }), [conversations, drafts]);
  const visible = useMemo(
    () => listedConversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(normalizedSearchQuery)),
    [listedConversations, normalizedSearchQuery],
  );
  const incomingFriendRequestCount = useMemo(() => new Set([
    ...users.filter((user) => user.relationship === 'incoming').map((user) => user.id),
    ...conversations.flatMap((conversation) => conversation.members.filter((member) => member.relationship === 'incoming').map((member) => member.id)),
  ]).size, [conversations, users]);
  const searchUsers = useMemo(
    () => searchQueryReady ? users.filter((user) => `${user.name} ${user.handle}`.toLocaleLowerCase().includes(normalizedSearchQuery)) : [],
    [normalizedSearchQuery, searchQueryReady, users],
  );
  const searchChats = useMemo(
    () => searchQueryReady ? listedConversations.filter((conversation) => {
      const members = conversation.members.map((member) => `${member.name} ${member.handle}`).join(' ');
      return `${conversation.title} ${members} ${conversation.lastMessage?.content || ''} ${drafts[conversation.id]?.text || ''}`.toLocaleLowerCase().includes(normalizedSearchQuery);
    }) : [],
    [drafts, listedConversations, normalizedSearchQuery, searchQueryReady],
  );
  const searchLinks = useMemo(
    () => searchQueryReady ? listedConversations.flatMap((conversation) => {
      const sourceMessages = searchMessages[conversation.id]
        || (conversation.lastMessage ? [{ ...conversation.lastMessage, author: currentUser } as AppMessage] : []);
      return sourceMessages.flatMap((message) => messageLinks(message.content).map((url) => ({ conversation, message, url })));
    }).filter(({ conversation, message, url }) =>
      `${url} ${conversation.title} ${message.author.name} ${message.content}`.toLocaleLowerCase().includes(normalizedSearchQuery),
    ) : [],
    [currentUser, listedConversations, normalizedSearchQuery, searchMessages, searchQueryReady],
  );
  const openSearchConversation = useCallback((conversationId: string) => {
    closeGlobalSearch();
    selectConversation(conversationId);
  }, [closeGlobalSearch, selectConversation]);
  const ensureDirectConversation = useCallback(async (person: AppUser) => {
    const existing = conversationsRef.current.find((conversation) =>
      conversation.kind === 'direct' && conversation.members.some((member) => member.id === person.id),
    );
    if (existing) return existing;
    try {
      const result = await api.createConversation({ kind: 'direct', memberIds: [person.id] });
      const draftConversation = { ...result.conversation, isDraft: !result.conversation.lastMessage };
      const next = sortConversationsByActivity([draftConversation, ...conversationsRef.current.filter((item) => item.id !== result.conversation.id)]);
      conversationsRef.current = next;
      conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
      setConversations(next);
      return draftConversation;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось открыть личный чат', 'danger');
      return null;
    }
  }, [currentUser.id, toast]);
  const openDirectConversation = useCallback(async (person: AppUser) => {
    const directConversation = await ensureDirectConversation(person);
    if (directConversation) openSearchConversation(directConversation.id);
  }, [ensureDirectConversation, openSearchConversation]);
  const startDirectCall = useCallback(async (person: AppUser, video: boolean) => {
    const directConversation = await ensureDirectConversation(person);
    if (!directConversation) return;
    selectConversation(directConversation.id);
    requestCall(directConversation.id, video);
  }, [ensureDirectConversation, requestCall, selectConversation]);
  const mobileNavigationClass = mobileNavigation ? ` is-mobile-navigation is-mobile-${mobileView}` : '';
  return (
    <main className={`mova-real-app mova-tg-app${sidebarCompact ? ' is-sidebar-compact' : ''}${accountOpen ? ' is-account-menu-open' : ''}${voiceDockVisible ? ' has-voice-dock' : ''}${mobileNavigationClass}`} style={{ '--mova-sidebar-width': `${sidebarWidth}px`, '--mova-background-color': backgroundColor, '--mova-accent-color': accentColor } as CSSProperties} data-mobile-view={mobileNavigation ? mobileView : undefined}>
      <div className="mova-real-aurora" />
      {!networkAvailable && <div className="mova-offline-notice" role="status"><CloudOff size={15} /> {navigator.onLine ? 'Связь восстанавливается · сообщения защищены очередью' : 'Нет соединения · новые сообщения останутся в очереди'}</div>}
      <aside className="mova-real-sidebar mova-tg-sidebar" aria-hidden={mobileNavigation && mobileView === 'chat'} inert={mobileNavigation && mobileView === 'chat' ? true : undefined}>
        <div className="mova-tg-search-row">
          {searchActive ? (
            <IconButton label="Закрыть поиск" className="mova-search-back" onClick={closeGlobalSearch}>
              <ArrowLeft size={23} />
            </IconButton>
          ) : (
            <div className="mova-account-anchor">
              <IconButton label="Меню и профиль" className="mova-tg-menu" onClick={() => setAccountOpen(!accountOpen)}>
                <Menu size={23} />
              </IconButton>
              {incomingFriendRequestCount > 0 && (
                <span className="mova-friend-request-count" aria-label={`Входящих заявок в друзья: ${incomingFriendRequestCount}`} aria-live="polite">
                  {incomingFriendRequestCount > 99 ? '99+' : incomingFriendRequestCount}
                </span>
              )}
              <AccountMenu user={currentUser} open={accountOpen} onClose={() => setAccountOpen(false)} onEdit={() => setProfileOpen(true)} onSettings={() => setSettingsOpen(true)} onUpdated={onUserUpdate} onLogout={onLogout} />
            </div>
          )}
          <label className={`mova-tg-search${searchActive ? ' is-active' : ''}`}>
            <Search size={20} />
            <input ref={searchInputRef} value={query} onFocus={() => { if (!searchActive) openGlobalSearch(); }} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" aria-label="Глобальный поиск" />
            {searchActive && query && <button type="button" aria-label="Очистить поиск" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}><X size={18} /></button>}
          </label>
        </div>
        {searchActive ? (
          <section className="mova-global-search" aria-label="Результаты поиска">
            <div className="mova-global-search__tabs" role="tablist" aria-label="Область поиска" onWheel={(event) => {
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
              event.currentTarget.scrollLeft += event.deltaY;
            }}>
              {([['users', 'Пользователи'], ['chats', 'Чаты'], ['links', 'Ссылки']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={searchTab === id} className={searchTab === id ? 'is-active' : ''} onClick={() => setSearchTab(id)}>{label}</button>
              ))}
            </div>
            <div className="mova-global-search__results" role="tabpanel">
              {searchTab === 'users' && searchUsers.map((person) => (
                <button type="button" className="mova-search-result" key={person.id} onClick={() => void openDirectConversation(person)}>
                  <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} status={avatarStatus(person.presence, person.isOnline)} size="lg" />
                  <span><strong><AppleEmoji text={person.name} /></strong><small>{person.handle}</small></span>
                </button>
              ))}
              {searchTab === 'chats' && searchChats.map((conversation) => (
                <button type="button" className="mova-search-result" key={conversation.id} onClick={() => openSearchConversation(conversation.id)}>
                  <ConversationAvatar conversation={conversation} currentUser={currentUser} />
                  <span><strong><AppleEmoji text={conversation.title} /></strong><small>{conversationPreviewText(conversation, currentUser.id)}</small></span>
                </button>
              ))}
              {searchTab === 'links' && searchLinks.map(({ conversation, message, url }, index) => (
                <button type="button" className="mova-search-result is-link" key={`${message.id}-${url}-${index}`} onClick={() => openSearchConversation(conversation.id)}>
                  <i><Link2 size={21} /></i>
                  <span><strong>{url}</strong><small>{conversation.title} · {message.author.name}</small></span>
                </button>
              ))}
              {searchQueryReady && ((searchTab === 'users' && !searchUsers.length) || (searchTab === 'chats' && !searchChats.length) || (searchTab === 'links' && !searchLinks.length)) && (
                <div className="mova-global-search__empty">
                  <Search size={24} />
                  <strong>{searchMessagesLoading && searchTab === 'links' ? 'Ищем ссылки…' : 'Ничего не найдено'}</strong>
                  <span>Попробуйте изменить запрос</span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="mova-real-chat-list">
            {loading ? (
              <ConversationListSkeleton />
            ) : visible.length === 0 ? (
              <div className="mova-real-empty-list">
                <MessageCircle size={25} />
                <strong>{listedConversations.length ? 'Ничего не найдено' : 'Пока тихо'}</strong>
                <p>{listedConversations.length ? 'Попробуйте другой запрос' : 'Создайте личный чат или группу'}</p>
              </div>
            ) : visible.map((conversation) => {
              const typingLabel = conversationTypingLabel(conversation, currentUser.id, typingByConversation[conversation.id] || []);
              const draft = drafts[conversation.id];
              const draftPreview = draft?.text.trim().replace(/\s+/g, ' ');
              const incomingFriendRequest = conversation.kind === 'direct' && conversation.members.some((member) => member.relationship === 'incoming');
              return (
                <button type="button" key={conversation.id} aria-label={sidebarCompact ? conversation.title : undefined} title={sidebarCompact ? conversation.title : undefined} className={selectedId === conversation.id ? 'is-active' : ''} onClick={() => selectConversation(conversation.id)}>
                  <ConversationAvatar conversation={conversation} currentUser={currentUser} />
                  <span><span><strong><AppleEmoji text={conversation.title} /></strong>{incomingFriendRequest && <b className="mova-chat-friend-request-label">Заявка</b>}<time>{draft || conversation.lastMessage ? new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(draft?.updatedAt || conversation.lastMessage!.createdAt)) : ''}</time></span>
                    <small className={typingLabel ? 'mova-typing-status' : draftPreview ? 'mova-chat-draft-preview' : undefined} aria-live="polite">
                      {typingLabel ? <AppleEmoji text={typingLabel} /> : draftPreview ? <><b>Черновик:</b><span><AppleEmoji text={draftPreview} /></span></> : <AppleEmoji text={conversationPreviewText(conversation, currentUser.id)} />}
                    </small>
                    {(conversation.unreadCount || 0) > 0 && <b className="mova-chat-unread-count" aria-label={`Непрочитанных сообщений: ${conversation.unreadCount}`}>{(conversation.unreadCount || 0) > 9 ? '9+' : conversation.unreadCount}</b>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!searchActive && composeMenuOpen && (
          <div className="mova-compose-menu" role="menu" aria-label="Создание разговора">
            <button type="button" role="menuitem" className="is-coming-soon" aria-label="Создать канал — в разработке" aria-disabled="true" disabled>
              <Megaphone size={24} />
              <span><strong>Создать канал</strong><small>В разработке</small></span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setComposeMenuOpen(false); setCreateOpen(true); }}>
              <Users size={24} />
              <span>Создать группу</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openGlobalSearch('users')}>
              <UserRound size={24} />
              <span>Начать личный чат</span>
            </button>
          </div>
        )}
        {!searchActive && (
          <button
            type="button"
            className={`mova-tg-compose${composeMenuOpen ? ' is-open' : ''}`}
            aria-label={composeMenuOpen ? 'Закрыть меню создания' : 'Новый разговор'}
            aria-expanded={composeMenuOpen}
            onClick={() => {
              setAccountOpen(false);
              setComposeMenuOpen((open) => !open);
            }}
          >
            {composeMenuOpen ? <X size={28} /> : <Pencil size={23} />}
          </button>
        )}
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
          unreadCount={selected.unreadCount || 0}
          loading={messagesLoading}
          historyError={messagesErrorFor === selected.id}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          olderHistoryError={olderHistoryError}
          typingUserIds={typingByConversation[selected.id] || []}
          mobileActive={!mobileNavigation || mobileView === 'chat'}
          onMobileBack={mobileNavigation ? navigateToMobileList : undefined}
          onCallOpenChange={handleMobileCallOpenChange}
          onSend={send}
          onRetry={retry}
          onRetryHistory={() => setMessagesLoadAttempt((attempt) => attempt + 1)}
          onLoadOlder={loadOlderMessages}
          onEdit={edit}
          availableConversations={conversations}
          onPinMessage={setMessagePinned}
          onForwardMessage={forwardMessage}
          onOpenForwardSource={openForwardSource}
          onDeleteMessage={deleteMessage}
          availableUsers={users}
          onConversationChange={applyConversationUpdate}
          onOpenDirectConversation={openDirectConversation}
          onStartDirectCall={startDirectCall}
          onRelationshipChange={applyRelationshipUser}
          onMarkRead={(throughMessageId) => markConversationRead(selected.id, throughMessageId)}
          onVoiceListen={(messageId) => markVoiceListened(selected.id, messageId)}
          draftText={drafts[selected.id]?.text || ''}
          onDraftChange={(text) => updateConversationDraft(selected.id, text)}
          focusMessageId={focusedMessage?.conversationId === selected.id ? focusedMessage.messageId : null}
          onFocusMessageHandled={clearFocusedMessage}
          onDeleteConversation={() => void deleteConversation(selected.id)}
        />
      ) : (
        <section className="mova-real-welcome" aria-hidden={mobileNavigation && mobileView === 'list'} inert={mobileNavigation && mobileView === 'list' ? true : undefined}>
          <div>
            <span><img src="/mova-logo.png" alt="" /></span>
            <h1>Mova</h1>
            <p>Выберите разговор или создайте новый</p>
            <Button leadingIcon={<Plus size={17} />} onClick={() => openGlobalSearch('users')}>
              Новый разговор
            </Button>
          </div>
        </section>
      )}
      {voiceDockVisible && voiceConversation && <VoiceDock conversation={voiceConversation} call={voiceSession} onReturn={returnToCall} />}
      <CreateGroup
        open={createOpen}
        users={users}
        onClose={() => setCreateOpen(false)}
        onCreated={(conversation) => {
          setConversations((items) => {
            const nextConversation = conversation.kind === 'direct' && !conversation.lastMessage ? { ...conversation, isDraft: true } : conversation;
            const next = [nextConversation, ...items.filter((item) => item.id !== conversation.id)];
            conversationCache.set(currentUser.id, { value: next, updatedAt: Date.now() });
            return next;
          });
          selectConversation(conversation.id);
        }}
      />
      <SettingsModal user={currentUser} open={settingsOpen} onClose={() => setSettingsOpen(false)} onEditProfile={() => setProfileOpen(true)} onUserUpdate={onUserUpdate} />
      <ProfileEditor user={currentUser} open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={onUserUpdate} />
      <NotificationPermissionDialog
        open={notificationPromptOpen}
        loading={notificationPermissionLoading}
        onLater={() => setNotificationPromptOpen(false)}
        onAllow={() => {
          setNotificationPermissionLoading(true);
          void enableMessageNotifications()
            .then(({ permission, pushActive }) => {
              setNotificationPromptOpen(false);
              if (permission === 'denied') toast.push('Уведомления заблокированы в настройках браузера.', 'info');
              else if (permission === 'granted' && !pushActive) toast.push('Уведомления включены, но фоновые уведомления на этом устройстве недоступны.', 'info');
            })
            .finally(() => setNotificationPermissionLoading(false));
        }}
      />
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
        void unregisterMessageNotifications();
        void clearPersistentUserData(currentUser.id);
        realtime.close();
        clearClientCache();
        session.clear();
        setCurrentUser(null);
      }}
    />
  );
}
