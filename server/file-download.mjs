import { extname } from 'node:path';

function cleanFileName(value) {
  return String(value || '')
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f"]/g, '_')
    .trim()
    .slice(0, 180) || 'Файл';
}

function asciiFallback(fileName) {
  const extension = /^\.[a-z0-9]{1,8}$/i.test(extname(fileName)) ? extname(fileName) : '';
  const candidate = fileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\%;]/g, '_')
    .trim();
  return !candidate || candidate.startsWith('.') ? `download${extension}` : candidate;
}

function rfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function contentDisposition(disposition, value) {
  const fileName = cleanFileName(value);
  return `${disposition}; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${rfc5987(fileName)}`;
}
