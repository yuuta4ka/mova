export interface AppUser {
  id: string;
  name: string;
  email: string;
  handle: string;
  color: string;
  presence: 'online' | 'idle' | 'dnd' | 'invisible';
  isOnline?: boolean;
  dndUntil?: string | null;
  bio?: string;
  avatarDataUrl?: string;
  bannerDataUrl?: string;
  activity?: { type?: 'game'; name: string; startedAt: string } | null;
  lastActiveAt?: string;
  emailVerifiedAt?: string;
  createdAt: string;
  relationship?: 'self' | 'none' | 'outgoing' | 'incoming' | 'friend' | 'blocked' | 'blocked_by';
}
export interface MessageAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  url?: string;
  durationMs?: number;
  waveform?: number[];
}
export interface MessageReadReceipt {
  userId: string;
  readAt: string;
}
export interface VoiceListenReceipt {
  userId: string;
  listenedAt: string;
}
export interface MessageReply {
  id: string;
  authorId: string;
  content: string;
  attachmentName?: string;
  attachment?: MessageAttachment;
  author: AppUser;
}
export interface AppMessage {
  id: string;
  conversationId: string;
  authorId: string;
  content: string;
  attachment?: MessageAttachment;
  replyToId?: string;
  replyTo?: MessageReply;
  createdAt: string;
  sentAt?: string;
  editedAt?: string;
  readBy?: MessageReadReceipt[];
  listenedBy?: VoiceListenReceipt[];
  clientId?: string;
  deliveryState?: 'queued' | 'sending' | 'failed';
  kind?: 'user' | 'call' | 'friend_request';
  call?: {
    status: 'completed';
    durationSeconds: number;
    startedAt: string;
    endedAt: string;
  };
  friendRequest?: {
    requestedBy: string;
    status: 'pending' | 'accepted' | 'declined' | 'cancelled';
    respondedAt?: string;
  };
  author: AppUser;
}
export interface AppConversation {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  avatarDataUrl?: string;
  members: AppUser[];
  lastMessage: Omit<AppMessage, 'author'> | null;
  unreadCount?: number;
  createdAt: string;
  createdBy?: string;
  isDraft?: boolean;
}
export interface RtcConfig {
  iceServers: RTCIceServer[];
}
export interface PushConfig {
  publicKey: string;
}
export interface VoiceRoomParticipant {
  userId: string;
  connectionState: 'connected' | 'reconnecting';
  muted: boolean;
  deafened: boolean;
  media: {
    camera?: string;
    screen?: string;
  };
}
export interface MaintenanceState {
  active: boolean;
  deploymentId?: string;
  previousInstanceId?: string;
  startedAt?: string;
}

export interface EmailChallenge {
  challengeId: string;
  email: string;
  expiresAt: string;
  resendAfterSeconds: number;
  message?: string;
}

const tokenKey = 'mova-session';
const persistentAppSession = () =>
  navigator.userAgent.includes('MovaDesktop/')
  || Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
  || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const sessionStore = () => (persistentAppSession() ? localStorage : sessionStorage);
export const session = {
  get: () => {
    const store = sessionStore();
    const token = store.getItem(tokenKey);
    if (token || store === sessionStorage) return token;
    const previousSession = sessionStorage.getItem(tokenKey);
    if (previousSession) {
      store.setItem(tokenKey, previousSession);
      sessionStorage.removeItem(tokenKey);
    }
    return previousSession;
  },
  set: (token: string) => sessionStore().setItem(tokenKey, token),
  clear: () => {
    localStorage.removeItem(tokenKey);
    sessionStorage.removeItem(tokenKey);
  },
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = session.get();
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос');
  return result;
}

