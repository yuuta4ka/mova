import type { MessageAttachment } from './api';

const fileSizeUnits = ['Б', 'КБ', 'МБ', 'ГБ'] as const;

export function formatFileSize(size: number): string {
  const bytes = Math.max(0, Number.isFinite(Number(size)) ? Number(size) : 0);
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < fileSizeUnits.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const maximumFractionDigits = unitIndex === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value)} ${fileSizeUnits[unitIndex]}`;
}

export function attachmentDownloadSource(attachment: MessageAttachment): string {
  const source = attachment.url || attachment.dataUrl || '';
  if (!attachment.url?.startsWith('/uploads/')) return source;
  const separator = source.includes('?') ? '&' : '?';
  return `${source}${separator}download=${encodeURIComponent(attachment.name || 'Файл')}`;
}
