import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { emojiCategories, emojisByCategory, searchEmoji, type EmojiCategoryId, type EmojiItem } from '../emojiData';
import { loadRecentEmoji, recentEmojiItems, recordRecentEmoji, type RecentEmoji } from '../lib/emojiRecent';
import { AppleEmoji } from './AppleEmoji';

const emojiColumns = 8;
const emojiRowHeight = 44;
const emojiGridHeight = 278;
const emojiRowOverscan = 2;

function useMobilePicker() {
  const query = '(max-width: 600px)';
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return mobile;
}

function EmojiGrid({ items, onSelect }: { items: EmojiItem[]; onSelect: (item: EmojiItem) => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(items.length / emojiColumns);
  const firstRow = Math.max(0, Math.floor(scrollTop / emojiRowHeight) - emojiRowOverscan);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + emojiGridHeight) / emojiRowHeight) + emojiRowOverscan);
  const visible = items.slice(firstRow * emojiColumns, lastRow * emojiColumns);

  useEffect(() => {
    setScrollTop(0);
    if (grid.current) grid.current.scrollTop = 0;
  }, [items]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -emojiColumns, ArrowDown: emojiColumns };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const nextIndex = Math.min(items.length - 1, Math.max(0, index + offset));
    grid.current?.querySelector<HTMLButtonElement>(`[data-emoji-index="${nextIndex}"]`)?.focus();
    if (nextIndex < firstRow * emojiColumns || nextIndex >= lastRow * emojiColumns) {
      grid.current?.scrollTo({ top: Math.floor(nextIndex / emojiColumns) * emojiRowHeight - emojiRowHeight, behavior: 'auto' });
      window.requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-emoji-index="${nextIndex}"]`)?.focus());
    }
  };

  return (
    <div
      ref={grid}
      className="mova-emoji-grid"
      role="grid"
      aria-label="Эмодзи"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="mova-emoji-grid__space" style={{ height: rowCount * emojiRowHeight }}>
        {visible.map((item, visibleIndex) => {
          const index = firstRow * emojiColumns + visibleIndex;
          const row = Math.floor(index / emojiColumns);
          const column = index % emojiColumns;
          return (
            <button
              key={item.emoji}
              type="button"
              role="gridcell"
              data-emoji-index={index}
              aria-label={item.name}
              title={item.name}
              style={{ '--mova-emoji-row': row, '--mova-emoji-column': column } as React.CSSProperties}
              onKeyDown={(event) => moveFocus(event, index)}
              onClick={() => onSelect(item)}
            >
              <AppleEmoji text={item.emoji} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [category, setCategory] = useState<EmojiCategoryId>('recent');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<RecentEmoji[]>(loadRecentEmoji);
  const searchInput = useRef<HTMLInputElement>(null);
  const mobile = useMobilePicker();
  const results = useMemo(
    () => (query.trim() ? searchEmoji(query) : category === 'recent' ? recentEmojiItems(recent) : emojisByCategory.get(category) || []),
    [category, query, recent],
  );

  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  const select = (item: EmojiItem) => {
    setRecent(recordRecentEmoji(item.emoji));
    onSelect(item.emoji);
  };

  const switchCategory = (next: EmojiCategoryId) => {
    setCategory(next);
    setQuery('');
  };

  return (
    <section className="mova-emoji-picker" role="dialog" aria-label="Выбор эмодзи" data-layout={mobile ? 'sheet' : 'popover'}>
      <header className="mova-emoji-picker__header">
        <label>
          <span className="mova-visually-hidden">Поиск эмодзи</span>
          <Search size={17} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            aria-label="Поиск эмодзи"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск (английские названия)"
          />
          {query && (
            <button type="button" aria-label="Очистить поиск эмодзи" onClick={() => setQuery('')}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>
        <button type="button" className="mova-emoji-picker__close" aria-label="Закрыть выбор эмодзи" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <nav className="mova-emoji-categories" role="tablist" aria-label="Категории эмодзи">
        {emojiCategories.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-label={item.label}
            aria-selected={!query && category === item.id}
            className={!query && category === item.id ? 'is-active' : ''}
            onClick={() => switchCategory(item.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const index = emojiCategories.findIndex((entry) => entry.id === item.id);
              const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + emojiCategories.length) % emojiCategories.length;
              switchCategory(emojiCategories[nextIndex].id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
            }}
          >
            <AppleEmoji text={item.icon} />
          </button>
        ))}
      </nav>
      <div className="mova-emoji-picker__title" aria-live="polite">
        <strong>{query ? 'Результаты поиска' : emojiCategories.find((item) => item.id === category)?.label}</strong>
      </div>
      {results.length ? (
        <EmojiGrid items={results} onSelect={select} />
      ) : (
        <div className="mova-emoji-empty" role="status">
          <span>{query ? 'Ничего не найдено' : 'Здесь появятся часто используемые эмодзи'}</span>
          <small>{query ? 'Попробуйте английское название или часть слова.' : 'История хранится только на этом устройстве.'}</small>
        </div>
      )}
    </section>
  );
}