async function uploadAttachment(attachment: MessageAttachment): Promise<MessageAttachment> {
  if (attachment.url) return attachment;
  if (!attachment.dataUrl) throw new Error('Не удалось подготовить файл');
  const token = session.get();
  const contents = await fetch(attachment.dataUrl).then((response) => response.blob());
  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: {
      'content-type': attachment.type || contents.type || 'application/octet-stream',
      'x-mova-file-name': encodeURIComponent(attachment.name),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: contents,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Не удалось загрузить файл');
  return {
    ...result.attachment,
    ...(attachment.durationMs ? { durationMs: attachment.durationMs } : {}),
    ...(attachment.waveform?.length ? { waveform: attachment.waveform } : {}),
  };
}

export const api = {
  register: (data: { name: string; email: string; password: string }) =>
    request<EmailChallenge>('/api/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  verifyRegistration: (challengeId: string, code: string) =>
    request<{ token: string; user: AppUser }>('/api/register/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code }),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: AppUser }>('/api/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  requestPasswordReset: (email: string) =>
    request<EmailChallenge>('/api/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  confirmPasswordReset: (challengeId: string, code: string, password: string) =>
    request<{ ok: true }>('/api/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code, password }),
    }),
  requestEmailChange: (email: string, password: string) =>
    request<EmailChallenge>('/api/email-change/request', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  confirmEmailChange: (challengeId: string, code: string) =>
    request<{ token: string; user: AppUser }>('/api/email-change/confirm', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code }),
    }),
  me: () => request<{ user: AppUser }>('/api/me'),
  maintenance: (signal?: AbortSignal) => request<MaintenanceState>('/api/maintenance', { signal }),
  updateProfile: (data: Pick<AppUser, 'name' | 'handle' | 'bio' | 'avatarDataUrl' | 'bannerDataUrl' | 'activity'>) =>
    request<{ user: AppUser }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updatePresence: (presence: AppUser['presence'], dndUntil?: string | null) =>
    request<{ user: AppUser }>('/api/presence', {
      method: 'POST',
      body: JSON.stringify({ presence, dndUntil }),
    }),
  updateActivity: (name: string | null) =>
    request<{ user: AppUser }>('/api/activity', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  users: () => request<{ users: AppUser[] }>('/api/users'),
  requestFriend: (userId: string) => request<{ user: AppUser }>(`/api/friends/${userId}`, { method: 'POST' }),
  acceptFriend: (userId: string) => request<{ user: AppUser }>(`/api/friends/${userId}`, { method: 'PATCH' }),
  rejectFriend: (userId: string) => request<{ user: AppUser }>(`/api/friends/${userId}/reject`, { method: 'POST' }),
  removeFriend: (userId: string) => request<{ user: AppUser }>(`/api/friends/${userId}`, { method: 'DELETE' }),
  blockUser: (userId: string) => request<{ user: AppUser }>(`/api/blocks/${userId}`, { method: 'POST' }),
  unblockUser: (userId: string) => request<{ user: AppUser }>(`/api/blocks/${userId}`, { method: 'DELETE' }),
  conversations: () => request<{ conversations: AppConversation[] }>('/api/conversations'),
  createConversation: (data: { kind: 'direct' | 'group'; title?: string; memberIds: string[]; avatarDataUrl?: string }) =>
    request<{ conversation: AppConversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteConversation: (conversationId: string) => request<{ conversationId: string }>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
  messages: (conversationId: string, options: { before?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (options.before) search.set('before', options.before);
    if (options.limit) search.set('limit', String(options.limit));
    const query = search.size ? `?${search}` : '';
    return request<{ messages: AppMessage[]; hasMore?: boolean; nextCursor?: string | null }>(`/api/conversations/${conversationId}/messages${query}`);
  },
  sendMessage: async (conversationId: string, content: string, attachment?: MessageAttachment, replyToId?: string, clientId?: string, onAttachmentUploaded?: (attachment: MessageAttachment) => void | Promise<void>) => {
    const uploadedAttachment = attachment ? await uploadAttachment(attachment) : undefined;
    if (uploadedAttachment && uploadedAttachment !== attachment) await onAttachmentUploaded?.(uploadedAttachment);
    return request<{ message: AppMessage }>(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachment: uploadedAttachment, replyToId, clientId }),
    });
  },
  editMessage: (conversationId: string, messageId: string, content: string) => request<{ message: AppMessage }>(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ content }) }),
  markConversationRead: (conversationId: string, throughMessageId: string) =>
    request<{
      conversationId: string;
      userId: string;
      messageIds: string[];
      readAt: string;
    }>(`/api/conversations/${conversationId}/read`, {
      method: 'POST',
      body: JSON.stringify({ throughMessageId }),
    }),
  markVoiceListened: (conversationId: string, messageId: string) =>
    request<{
      conversationId: string;
      messageId: string;
      userId: string;
      listenedAt: string;
    }>(`/api/conversations/${conversationId}/messages/${messageId}/listened`, { method: 'POST' }),
  rtcConfig: () => request<RtcConfig>('/api/rtc-config'),
  pushConfig: () => request<PushConfig>('/api/push-config'),
  savePushSubscription: (subscription: PushSubscriptionJSON) => request<{ ok: true }>('/api/push-subscriptions', { method: 'POST', body: JSON.stringify(subscription) }),
  deletePushSubscription: (endpoint: string) => request<{ ok: true }>('/api/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
};

