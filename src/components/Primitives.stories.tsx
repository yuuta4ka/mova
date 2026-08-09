import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Plus, Sparkles } from 'lucide-react';
import { Avatar, Badge, Button, Divider, Dropdown, IconButton, Input, Modal, SearchField, Tabs, Textarea, ToastProvider, Tooltip, useToast } from './Primitives';

const meta = { title: 'Mova/Примитивы', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = { render: () => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}><Button>Продолжить</Button><Button variant="secondary" leadingIcon={<Sparkles size={17} />}>Создать пространство</Button><Button variant="ghost">Отмена</Button><Button variant="danger">Удалить</Button><Button loading>Сохраняем</Button><Button disabled>Недоступно</Button><Tooltip label="Уведомления"><IconButton label="Уведомления"><Bell size={18} /></IconButton></Tooltip></div> };

export const Fields: Story = { render: () => <div style={{ display: 'grid', width: 420, gap: 16 }}><Input label="Название пространства" placeholder="Например, Северный клуб" hint="Название можно изменить позже" /><SearchField placeholder="Найти канал или участника" /><Input label="Публичная ссылка" defaultValue="mova.app/sever" error="Эта ссылка уже занята" /><Textarea label="Описание" placeholder="Расскажите, о чём ваше пространство" hint="Не более 240 символов" /></div> };

export const AvatarsAndBadges: Story = { render: () => <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Avatar name="Юта" color="#5DE2D3" size="xs" status="online" /><Avatar name="Лера Северова" color="#9D7BFF" size="sm" status="idle" /><Avatar name="Макс Волков" color="#FF8D72" size="md" status="busy" speaking /><Avatar name="Аня Тихая" color="#F7C96B" size="lg" status="offline" /><Badge>12</Badge><Badge tone="mint">в сети</Badge><Badge tone="violet">новое</Badge><Badge tone="danger">3</Badge></div> };

export const TabsStory: Story = { name: 'Tabs', render: function Render() { const [tab, setTab] = useState('all'); return <Tabs value={tab} onChange={setTab} items={[{ id: 'all', label: 'Все' }, { id: 'online', label: 'В сети', count: 8 }, { id: 'pending', label: 'Запросы', count: 2 }]} />; } };

export const DropdownStory: Story = { name: 'Dropdown', render: () => <Dropdown label="Настройки пространства" items={[{ id: 'invite', label: 'Пригласить людей' }, { id: 'settings', label: 'Настройки' }, { id: 'leave', label: 'Покинуть пространство', destructive: true }]} /> };

export const ModalStory: Story = { name: 'Modal', render: function Render() { const [open, setOpen] = useState(false); return <><Button onClick={() => setOpen(true)} leadingIcon={<Plus size={17} />}>Новый канал</Button><Modal open={open} title="Создать канал" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => setOpen(false)}>Создать</Button></>}><Input label="Название" placeholder="новый-канал" /></Modal></>; } };

function ToastDemo() { const toast = useToast(); return <div style={{ display: 'flex', gap: 10 }}><Button onClick={() => toast.push('Приглашение скопировано', 'success')}>Показать уведомление</Button><Button variant="danger" onClick={() => toast.push('Не удалось сохранить изменения', 'danger')}>Показать ошибку</Button></div>; }
export const ToastStory: Story = { name: 'Toast', render: () => <ToastProvider><ToastDemo /></ToastProvider> };

export const DividerStory: Story = { name: 'Divider & Tooltip', render: () => <div style={{ width: 420, display: 'grid', gap: 25 }}><Divider label="Сегодня" /><Tooltip label="Добавить"><IconButton label="Добавить"><Plus /></IconButton></Tooltip></div> };
