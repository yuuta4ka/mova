import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, normalize, resolve, sep, win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const gameActivityPollIntervalMs = 15_000;
export const installedGameRegistryRefreshMs = 5 * 60_000;

// Exact executable names are deliberate. Broad command-line fragments cause
// false positives: "aces", for example, occurs in a Chromium feature flag.
// Store libraries and manual registrations cover non-distinctive executables.
const knownGameSignatures = [
  ['Counter-Strike 2', /^(?:cs2)(?:\.exe)?$/iu],
  ['Counter-Strike: Global Offensive', /^(?:csgo)(?:\.exe)?$/iu],
  ['Dota 2', /^(?:dota2)(?:\.exe)?$/iu],
  ['VALORANT', /^valorant-win64-shipping(?:\.exe)?$/iu],
  ['League of Legends', /^league of legends(?:\.exe)?$/iu],
  ['Fortnite', /^fortniteclient-(?:win64|mac)-shipping(?:\.exe)?$/iu],
  ['Minecraft', /^minecraft\.windows(?:\.exe)?$/iu],
  ['Roblox', /^robloxplayer(?:beta)?(?:\.exe)?$/iu],
  ['Grand Theft Auto V', /^gta5(?:\.exe)?$/iu],
  ['Red Dead Redemption 2', /^rdr2(?:\.exe)?$/iu],
  ['Apex Legends', /^r5apex(?:\.exe)?$/iu],
  ['Overwatch 2', /^overwatch(?:\.exe)?$/iu],
  ['World of Warcraft', /^wow(?:classic)?(?:\.exe)?$/iu],
  ['Diablo IV', /^diablo iv(?:\.exe)?$/iu],
  ['Cyberpunk 2077', /^cyberpunk2077(?:\.exe)?$/iu],
  ['The Witcher 3', /^witcher3(?:\.exe)?$/iu],
  ['ELDEN RING', /^eldenring(?:\.exe)?$/iu],
  ["Baldur's Gate 3", /^bg3(?:_dx11)?(?:\.exe)?$/iu],
  ['Hades II', /^hades2(?:\.exe)?$/iu],
  ['Hades', /^hades(?:\.exe)?$/iu],
  ['Stardew Valley', /^stardew valley(?:\.exe)?$/iu],
  ['Terraria', /^terraria(?:\.exe)?$/iu],
  ['Factorio', /^factorio(?:\.exe)?$/iu],
  ['Satisfactory', /^(?:factorygame-win64-shipping|satisfactory)(?:\.exe)?$/iu],
  ['Subnautica', /^subnautica(?:\.exe)?$/iu],
  ["No Man's Sky", /^nms(?:\.exe)?$/iu],
  ['Destiny 2', /^destiny2(?:\.exe)?$/iu],
  ['Warframe', /^warframe\.x64(?:\.exe)?$/iu],
  ["Tom Clancy's Rainbow Six Siege", /^rainbowsix(?:_?vulkan)?(?:\.exe)?$/iu],
  ['Escape from Tarkov', /^escapefromtarkov(?:\.exe)?$/iu],
  ['Rust', /^rustclient(?:\.exe)?$/iu],
  ['Among Us', /^among us(?:\.exe)?$/iu],
  ['The Sims 4', /^ts4_x64(?:\.exe)?$/iu],
  ["Sid Meier's Civilization VI", /^civilizationvi(?:_dx12)?(?:\.exe)?$/iu],
  ['Rocket League', /^rocketleague(?:\.exe)?$/iu],
  ['Dead by Daylight', /^deadbydaylight-win64-shipping(?:\.exe)?$/iu],
  ["PLAYERUNKNOWN'S BATTLEGROUNDS", /^tslgame(?:\.exe)?$/iu],
  ['Genshin Impact', /^genshinimpact(?:\.exe)?$/iu],
  ['Honkai: Star Rail', /^starrail(?:\.exe)?$/iu],
  ['Zenless Zone Zero', /^zenlesszonezero(?:\.exe)?$/iu],
  ['Path of Exile', /^pathofexile(?:_x64)?(?:\.exe)?$/iu],
  ['War Thunder', /^aces(?:\.exe)?$/iu],
  ['World of Tanks', /^worldoftanks(?:\.exe)?$/iu],
  ['World of Warships', /^worldofwarships(?:\.exe)?$/iu],
  ['osu!', /^osu!(?:\.exe)?$/iu],
  ['Brawlhalla', /^brawlhalla(?:\.exe)?$/iu],
  ['FiveM', /^fivem(?:_gtaprocess)?(?:\.exe)?$/iu],
  ["Garry's Mod", /^gmod(?:\.exe)?$/iu],
  ['The Elder Scrolls V: Skyrim', /^skyrimse(?:\.exe)?$/iu],
  ['Fallout 4', /^fallout4(?:\.exe)?$/iu],
  ['DOOM Eternal', /^doometernalx64vk(?:\.exe)?$/iu],
  ['Palworld', /^palworld-win64-shipping(?:\.exe)?$/iu],
  ['HELLDIVERS 2', /^helldivers2(?:\.exe)?$/iu],
  ['Lethal Company', /^lethal company(?:\.exe)?$/iu],
  ['Phasmophobia', /^phasmophobia(?:\.exe)?$/iu],
  ['Content Warning', /^content warning(?:\.exe)?$/iu],
  ['Euro Truck Simulator 2', /^eurotrucks2(?:\.exe)?$/iu],
  ['American Truck Simulator', /^amtrucks(?:\.exe)?$/iu],
  ['Cities: Skylines II', /^cities2(?:\.exe)?$/iu],
  ['Sons of the Forest', /^sonsoftheforest(?:\.exe)?$/iu],
];

