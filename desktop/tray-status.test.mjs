import { describe, expect, it } from 'vitest';
import { desktopCallStatusLabel, desktopStatusColor, desktopStatusSvg, resolveDesktopCallStatus, shouldKeepDesktopWindowOpen } from './tray-status.mjs';

describe('desktop tray call status', () => {
  it('uses the most important active call state', () => {
    expect(resolveDesktopCallStatus()).toBe('idle');
    expect(resolveDesktopCallStatus({ active: true })).toBe('silent');
    expect(resolveDesktopCallStatus({ active: true, speaking: true })).toBe('speaking');
    expect(resolveDesktopCallStatus({ active: true, speaking: true, muted: true })).toBe('mic-off');
    expect(resolveDesktopCallStatus({ active: true, speaking: true, muted: true, deafened: true })).toBe('headphones-off');
  });

  it('renders the requested accent in each status image', () => {
    for (const status of ['idle', 'silent', 'speaking', 'mic-off', 'headphones-off']) {
      expect(desktopStatusSvg(status)).toContain(desktopStatusColor);
      expect(desktopCallStatusLabel(status)).toBeTruthy();
    }
  });

  it('keeps a close action in the tray unless the app is quitting', () => {
    expect(shouldKeepDesktopWindowOpen(false)).toBe(true);
    expect(shouldKeepDesktopWindowOpen(true)).toBe(false);
  });
});
