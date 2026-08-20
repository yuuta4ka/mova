import { describe, expect, it } from 'vitest';
import { detectGameFromProcesses, gameActivityPollIntervalMs, parsePosixProcessList, parseWindowsProcessList } from './game-activity.mjs';

describe('desktop game activity', () => {
  it('recognizes games by Windows executable and command line', () => {
    const processes = parseWindowsProcessList(JSON.stringify([
      { Name: 'explorer.exe', CommandLine: 'C:\\Windows\\explorer.exe' },
      { Name: 'javaw.exe', CommandLine: 'javaw.exe -cp C:\\Games\\.minecraft\\libraries net.minecraft.client.main.Main' },
    ]));
    expect(detectGameFromProcesses(processes)).toBe('Minecraft');
  });

  it('recognizes macOS and Linux game commands without treating launchers as games', () => {
    expect(detectGameFromProcesses(parsePosixProcessList('/Applications/Steam.app/Contents/MacOS/steam_osx'))).toBeNull();
    expect(detectGameFromProcesses(parsePosixProcessList('/Applications/Minecraft.app/Contents/MacOS/launcher'))).toBeNull();
    expect(detectGameFromProcesses(parsePosixProcessList('/Games/Stardew Valley/Stardew Valley'))).toBe('Stardew Valley');
  });

  it('prefers a specific signature and polls without excessive process scans', () => {
    expect(detectGameFromProcesses([{ name: 'hades2.exe', commandLine: 'C:\\Games\\Hades II\\hades2.exe' }])).toBe('Hades II');
    expect(gameActivityPollIntervalMs).toBeGreaterThanOrEqual(15_000);
  });
});