const ignoredGameExecutables = /^(?:chrome_crashpad_handler|crashpad_handler|unitycrashhandler(?:64)?|crashreport(?:client)?|reportcrash|launcher|updater|update|unins\d*|easyanticheat(?:_eos)?|beservice|steam|steamwebhelper|epicgameslauncher|galaxyclient|battle\.net)(?:\.exe)?$/iu;
const ignoredManualApps = /^(?:mova|finder|dock|windowserver|loginwindow|system settings|explorer|taskmgr|powershell|cmd|conhost|runtimebroker|searchhost|startmenuexperiencehost)(?:\.exe)?$/iu;
const macBundleMetadataCache = new Map();

function cleanTitle(value, fallback = '') {
  return String(value || fallback).trim().replace(/\s+/gu, ' ').slice(0, 80);
}

function executablePathOf(item) {
  return String(item?.executablePath || item?.name || '').trim();
}

function executableNameOf(item) {
  const value = String(item?.name || executablePathOf(item));
  return value.split(/[\\/]/u).pop()?.trim() || '';
}

function normalizedPath(value, platform = process.platform) {
  const input = String(value || '').trim();
  const result = (platform === 'win32' ? win32.normalize(input) : normalize(input)).replace(/[\\/]+$/u, '');
  return platform === 'win32' ? result.toLocaleLowerCase('en-US') : result;
}

function pathInside(child, parent, platform = process.platform) {
  const childPath = normalizedPath(child, platform);
  const parentPath = normalizedPath(parent, platform);
  if (!childPath || !parentPath) return false;
  const separator = platform === 'win32' ? '\\' : sep;
  return childPath === parentPath || childPath.startsWith(`${parentPath}${separator}`);
}

export function macApplicationBundlePath(executablePath) {
  const match = String(executablePath || '').match(/^(.+?\.app)(?:\/|$)/iu);
  return match?.[1] || '';
}

export function applicationIdentity(item, platform = process.platform) {
  const executablePath = executablePathOf(item);
  if (!executablePath) return '';
  const identityPath = platform === 'darwin' ? macApplicationBundlePath(executablePath) || executablePath : executablePath;
  return normalizedPath(identityPath, platform);
}

