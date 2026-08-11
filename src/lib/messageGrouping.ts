import type { AppMessage } from './api';

const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

const localDayKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isSameLocalDay = (first: string | Date, second: string | Date) => localDayKey(first) === localDayKey(second);

export const canGroupMessages = (first?: AppMessage, second?: AppMessage) => {
  if (!first || !second || first.kind === 'call' || second.kind === 'call' || first.authorId !== second.authorId || !isSameLocalDay(first.createdAt, second.createdAt)) return false;
  const interval = new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
  return interval >= 0 && interval <= MESSAGE_GROUP_WINDOW_MS;
};

export const formatMessageDay = (value: string | Date, now: Date = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const targetDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const difference = Math.round((currentDay - targetDay) / 86_400_000);
  if (difference === 0) return 'Сегодня';
  if (difference === 1) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
};

export interface MessageStructure {
  startsDay: boolean;
  dayKey: string;
  dayLabel: string;
  startsGroup: boolean;
  endsGroup: boolean;
}

export const getMessageStructure = (messages: AppMessage[], now: Date = new Date()): MessageStructure[] =>
  messages.map((message, index) => ({
    startsDay: index === 0 || !isSameLocalDay(messages[index - 1].createdAt, message.createdAt),
    dayKey: localDayKey(message.createdAt),
    dayLabel: formatMessageDay(message.createdAt, now),
    startsGroup: !canGroupMessages(messages[index - 1], message),
    endsGroup: !canGroupMessages(message, messages[index + 1]),
  }));
