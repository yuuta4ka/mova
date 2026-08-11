import emojiSource from 'emoji-datasource/emoji.json';

export const emojiCategoryIds = [
  'recent',
  'smileys',
  'people',
  'nature',
  'food',
  'activities',
  'travel',
  'objects',
  'symbols',
  'flags',
] as const;

export type EmojiCategoryId = (typeof emojiCategoryIds)[number];

export interface EmojiItem {
  emoji: string;
  name: string;
  shortNames: string[];
  category: Exclude<EmojiCategoryId, 'recent'>;
  search: string;
}

interface EmojiSourceItem {
  name: string;
  unified: string;
  short_name: string;
  short_names: string[];
  category: string;
  sort_order: number;
  has_img_apple: boolean;
  obsoleted_by?: string;
}

export const emojiCategories: ReadonlyArray<{
  id: EmojiCategoryId;
  label: string;
  icon: string;
  source?: string;
}> = [
  { id: 'recent', label: 'Недавние', icon: '🕘' },
  { id: 'smileys', label: 'Смайлы и эмоции', icon: '😀', source: 'Smileys & Emotion' },
  { id: 'people', label: 'Люди', icon: '👋', source: 'People & Body' },
  { id: 'nature', label: 'Животные и природа', icon: '🐻', source: 'Animals & Nature' },
  { id: 'food', label: 'Еда', icon: '🍎', source: 'Food & Drink' },
  { id: 'activities', label: 'Активности', icon: '⚽', source: 'Activities' },
  { id: 'travel', label: 'Путешествия и места', icon: '🚗', source: 'Travel & Places' },
  { id: 'objects', label: 'Объекты', icon: '💡', source: 'Objects' },
  { id: 'symbols', label: 'Символы', icon: '❤️', source: 'Symbols' },
  { id: 'flags', label: 'Флаги', icon: '🏳️', source: 'Flags' },
];

const sourceCategoryToId = new Map(
  emojiCategories.flatMap((category) => (category.source ? [[category.source, category.id as Exclude<EmojiCategoryId, 'recent'>] as const] : [])),
);

export const unicodeFromCodepoints = (value: string) =>
  String.fromCodePoint(...value.split('-').map((codepoint) => Number.parseInt(codepoint, 16)));

const normalizeSearch = (value: string) =>
  value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[_\-:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const emojiItems: EmojiItem[] = (emojiSource as EmojiSourceItem[])
  .filter((item) => item.has_img_apple && !item.obsoleted_by && sourceCategoryToId.has(item.category))
  .sort((left, right) => left.sort_order - right.sort_order)
  .map((item) => {
    const category = sourceCategoryToId.get(item.category)!;
    const shortNames = [...new Set([item.short_name, ...item.short_names])];
    return {
      emoji: unicodeFromCodepoints(item.unified),
      name: item.name.toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()),
      shortNames,
      category,
      search: normalizeSearch(`${item.name} ${shortNames.join(' ')}`),
    };
  });

export const emojiByValue = new Map(emojiItems.map((item) => [item.emoji, item]));
export const emojisByCategory = new Map(
  emojiCategories
    .filter((category): category is typeof category & { id: Exclude<EmojiCategoryId, 'recent'> } => category.id !== 'recent')
    .map((category) => [category.id, emojiItems.filter((item) => item.category === category.id)]),
);

export function searchEmoji(query: string) {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  if (!terms.length) return [];
  return emojiItems.filter((item) => terms.every((term) => item.search.includes(term)));
}
