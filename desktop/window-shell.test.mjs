import { describe, expect, it } from 'vitest';
import { desktopWindowFrameOptions } from './window-shell.mjs';

describe('desktop window frame options', () => {
  it('uses a resizable frameless shell on Windows', () => {
    expect(desktopWindowFrameOptions('win32')).toEqual({ frame: false, thickFrame: true, hasShadow: true, roundedCorners: true });
  });

  it('does not visually change macOS or Linux windows', () => {
    expect(desktopWindowFrameOptions('darwin')).toEqual({});
    expect(desktopWindowFrameOptions('linux')).toEqual({});
  });
});
