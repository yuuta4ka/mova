import { describe, expect, it } from 'vitest';
import {
  detectGameFromProcesses,
  gameActivityPollIntervalMs,
  macApplicationBundlePath,
  parsePosixProcessTable,
  parseSteamAppManifest,
  parseSteamLibraryFolders,
  parseWindowsProcessList,
  resolveGameFromProcesses,
  runningApplicationsFromProcesses,
} from './game-activity.mjs';

describe('desktop game activity', () => {
  it('recognizes exact game executables without matching Chromium arguments', () => {
    expect(detectGameFromProcesses(parseWindowsProcessList(JSON.stringify([
      { Name: 'explorer.exe', ExecutablePath: 'C:\\Windows\\explorer.exe' },
      { Name: 'aces.exe', ExecutablePath: 'D:\\Games\\War Thunder\\aces.exe' },
    ])))).toBe('War Thunder');
    expect(detectGameFromProcesses([{
      name: 'Mova Helper',
      executablePath: '/Applications/Mova.app/Contents/Frameworks/Mova Helper',
      commandLine: '--enable-features=TraceSiteInstanceGetProcessCreation',
    }])).toBeNull();
  });

  it('recognizes any installed Steam or Epic game by its installation directory', () => {
    const game = resolveGameFromProcesses([{
      pid: 42,
      name: 'tiny_game.exe',
      executablePath: 'D:\\SteamLibrary\\steamapps\\common\\Tiny Indie\\bin\\tiny_game.exe',
    }], {
      platform: 'win32',
      installedGames: [{ id: 'steam:123', name: 'Tiny Indie', installPath: 'D:\\SteamLibrary\\steamapps\\common\\Tiny Indie', source: 'steam' }],
    });
    expect(game).toMatchObject({ name: 'Tiny Indie', source: 'steam', confidence: 2 });
  });

  it('gives a manually registered application priority and groups macOS helper processes', () => {
    const processes = parsePosixProcessTable([
      '  40     1 /Applications/Unknown Gem.app/Contents/MacOS/Unknown Gem',
      '  41    40 /Applications/Unknown Gem.app/Contents/Frameworks/Unknown Gem Helper.app/Contents/MacOS/Unknown Gem Helper',
    ].join('\n'));
    const applications = runningApplicationsFromProcesses(processes, 'darwin');
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({ name: 'Unknown Gem', identity: '/Applications/Unknown Gem.app' });
    expect(macApplicationBundlePath(processes[1].executablePath)).toBe('/Applications/Unknown Gem.app');
    expect(resolveGameFromProcesses(processes, {
      platform: 'darwin',
      registeredGames: [{ id: 'manual-game', title: 'Моя инди-игра', identity: '/Applications/Unknown Gem.app' }],
    })).toMatchObject({ name: 'Моя инди-игра', source: 'manual', confidence: 3 });
  });

  it('parses current and legacy Steam library metadata', () => {
    expect(parseSteamLibraryFolders('"path" "D:\\\\SteamLibrary"\n"2" "/Volumes/Games"')).toEqual(['D:\\SteamLibrary', '/Volumes/Games']);
    expect(parseSteamAppManifest('"appid" "123"\n"name" "Tiny Indie"\n"installdir" "Tiny Indie"')).toEqual({ appId: '123', name: 'Tiny Indie', installDirectory: 'Tiny Indie' });
  });

  it('polls without excessive process scans', () => {
    expect(gameActivityPollIntervalMs).toBeGreaterThanOrEqual(15_000);
  });
});
