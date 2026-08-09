export interface AppUser { id: string; name: string; email: string; handle: string; color: string; presence: 'online' | 'idle' | 'dnd' | 'invisible'; dndUntil?: string | null; bio?: string; avatarDataUrl?: string; bannerDataUrl?: string; activity?: { name: string; startedAt: string } | null; lastActiveAt?: string; createdAt: string }
export interface MessageAttachment { name: string; type: string; size: number; dataUrl: string }
export interface MessageReadReceipt { userId: string; readAt: string }
export interface AppMessage { id: string; conversationId: string; authorId: string; content: string; attachment?: MessageAttachment; createdAt: string; sentAt?: string; readBy?: MessageReadReceipt[]; author: AppUser }
export interface AppConversation { id: string; kind: 'direct' | 'group'; title: string; members: AppUser[]; lastMessage: Omit<AppMessage, 'author'> | null; createdAt: string }

const tokenKey = 'mova-session';
export const session = {
  get: () => sessionStorage.getItem(tokenKey),
  set: (token: string) => sessionStorage.setItem(tokenKey, token),
  clear: () => sessionStorage.removeItem(tokenKey),
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = session.get();
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос');
  return result;
}

export const api = {
  register: (data: { name: string; email: string; password: string }) => request<{ token: string; user: AppUser }>('/api/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) => request<{ token: string; user: AppUser }>('/api/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<{ user: AppUser }>('/api/me'),
  updateProfile: (data: Pick<AppUser, 'name' | 'handle' | 'bio' | 'avatarDataUrl' | 'bannerDataUrl' | 'activity'>) => request<{ user: AppUser }>('/api/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  updatePresence: (presence: AppUser['presence'], dndUntil?: string | null) => request<{ user: AppUser }>('/api/presence', { method: 'POST', body: JSON.stringify({ presence, dndUntil }) }),
  users: () => request<{ users: AppUser[] }>('/api/users'),
  conversations: () => request<{ conversations: AppConversation[] }>('/api/conversations'),
  createConversation: (data: { kind: 'direct' | 'group'; title?: string; memberIds: string[] }) => request<{ conversation: AppConversation }>('/api/conversations', { method: 'POST', body: JSON.stringify(data) }),
  messages: (conversationId: string) => request<{ messages: AppMessage[] }>(`/api/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, attachment?: MessageAttachment) => request<{ message: AppMessage }>(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ content, attachment }) }),
  markConversationRead: (conversationId: string, throughMessageId: string) => request<{ conversationId: string; userId: string; messageIds: string[]; readAt: string }>(`/api/conversations/${conversationId}/read`, { method: 'POST', body: JSON.stringify({ throughMessageId }) }),
};

export type RealtimeEvent =
  | { type: 'ready'; user: AppUser }
  | { type: 'message:new'; message: AppMessage }
  | { type: 'message:read'; conversationId: string; userId: string; messageIds: string[]; readAt: string }
  | { type: 'conversation:new'; conversationId: string }
  | { type: 'typing'; conversationId: string; userId: string; active: boolean }
  | { type: 'profile:update' | 'presence:update'; user: AppUser }
  | { type: 'call:invite'; conversationId: string; from: AppUser }
  | { type: 'call:accept' | 'call:decline'; conversationId: string; fromUserId: string }
  | { type: 'call:end'; conversationId: string; fromUserId: string }
  | { type: 'voice:peers'; conversationId: string; peers: string[] }
  | { type: 'voice:joined'; conversationId: string; user: AppUser }
  | { type: 'voice:left'; conversationId: string; userId: string }
  | { type: 'voice:media'; conversationId: string; fromUserId: string; mediaKind: 'camera' | 'screen'; enabled: boolean; streamId?: string }
  | { type: 'voice:state'; conversationId: string; fromUserId: string; muted: boolean; deafened: boolean }
  | { type: 'voice:offer' | 'voice:answer'; conversationId: string; fromUserId: string; targetUserId: string; description: RTCSessionDescriptionInit }
  | { type: 'voice:ice'; conversationId: string; fromUserId: string; targetUserId: string; candidate: RTCIceCandidateInit };

export class RealtimeClient {
  socket: WebSocket | null = null;
  listeners = new Set<(event: RealtimeEvent) => void>();
  connect() {
    const token = session.get(); if (!token || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`); this.socket = socket;
    socket.onmessage = (message) => { const event = JSON.parse(message.data) as RealtimeEvent; this.listeners.forEach((listener) => listener(event)); };
    socket.onclose = () => { if (this.socket === socket) this.socket = null; };
  }
  send(event: object) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event)); }
  subscribe(listener: (event: RealtimeEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close() { const socket = this.socket; this.socket = null; socket?.close(); }
}

export const realtime = new RealtimeClient();
