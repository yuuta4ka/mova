import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageCircle } from 'lucide-react';
import { App } from '../App';
import { channels, currentUser, messages, spaces, users, voiceState } from '../data';
import { Button } from './Primitives';
import { ChannelHeader, ChannelSidebar, EmptyState, MemberList, MessageComposer, MessageItem, ProfileCard, SpaceRail, VoicePanel } from './Product';

const meta = { title: 'Mova/Продуктовые компоненты', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SpaceRailStory: Story = { name: 'Список пространств', parameters: { layout: 'fullscreen' }, render: () => <div style={{ width: 76, height: 700 }}><SpaceRail spaces={spaces} /></div> };
export const ChannelSidebarStory: Story = { name: 'Дерево каналов', parameters: { layout: 'fullscreen' }, render: () => <div style={{ width: 270, height: 760 }}><ChannelSidebar channels={channels} currentUser={currentUser} voice={voiceState} /></div> };
export const ChannelHeaderStory: Story = { name: 'Шапка канала', parameters: { layout: 'fullscreen' }, render: () => <ChannelHeader name="общий" topic="Говорим обо всём и остаёмся на связи" /> };
export const MessageStory: Story = { name: 'Сообщение и реакции', render: () => <div style={{ width: 720 }}><MessageItem message={messages[0]} /><MessageItem message={{ ...messages[1], attachment: { name: 'места-для-встречи.pdf', size: '2,4 МБ' } }} /><MessageItem message={messages[2]} /></div> };
export const ComposerStory: Story = { name: 'Редактор сообщения', render: () => <div style={{ width: 720 }}><MessageComposer channel="общий" /></div> };
export const MembersStory: Story = { name: 'Список участников', parameters: { layout: 'fullscreen' }, render: () => <div style={{ width: 240, height: 700 }}><MemberList users={[currentUser, ...users]} /></div> };
export const ProfileStory: Story = { name: 'Карточка профиля', render: () => <ProfileCard user={users[0]} /> };
export const VoiceStory: Story = { name: 'Голосовая панель', render: () => <div style={{ width: 270 }}><VoicePanel state={voiceState} /></div> };
export const EmptyStory: Story = { name: 'Пустое состояние', render: () => <EmptyState icon={<MessageCircle size={38} />} title="Здесь пока тихо" description="Начните разговор — первое сообщение всегда немного особенное." action={<Button>Написать сообщение</Button>} /> };

export const FullChatScreen: Story = { name: 'Эталонный экран · 1440×900', parameters: { layout: 'fullscreen' }, render: () => <div style={{ width: '100vw', height: '100vh' }}><App /></div> };
