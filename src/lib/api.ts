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
  activity?: { name: string; startedAt: string } | null;
  lastActiveAt?: string;
  createdAt: string;
}
export interface MessageAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  url?: string;
}
export interface MessageReadReceipt {
  userId: string;
  readAt: string;
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
  clientId?: string;
  deliveryState?: 'sending' | 'failed';
  kind?: 'user' | 'call';
  call?: {
    status: 'completed';
    durationSeconds: number;
    startedAt: string;
    endedAt: string;
  };
  author: AppUser;
}
export interface AppConversation {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  members: AppUser[];
  lastMessage: Omit<AppMessage, 'author'> | null;
  createdAt: string;
}
export interface RtcConfig {
  iceServers: RTCIceServer[];
}
export interface MaintenanceState {
  active: boolean;
  deploymentId?: string;
  previousInstanceId?: string;
  startedAt?: string;
}

const tokenKey = 'mova-session';
const sessionStore = () => (navigator.userAgent.includes('MovaDesktop/') ? localStorage : sessionStorage);
export const session = {
  get: () => sessionStore().getItem(tokenKey),
  set: (token: string) => sessionStore().setItem(tokenKey, token),
  clear: () => sessionStore().removeItem(tokenKey),
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
  return result.attachment;
}

export const api = {
  register: (data: { name: string; email: string; password: string }) =>
    request<{ token: string; user: AppUser }>('/api/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: AppUser }>('/api/login', {
      method: 'POST',
      body: JSON.stringify(data),
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
  users: () => request<{ users: AppUser[] }>('/api/users'),
  conversations: () => request<{ conversations: AppConversation[] }>('/api/conversations'),
  createConversation: (data: { kind: 'direct' | 'group'; title?: string; memberIds: string[] }) =>
    request<{ conversation: AppConversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  messages: (conversationId: string) => request<{ messages: AppMessage[] }>(`/api/conversations/${conversationId}/messages`),
  sendMessage: async (conversationId: string, content: string, attachment?: MessageAttachment, replyToId?: string, clientId?: string, onAttachmentUploaded?: (attachment: MessageAttachment) => void) => {
    const uploadedAttachment = attachment ? await uploadAttachment(attachment) : undefined;
    if (uploadedAttachment && uploadedAttachment !== attachment) onAttachmentUploaded?.(uploadedAttachment);
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
  rtcConfig: () => request<RtcConfig>('/api/rtc-config'),
};

export type RealtimeEvent =
  | { type: 'ready'; user: AppUser }
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
  | { type: 'conversation:new'; conversationId: string }
  | { type: 'typing'; conversationId: string; userId: string; active: boolean }
  | { type: 'profile:update' | 'presence:update'; user: AppUser }
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
      joined: boolean;
    }
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
