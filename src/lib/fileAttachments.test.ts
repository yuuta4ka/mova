import { describe, expect, it } from 'vitest';
import { attachmentDownloadSource, formatFileSize } from './fileAttachments';

describe('file attachments', () => {
  it('formats the actual byte count using readable decimal units', () => {
    expect(formatFileSize(0)).toBe('0 Б');
    expect(formatFileSize(999)).toBe('999 Б');
    expect(formatFileSize(1_500)).toBe('1,5 КБ');
    expect(formatFileSize(2_750_000)).toBe('2,75 МБ');
  });

  it('passes the original Unicode name when downloading a stored upload', () => {
    expect(attachmentDownloadSource({
      name: 'Договор № 7.pdf',
      type: 'application/pdf',
      size: 10,
      url: '/uploads/random-name.pdf',
    })).toBe('/uploads/random-name.pdf?download=%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%20%E2%84%96%207.pdf');
  });

  it('leaves local previews unchanged', () => {
    const dataUrl = 'data:text/plain;base64,dGVzdA==';
    expect(attachmentDownloadSource({ name: 'test.txt', type: 'text/plain', size: 4, dataUrl })).toBe(dataUrl);
  });
});
