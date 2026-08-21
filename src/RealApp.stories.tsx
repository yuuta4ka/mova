import type { Meta, StoryObj } from '@storybook/react-vite';
import { CreateGroup, Product } from './RealApp';
import { ToastProvider } from './components/Primitives';
import { api, type AppConversation, type AppMessage, type AppUser } from './lib/api';
import './telegram.css';
import './chat-functional.css';
import './polish.css';
import './composer.css';
import './voice-message.css';
import './common-ui.css';

const friends: AppUser[] = [
  {
    id: 'friend-andrey',
    name: 'Андрей Пишет',
    email: 'andrey@mova.test',
    handle: '@andrey',
    color: '#6a96d8',
    presence: 'online',
    relationship: 'friend',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'friend-anna',
    name: 'Анна Клиент',
    email: 'anna@mova.test',
    handle: '@anna',
    color: '#e9678b',
    presence: 'idle',
    relationship: 'friend',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'friend-anton',
    name: 'Антон',
    email: 'anton@mova.test',
    handle: '@anton',
    color: '#ffad45',
    presence: 'invisible',
    relationship: 'friend',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'not-a-friend',
    name: 'Не в друзьях',
    email: 'stranger@mova.test',
    handle: '@stranger',
    color: '#8a8f99',
    presence: 'online',
    relationship: 'none',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
];

const meta = {
  title: 'Mova/Создание группы',
  parameters: { layout: 'fullscreen' },
  render: () => <CreateGroup open users={friends} onClose={() => undefined} onCreated={() => undefined} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoStepFlow: Story = { name: 'Выбор друзей и данные группы' };

const previewCurrentUser: AppUser = {
  id: 'preview-me',
  name: 'Юта',
  email: 'yuuta@mova.test',
  handle: '@yuuta4ka',
  color: '#74dccb',
  presence: 'online',
  isOnline: true,
  relationship: 'self',
  createdAt: '2026-08-21T18:00:00.000Z',
};

const previewAlex: AppUser = {
  id: 'preview-alex',
  name: 'Алекс',
  email: 'alex@mova.test',
  handle: '@alex',
  color: '#9b83f4',
  presence: 'online',
  isOnline: true,
  relationship: 'friend',
  createdAt: '2026-08-21T18:00:00.000Z',
};

const previewKatya: AppUser = {
  id: 'preview-katya',
  name: 'Катя',
  email: 'katya@mova.test',
  handle: '@katya',
  color: '#e280a8',
  presence: 'idle',
  isOnline: true,
  relationship: 'friend',
  createdAt: '2026-08-21T18:00:00.000Z',
};

const previewMessages: AppMessage[] = [
  {
    id: 'preview-message-1',
    conversationId: 'preview-chat',
    authorId: previewAlex.id,
    author: previewAlex,
    content: 'Созвон сегодня в 19:00?',
    createdAt: '2026-08-21T18:32:00.000Z',
    readBy: [{ userId: previewCurrentUser.id, readAt: '2026-08-21T18:32:30.000Z' }],
  },
  {
    id: 'preview-message-2',
    conversationId: 'preview-chat',
    authorId: previewCurrentUser.id,
    author: previewCurrentUser,
    content: 'Да, буду. Заодно покажу экран.',
    createdAt: '2026-08-21T18:34:00.000Z',
    readBy: [{ userId: previewAlex.id, readAt: '2026-08-21T18:34:20.000Z' }],
  },
  {
    id: 'preview-message-3',
    conversationId: 'preview-chat',
    authorId: previewKatya.id,
    author: previewKatya,
    content: 'Я тоже буду.',
    createdAt: '2026-08-21T18:36:00.000Z',
    readBy: [{ userId: previewCurrentUser.id, readAt: '2026-08-21T18:36:30.000Z' }],
  },
];

const previewLastMessage = ({ author: _author, ...message }: AppMessage) => message;
const previewConversations: AppConversation[] = [
  {
    id: 'preview-chat',
    kind: 'group',
    title: 'Команда Mova',
    members: [previewCurrentUser, previewAlex, previewKatya],
    memberRoles: { [previewCurrentUser.id]: 'owner', [previewAlex.id]: 'admin', [previewKatya.id]: 'member' },
    lastMessage: previewLastMessage(previewMessages.at(-1)!),
    createdAt: '2026-08-21T18:00:00.000Z',
    createdBy: previewCurrentUser.id,
  },
  {
    id: 'preview-direct',
    kind: 'direct',
    title: previewAlex.name,
    members: [previewCurrentUser, previewAlex],
    lastMessage: null,
    createdAt: '2026-08-21T17:00:00.000Z',
  },
];

const configureFullInterfacePreview = () => {
  api.conversations = async () => ({ conversations: previewConversations });
  api.users = async () => ({ users: [previewAlex, previewKatya] });
  api.messages = async (conversationId) => ({ messages: conversationId === 'preview-chat' ? previewMessages : [], hasMore: false, nextCursor: null });
  api.markConversationRead = async (conversationId, throughMessageId) => ({
    conversationId,
    throughMessageId,
    userId: previewCurrentUser.id,
    messageIds: previewMessages.map((message) => message.id),
    readAt: new Date().toISOString(),
  });
  api.updatePresence = async (presence) => ({ user: { ...previewCurrentUser, presence } });
};

export const FullInterface: Story = {
  name: 'Актуальный интерфейс · 1440×900',
  parameters: { layout: 'fullscreen' },
  render: () => {
    configureFullInterfacePreview();
    return <ToastProvider><Product currentUser={previewCurrentUser} onUserUpdate={() => undefined} onLogout={() => undefined} /></ToastProvider>;
  },
};
