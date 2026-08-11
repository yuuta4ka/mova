import { emojiByValue, type EmojiItem } from '../emojiData';

export const emojiRecentStorageKey = 'mova-emoji-recent-v1';
export const emojiRecentLimit = 36;

export interface RecentEmoji {
  emoji: string;
  count: number;
  lastUsed: number;
}

const isRecentEmoji = (value: unknown): value is RecentEmoji => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentEmoji>;
  return typeof item.emoji === 'string' && emojiByValue.has(item.emoji) && Number.isFinite(item.count) && Number.isFinite(item.lastUsed);
};

export const sortRecentEmoji = (items: RecentEmoji[]) =>
  [...items].sort((left, right) => right.count - left.count || right.lastUsed - left.lastUsed).slice(0, emojiRecentLimit);

export function loadRecentEmoji(): RecentEmoji[] {
  try {
    const stored = window.localStorage.getItem(emojiRecentStorageKey);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? sortRecentEmoji(parsed.filter(isRecentEmoji)) : [];
  } catch {
    return [];
  }
}

export function recordRecentEmoji(value: string, now = Date.now()): RecentEmoji[] {
  const current = loadRecentEmoji();
  const existing = current.find((item) => item.emoji === value);
  const next = sortRecentEmoji([
    ...current.filter((item) => item.emoji !== value),
    { emoji: value, count: (existing?.count || 0) + 1, lastUsed: now },
  ]);
  try {
    window.localStorage.setItem(emojiRecentStorageKey, JSON.stringify(next));
  } catch {
    // Private browsing and full storage should never make emoji insertion fail.
  }
  return next;
}

export const recentEmojiItems = (recent: RecentEmoji[]): EmojiItem[] =>
  recent.flatMap((entry) => {
    const item = emojiByValue.get(entry.emoji);
    return item ? [item] : [];
  });
