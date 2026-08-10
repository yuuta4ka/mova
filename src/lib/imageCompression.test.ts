import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImageFile, fileToDataUrl } from './imageCompression';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image compression', () => {
  it('preserves non-images and small images byte-for-byte', async () => {
    const documentFile = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const smallImage = new File([new Uint8Array(128)], 'small.png', { type: 'image/png' });

    expect(await compressImageFile(documentFile)).toBe(documentFile);
    expect(await compressImageFile(smallImage)).toBe(smallImage);
  });

  it('downscales a large image and exports high-quality WebP', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 6000, height: 3000, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => callback(new Blob([new Uint8Array(50_000)], { type })));
    const source = new File([new Uint8Array(500_000)], 'holiday.jpg', { type: 'image/jpeg' });

    const result = await compressImageFile(source);

    expect(result.type).toBe('image/webp');
    expect(result.name).toBe('holiday.webp');
    expect(result.size).toBeLessThan(source.size);
    expect(close).toHaveBeenCalled();
  });

  it('creates a data URL for upload and previews', async () => {
    expect(await fileToDataUrl(new File(['mova'], 'mova.txt', { type: 'text/plain' }))).toBe('data:text/plain;base64,bW92YQ==');
  });
});
