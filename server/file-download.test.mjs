import { describe, expect, it } from 'vitest';
import { contentDisposition } from './file-download.mjs';

describe('file download headers', () => {
  it('preserves a Unicode file name and provides an ASCII fallback', () => {
    expect(contentDisposition('attachment', 'Договор № 7.pdf')).toBe(
      'attachment; filename="No 7.pdf"; filename*=UTF-8\'\'%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%20%E2%84%96%207.pdf',
    );
  });

  it('removes path and header control characters', () => {
    const header = contentDisposition('attachment', '../unsafe\r\nname.txt');
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header).not.toContain('../');
  });
});
