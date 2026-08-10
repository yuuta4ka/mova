import EmojiConvertor from 'emoji-js';

const emoji = new EmojiConvertor();
emoji.img_set = 'apple';
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
    .replace(/<img /g, '<img loading="lazy" decoding="async" ');
}

export function AppleEmoji({ text, className = '' }: { text: string; className?: string }) {
  return <span className={`mova-apple-text ${className}`.trim()} dangerouslySetInnerHTML={{ __html: appleEmojiHtml(text) }} />;
}
