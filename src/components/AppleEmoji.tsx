import EmojiConvertor from 'emoji-js';
import { useEffect, useRef } from 'react';

const emoji = new EmojiConvertor();
emoji.img_set = 'apple';
emoji.replace_mode = 'img';
emoji.allow_native = false;
emoji.use_sheet = false;
emoji.include_title = false;
emoji.include_text = false;
emoji.img_sets.apple.path = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export function appleEmojiHtml(text: string) {
  return emoji
    .replace_unified(escapeHtml(text))
    .replace(/<img (?=[^>]*data-codepoints="([^"]+)")/g, (_match, codepoints: string) => {
      const fallback = String.fromCodePoint(...codepoints.split('-').map((value) => Number.parseInt(value, 16)));
      return `<img loading="lazy" decoding="async" alt="${fallback}" `;
    });
}

export function AppleEmoji({ text, className = '' }: { text: string; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const cleanups = [...(root.current?.querySelectorAll<HTMLImageElement>('img.emoji') || [])].map((image) => {
      const fallback = () => {
        const replacement = document.createElement('span');
        replacement.className = 'mova-emoji-fallback';
        replacement.textContent = image.alt || '◻';
        image.replaceWith(replacement);
      };
      image.addEventListener('error', fallback, { once: true });
      return () => image.removeEventListener('error', fallback);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [text]);
  return <span ref={root} className={`mova-apple-text ${className}`.trim()} dangerouslySetInnerHTML={{ __html: appleEmojiHtml(text) }} />;
}

export function isEmojiOnlyText(text: string) {
  const rendered = appleEmojiHtml(text.trim());
  return Boolean(text.trim()) && /<img\b/.test(rendered) && rendered.replace(/<img\b[^>]*\/?\s*>/g, '').trim() === '';
}