export type RealtimeEvent =
  | { type: 'ready'; user: AppUser }
  | { type: 'realtime:disconnected' }
  | { type: 'heartbeat:ack'; sentAt: number }
  | { type: 'message:new'; message: AppMessage }
  | { type: 'message:update'; message: AppMessage }
  | {
      type: 'message:read';
      conversationId: string;
      userId: string;
      messageIds: string[];
      readAt: string;
    }
  | {
      type: 'message:voice-listened';
      conversationId: string;
      messageId: string;
      userId: string;
      listenedAt: string;
    }
  | { type: 'conversation:new'; conversationId: string }
  | { type: 'conversation:delete'; conversationId: string }
  | { type: 'typing'; conversationId: string; userId: string; active: boolean }
  | { type: 'profile:update' | 'presence:update'; user: AppUser }
  | { type: 'relationship:update'; user: AppUser }
  | { type: 'call:invite'; conversationId: string; from: AppUser; createdAt: string }
  | {
      type: 'call:accept';
      conversationId: string;
      fromUserId: string;
      startedAt: string;
    }
  | { type: 'call:decline'; conversationId: string; fromUserId: string }
  | { type: 'call:end'; conversationId: string; fromUserId: string }
  | {
      type: 'call:state';
      conversationId: string;
      status: 'idle' | 'ringing' | 'active';
      from?: AppUser;
      createdAt?: string;
      startedAt?: string;
      participants: string[];
      room?: VoiceRoomParticipant[];
      joined: boolean;
    }
  | { type: 'voice:snapshot'; conversationId: string; participants: VoiceRoomParticipant[] }
  | { type: 'voice:peers'; conversationId: string; peers: string[] }
  | { type: 'voice:joined'; conversationId: string; user: AppUser }
  | { type: 'voice:left'; conversationId: string; userId: string }
  | {
      type: 'voice:media';
      conversationId: string;
      fromUserId: string;
      mediaKind: 'camera' | 'screen';
      enabled: boolean;
      streamId?: string;
    }
  | {
      type: 'voice:state';
      conversationId: string;
      fromUserId: string;
      muted: boolean;
      deafened: boolean;
    }
  | {
      type: 'voice:offer' | 'voice:answer';
      conversationId: string;
      fromUserId: string;
      targetUserId: string;
      description: RTCSessionDescriptionInit;
    }
  | {
      type: 'voice:ice';
      conversationId: string;
      fromUserId: string;
      targetUserId: string;
      candidate: RTCIceCandidateInit;
    };

export class RealtimeClient {
  socket: WebSocket | null = null;
  listeners = new Set<(event: RealtimeEvent) => void>();
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private pending: string[] = [];
  private heartbeatTimer: number | null = null;
  private lastHeartbeatAck = 0;
  private wakeListenersAttached = false;
  private readonly wake = () => {
    if (this.closedByUser || !session.get()) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'heartbeat', sentAt: Date.now() }));
    else this.connect();
  };
  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
  private startHeartbeat(socket: WebSocket) {
    this.stopHeartbeat();
    this.lastHeartbeatAck = Date.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastHeartbeatAck > 45_000) return socket.close(4000, 'Heartbeat timeout');
      socket.send(JSON.stringify({ type: 'heartbeat', sentAt: Date.now() }));
    }, 15_000);
  }
  connect() {
    const token = session.get();
    if (!token || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.closedByUser = false;
    if (!this.wakeListenersAttached) {
      window.addEventListener('online', this.wake);
      document.addEventListener('visibilitychange', this.wake);
      this.wakeListenersAttached = true;
    }
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      this.startHeartbeat(socket);
      const pending = this.pending.splice(0);
      pending.forEach((message) => socket.send(message));
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RealtimeEvent;
        if (event.type === 'heartbeat:ack') {
          this.lastHeartbeatAck = Date.now();
          return;
        }
        this.listeners.forEach((listener) => listener(event));
      } catch {}
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.stopHeartbeat();
      this.socket = null;
      this.listeners.forEach((listener) => listener({ type: 'realtime:disconnected' }));
      if (this.closedByUser || !session.get()) return;
      const delay = Math.min(8_000, 500 * 2 ** this.reconnectAttempts++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }
  send(event: object) {
    const message = JSON.stringify(event);
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket.send(message);
    this.pending.push(message);
    if (this.pending.length > 200) this.pending.splice(0, this.pending.length - 200);
    this.connect();
  }
  subscribe(listener: (event: RealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  close() {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.pending = [];
    this.stopHeartbeat();
    if (this.wakeListenersAttached) {
      window.removeEventListener('online', this.wake);
      document.removeEventListener('visibilitychange', this.wake);
      this.wakeListenersAttached = false;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}

export const realtime = new RealtimeClient();