function applicationName(item, platform = process.platform) {
  if (platform === 'darwin') {
    const bundlePath = macApplicationBundlePath(executablePathOf(item));
    if (bundlePath) return basename(bundlePath, '.app');
  }
  const executableName = executableNameOf(item);
  return executableName.replace(/\.[^.]+$/u, '') || String(item?.name || 'Приложение');
}

function iconPathForProcess(item, platform = process.platform) {
  if (platform === 'darwin') return macApplicationBundlePath(executablePathOf(item)) || executablePathOf(item);
  return executablePathOf(item);
}

function opaqueApplicationId(identity) {
  return createHash('sha256').update(String(identity)).digest('hex').slice(0, 24);
}

export function detectGameFromProcesses(processes = []) {
  for (const [name, signature] of knownGameSignatures) {
    if (processes.some((item) => signature.test(executableNameOf(item)))) return name;
  }
  return null;
}

export function parseWindowsProcessList(output) {
  try {
    const parsed = JSON.parse(String(output || '').replace(/^\uFEFF/u, '').trim() || '[]');
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    return processes.map((item) => ({
      pid: Number(item?.ProcessId || item?.Id || 0),
      parentPid: Number(item?.ParentProcessId || 0),
      name: String(item?.Name || item?.ProcessName || ''),
      executablePath: String(item?.ExecutablePath || item?.Path || item?.Name || ''),
      commandLine: String(item?.CommandLine || ''),
    }));
  } catch {
    return [];
  }
}

export function parsePosixProcessList(output) {
  return String(output || '')
    .split(/\r?\n/u)
    .map((commandLine) => commandLine.trim())
    .filter(Boolean)
    .map((commandLine) => ({ name: commandLine.split(/\s+/u)[0] || '', executablePath: commandLine.split(/\s+/u)[0] || '', commandLine }));
}

export function parsePosixProcessTable(output) {
  return String(output || '')
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      name: basename(match[3]),
      executablePath: match[3],
      commandLine: '',
    }));
}

export async function listDesktopProcesses(platform = process.platform) {
  if (platform === 'win32') {
    const command = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseWindowsProcessList(stdout);
  }
  if (platform === 'darwin' || platform === 'linux') {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,comm='], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePosixProcessTable(stdout);
  }
  return [];
}

function decodeVdfValue(value) {
  return String(value || '').replace(/\\\\/gu, '\\').replace(/\\"/gu, '"');
}

export function parseSteamLibraryFolders(output) {
  const text = String(output || '');
  const paths = [...text.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/giu)].map((match) => decodeVdfValue(match[1]));
  for (const match of text.matchAll(/^\s*"\d+"\s+"((?:\\.|[^"\\])*)"\s*$/gimu)) paths.push(decodeVdfValue(match[1]));
  return [...new Set(paths.filter(Boolean))];
}

export function parseSteamAppManifest(output) {
  const text = String(output || '');
  const value = (key) => decodeVdfValue(text.match(new RegExp(`"${key}"\\s+"((?:\\\\.|[^"\\\\])*)"`, 'iu'))?.[1] || '');
  const appId = value('appid');
  const name = cleanTitle(value('name'));
  const installDirectory = value('installdir');
  return appId && name && installDirectory ? { appId, name, installDirectory } : null;
}

async function safeRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function safeDirectory(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function macBundleGame(bundlePath) {
  if (!bundlePath || bundlePath.startsWith('/System/') || bundlePath.startsWith('/Library/Apple/System/')) return null;
  if (!macBundleMetadataCache.has(bundlePath)) {
    macBundleMetadataCache.set(bundlePath, execFileAsync('plutil', ['-convert', 'json', '-o', '-', join(bundlePath, 'Contents', 'Info.plist')], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 512 * 1024,
    }).then(({ stdout }) => {
      const metadata = JSON.parse(stdout);
      const category = String(metadata.LSApplicationCategoryType || '');
      if (!category.startsWith('public.app-category.') || !category.includes('game')) return null;
      return {
        id: `macos:${metadata.CFBundleIdentifier || bundlePath}`,
        name: cleanTitle(metadata.CFBundleDisplayName || metadata.CFBundleName || basename(bundlePath, '.app')),
        installPath: bundlePath,
        source: 'macos',
      };
    }).catch(() => null));
  }
  return macBundleMetadataCache.get(bundlePath);
}

