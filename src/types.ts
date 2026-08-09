export type Presence = 'online' | 'idle' | 'busy' | 'offline';

export interface User {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  color?: string;
  presence: Presence;
  activity?: string;
  role?: string;
}

export interface Space {
  id: string;
  name: string;
  initials: string;
  color?: string;
  unread?: number;
  active?: boolean;
}

export type ChannelKind = 'text' | 'voice';

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  category: string;
  unread?: boolean;
  mentions?: number;
  active?: boolean;
  muted?: boolean;
  locked?: boolean;
  participants?: User[];
}

export interface Reaction {
  emoji: string;
  count: number;
  reacted?: boolean;
}

export interface Message {
  id: string;
  author: User;
  content: string;
  time: string;
  reactions?: Reaction[];
  edited?: boolean;
  grouped?: boolean;
  attachment?: { name: string; size: string };
}

export interface VoiceState {
  channelName: string;
  connected: boolean;
  muted: boolean;
  deafened: boolean;
  quality: 'good' | 'fair' | 'poor';
}
