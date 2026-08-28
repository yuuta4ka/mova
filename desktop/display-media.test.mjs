import { describe, expect, it } from 'vitest';
import { desktopDisplayMediaHandlerOptions, desktopDisplayMediaStreams } from './display-media.mjs';

describe('desktop display media', () => {
  const source = { id: 'screen:1:0', name: 'Screen 1' };

  it.each(['darwin', 'win32'])('grants loopback audio on %s when the renderer requests it', (platform) => {
    expect(desktopDisplayMediaStreams(source, true, platform)).toEqual({ video: source, audio: 'loopback' });
  });

  it('does not grant loopback when audio was not requested or cannot safely exclude Mova', () => {
    expect(desktopDisplayMediaStreams(source, false, 'win32')).toEqual({ video: source });
    expect(desktopDisplayMediaStreams(source, true, 'linux')).toEqual({ video: source });
  });

  it('cancels capture when no source was selected', () => {
    expect(desktopDisplayMediaStreams(null, true, 'win32')).toEqual({});
  });

  it('uses the native picker on macOS so CoreAudio capture is actually started', () => {
    expect(desktopDisplayMediaHandlerOptions('darwin')).toEqual({ useSystemPicker: true });
    expect(desktopDisplayMediaHandlerOptions('win32')).toEqual({ useSystemPicker: false });
  });
});
