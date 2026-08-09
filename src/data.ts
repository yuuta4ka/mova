import type { Channel, Message, Space, User, VoiceState } from './types';

export const currentUser: User = { id: 'u0', name: 'Юта', handle: '@yuuta', presence: 'online', color: '#5DE2D3', role: 'Создатель' };

export const users: User[] = [
  { id: 'u1', name: 'Лера Северова', handle: '@lera', presence: 'online', color: '#9D7BFF', activity: 'Слушает lo-fi', role: 'Модератор' },
  { id: 'u2', name: 'Макс Волков', handle: '@max', presence: 'online', color: '#FF8D72', activity: 'В голосовом канале', role: 'Модератор' },
  { id: 'u3', name: 'Аня Тихая', handle: '@anya', presence: 'idle', color: '#F7C96B', activity: 'Отошла на минутку', role: 'Участник' },
  { id: 'u4', name: 'Дима Орлов', handle: '@dima', presence: 'busy', color: '#61D7A4', role: 'Участник' },
  { id: 'u5', name: 'Саша Мир', handle: '@sasha', presence: 'offline', color: '#6E7DFF', role: 'Участник' },
];

export const spaces: Space[] = [
  { id: 'home', name: 'Главная', initials: 'M', color: '#5DE2D3' },
  { id: 'north', name: 'Северный клуб', initials: 'СК', color: '#9D7BFF', active: true },
  { id: 'games', name: 'Игровая', initials: 'И', color: '#FF8D72', unread: 3 },
  { id: 'study', name: 'Вместе учимся', initials: 'ВУ', color: '#F7C96B' },
  { id: 'music', name: 'Музыка внутри', initials: 'МВ', color: '#61D7A4', unread: 12 },
];

export const channels: Channel[] = [
  { id: 'welcome', name: 'добро-пожаловать', kind: 'text', category: 'ИНФОРМАЦИЯ', muted: true },
  { id: 'news', name: 'новости-клуба', kind: 'text', category: 'ИНФОРМАЦИЯ', unread: true },
  { id: 'general', name: 'общий', kind: 'text', category: 'ОБЩЕНИЕ', active: true },
  { id: 'ideas', name: 'идеи-и-планы', kind: 'text', category: 'ОБЩЕНИЕ', mentions: 2 },
  { id: 'photos', name: 'красивые-кадры', kind: 'text', category: 'ОБЩЕНИЕ' },
  { id: 'chill', name: 'У костра', kind: 'voice', category: 'ГОЛОСОВЫЕ', participants: [users[0], users[1]] },
  { id: 'focus', name: 'Тихий уголок', kind: 'voice', category: 'ГОЛОСОВЫЕ', participants: [users[2]] },
];

export const messages: Message[] = [
  { id: 'm1', author: users[0], time: 'Сегодня, 18:42', content: 'Всем привет! Собираемся сегодня вечером в голосовом? Хочется обсудить идеи для нашей осенней встречи ✨', reactions: [{ emoji: '👋', count: 4 }, { emoji: '✨', count: 2, reacted: true }] },
  { id: 'm2', author: users[1], time: '18:44', content: 'Я буду! Заодно принесу подборку мест, которую обещал. Там есть один очень уютный вариант у озера.', reactions: [{ emoji: '🔥', count: 3 }] },
  { id: 'm3', author: users[1], time: '18:45', content: 'Зайду в «У костра» примерно через полчаса.', grouped: true },
  { id: 'm4', author: users[2], time: '18:51', content: 'Звучит идеально. Я немного опоздаю, но обязательно подключусь. Скиньте потом основные мысли сюда?', reactions: [{ emoji: '💜', count: 5, reacted: true }] },
  { id: 'm5', author: currentUser, time: '18:53', content: 'Конечно! Я соберу всё важное в короткий список и закреплю в канале.', reactions: [{ emoji: '🙌', count: 2 }] },
];

export const voiceState: VoiceState = { channelName: 'У костра', connected: true, muted: false, deafened: false, quality: 'good' };