export async function loadRunningMacGameBundles(processes = []) {
  const bundles = [...new Set(processes.map((item) => macApplicationBundlePath(executablePathOf(item))).filter(Boolean))];
  return (await Promise.all(bundles.map(macBundleGame))).filter(Boolean);
}

async function windowsSteamRoots(environment) {
  const roots = [
    environment['ProgramFiles(x86)'] ? join(environment['ProgramFiles(x86)'], 'Steam') : '',
    environment.ProgramFiles ? join(environment.ProgramFiles, 'Steam') : '',
    'C:\\Program Files (x86)\\Steam',
  ];
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
    const registryPath = String(stdout || '').match(/SteamPath\s+REG_\w+\s+(.+)$/imu)?.[1]?.trim();
    if (registryPath) roots.unshift(registryPath);
  } catch {}
  return [...new Set(roots.filter(Boolean).map((path) => resolve(path)))];
}

async function steamRoots(platform, homeDirectory, environment) {
  if (platform === 'darwin') return [join(homeDirectory, 'Library', 'Application Support', 'Steam')];
  if (platform === 'linux') return [join(homeDirectory, '.steam', 'steam'), join(homeDirectory, '.local', 'share', 'Steam')];
  if (platform === 'win32') return windowsSteamRoots(environment);
  return [];
}

async function loadSteamGames(platform, homeDirectory, environment) {
  const roots = await steamRoots(platform, homeDirectory, environment);
  const steamAppsDirectories = new Set(roots.map((root) => join(root, 'steamapps')));
  for (const root of roots) {
    const folders = parseSteamLibraryFolders(await safeRead(join(root, 'steamapps', 'libraryfolders.vdf')));
    for (const folder of folders) steamAppsDirectories.add(join(folder, 'steamapps'));
  }
  const games = [];
  for (const steamApps of steamAppsDirectories) {
    const entries = await safeDirectory(steamApps);
    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/iu.test(entry.name)) continue;
      const manifest = parseSteamAppManifest(await safeRead(join(steamApps, entry.name)));
      if (!manifest) continue;
      games.push({ id: `steam:${manifest.appId}`, name: manifest.name, installPath: join(steamApps, 'common', manifest.installDirectory), source: 'steam' });
    }
  }
  return games;
}

