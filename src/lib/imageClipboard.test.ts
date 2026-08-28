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
