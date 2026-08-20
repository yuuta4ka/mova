import type { Meta, StoryObj } from '@storybook/react-vite';
import { CreateGroup } from './RealApp';
import type { AppUser } from './lib/api';
import './telegram.css';
import './chat-functional.css';
import './polish.css';
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