async function loadEpicGames(platform, homeDirectory, environment) {
  const manifestDirectories = platform === 'win32'
    ? [join(environment.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')]
    : platform === 'darwin'
      ? [join(homeDirectory, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')]
      : [];
  const games = [];
  for (const directory of manifestDirectories) {
    for (const entry of await safeDirectory(directory)) {
      if (!entry.isFile() || !/\.item$/iu.test(entry.name)) continue;
      try {
        const manifest = JSON.parse(await safeRead(join(directory, entry.name)));
        const name = cleanTitle(manifest.DisplayName || manifest.AppName);
        const installPath = String(manifest.InstallLocation || '').trim();
        if (!name || !installPath) continue;
        games.push({ id: `epic:${manifest.CatalogItemId || manifest.AppName || entry.name}`, name, installPath, source: 'epic' });
      } catch {}
    }
  }
  return games;
}

async function loadGogGames(platform, environment) {
  if (platform !== 'win32') return [];
  const roots = [...new Set([
    environment.GOG_GAMES_PATH,
    'C:\\GOG Games',
  ].filter(Boolean))];
  const games = [];
  for (const root of roots) {
    for (const directory of await safeDirectory(root)) {
      if (!directory.isDirectory()) continue;
      const installPath = join(root, directory.name);
      const metadataFile = (await safeDirectory(installPath)).find((entry) => entry.isFile() && /^goggame-\d+\.info$/iu.test(entry.name));
      if (!metadataFile) continue;
      try {
        const metadata = JSON.parse(await safeRead(join(installPath, metadataFile.name)));
        const name = cleanTitle(metadata.name || directory.name);
        if (name) games.push({ id: `gog:${metadata.gameId || directory.name}`, name, installPath, source: 'gog' });
      } catch {}
    }
  }
  return games;
}

export async function loadInstalledGameRegistry(platform = process.platform, options = {}) {
  const homeDirectory = options.homeDirectory || homedir();
  const environment = options.environment || process.env;
  const games = [
    ...(await loadSteamGames(platform, homeDirectory, environment)),
    ...(await loadEpicGames(platform, homeDirectory, environment)),
    ...(await loadGogGames(platform, environment)),
  ];
  const seen = new Set();
  return games.filter((game) => {
    const key = normalizedPath(game.installPath, platform);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function manualGameForProcess(item, registeredGames, platform) {
  const identity = applicationIdentity(item, platform);
  return registeredGames.find((game) => normalizedPath(game?.identity, platform) === identity);
}

function installedGameForProcess(item, installedGames, platform) {
  const executablePath = executablePathOf(item);
  return installedGames.find((game) => pathInside(executablePath, game.installPath, platform));
}

export function resolveGameFromProcesses(processes = [], options = {}) {
  const platform = options.platform || process.platform;
  const installedGames = Array.isArray(options.installedGames) ? options.installedGames : [];
  const registeredGames = Array.isArray(options.registeredGames) ? options.registeredGames : [];
  const candidates = [];
  for (const item of processes) {
    const executableName = executableNameOf(item);
    if (!executableName || ignoredGameExecutables.test(executableName)) continue;
    const manual = manualGameForProcess(item, registeredGames, platform);
    const installed = manual ? null : installedGameForProcess(item, installedGames, platform);
    const knownName = manual || installed ? '' : knownGameSignatures.find(([, signature]) => signature.test(executableName))?.[0];
    const game = manual || installed || (knownName ? { id: `known:${knownName}`, name: knownName, source: 'known' } : null);
    if (!game) continue;
    candidates.push({
      key: `${game.source || 'manual'}:${game.id || normalizedPath(game.identity, platform)}`,
      name: cleanTitle(game.title || game.name),
      source: manual ? 'manual' : installed?.source || 'known',
      confidence: manual ? 3 : installed ? 2 : 1,
      pid: Number(item.pid || 0),
      executablePath: executablePathOf(item),
      iconPath: iconPathForProcess(item, platform),
    });
  }
  candidates.sort((left, right) => right.confidence - left.confidence || right.pid - left.pid || left.name.localeCompare(right.name));
  return candidates[0] || null;
}

export function runningApplicationsFromProcesses(processes = [], platform = process.platform) {
  const applications = new Map();
  for (const item of processes) {
    const identity = applicationIdentity(item, platform);
    const executableName = executableNameOf(item);
    const name = cleanTitle(applicationName(item, platform));
    if (!identity || !name || ignoredManualApps.test(name) || ignoredManualApps.test(executableName)) continue;
    if (platform === 'darwin' && !macApplicationBundlePath(executablePathOf(item))) continue;
    if (platform === 'darwin' && (identity.startsWith('/System/') || identity.startsWith('/Library/Apple/System/'))) continue;
    if (platform === 'win32' && /(?:^|\\)Windows(?:\\|$)/iu.test(identity)) continue;
    const existing = applications.get(identity);
    if (existing && Number(existing.pid || 0) >= Number(item.pid || 0)) continue;
    applications.set(identity, {
      id: opaqueApplicationId(identity),
      name,
      executableName,
      identity,
      iconPath: iconPathForProcess(item, platform),
      pid: Number(item.pid || 0),
    });
  }
  return [...applications.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function detectRunningGame(platform = process.platform, options = {}) {
  try {
    const processes = await listDesktopProcesses(platform);
    const installedGames = options.installedGames || await loadInstalledGameRegistry(platform, options);
    return resolveGameFromProcesses(processes, { ...options, platform, installedGames });
  } catch {
    return null;
  }
}
