import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImageToClipboard } from './imageClipboard';

afterEach(() => {
  delete window.movaDesktopShell;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image clipboard', () => {
  it('uses the native desktop bridge for image data', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const writeClipboardImage = vi.fn().mockResolvedValue(true);
    window.movaDesktopShell = {
      platform: 'darwin',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      writeClipboardImage,
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => vi.fn()),
    };

    await copyImageToClipboard(dataUrl);

    expect(writeClipboardImage).toHaveBeenCalledWith(dataUrl);
  });

  it('converts WebP images to PNG before using the native desktop bridge', async () => {
    const writeClipboardImage = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    const drawImage = vi.fn();
    window.movaDesktopShell = {
      platform: 'win32',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      writeClipboardImage,
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => vi.fn()),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['webp']), { headers: { 'content-type': 'image/webp' } })));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 1, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));

    await copyImageToClipboard('/uploads/photo.webp');

    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(writeClipboardImage).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
  });

  it('reports when the native desktop clipboard rejects the image', async () => {
    window.movaDesktopShell = {
      platform: 'win32',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      writeClipboardImage: vi.fn().mockResolvedValue(false),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => vi.fn()),
    };

    await expect(copyImageToClipboard('data:image/png;base64,iVBORw0KGgo=')).rejects.toThrow('Системный буфер обмена');
  });

  it('writes PNG image data through the browser clipboard API', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class ClipboardItemMock {
      constructor(public readonly data: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemMock);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });

    await copyImageToClipboard('data:image/png;base64,iVBORw0KGgo=');

    expect(write).toHaveBeenCalledOnce();
    const item = write.mock.calls[0][0][0] as ClipboardItemMock;
    const image = await item.data['image/png'];
    expect(image).toBeInstanceOf(Blob);
    expect(image.type).toBe('image/png');
  });
});
