import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const gameActivityPollIntervalMs = 15_000;

// Keep the most specific signatures first. Launchers are deliberately not
// included: a game is reported only after its own process has started.
const gameSignatures = [
  ['Counter-Strike 2', /(?:^|[\\/\s])cs2(?:\.exe)?(?:\s|$)/iu],
  ['Counter-Strike: Global Offensive', /(?:^|[\\/\s])csgo(?:\.exe)?(?:\s|$)/iu],
  ['Dota 2', /(?:^|[\\/\s])dota2(?:\.exe)?(?:\s|$)/iu],
  ['VALORANT', /valorant-win64-shipping(?:\.exe)?/iu],
  ['League of Legends', /league of legends(?:\.exe)?/iu],
  ['Fortnite', /fortniteclient-(?:win64|mac)-shipping/iu],
  ['Minecraft', /(?:minecraft\.windows|[\\/]\.minecraft[\\/]|net\.minecraft)(?:\.exe)?/iu],
  ['Roblox', /robloxplayer(?:beta)?(?:\.exe)?/iu],
  ['Grand Theft Auto V', /(?:^|[\\/\s])gta5(?:\.exe)?(?:\s|$)/iu],
  ['Red Dead Redemption 2', /(?:^|[\\/\s])rdr2(?:\.exe)?(?:\s|$)/iu],
  ['Apex Legends', /(?:^|[\\/\s])r5apex(?:\.exe)?(?:\s|$)/iu],
  ['Overwatch 2', /(?:^|[\\/\s])overwatch(?:\.exe)?(?:\s|$)/iu],
  ['World of Warcraft', /(?:^|[\\/\s])wow(?:classic)?(?:\.exe)?(?:\s|$)/iu],
  ['Diablo IV', /diablo iv(?:\.exe)?/iu],
  ['Cyberpunk 2077', /cyberpunk2077(?:\.exe)?/iu],
  ['The Witcher 3', /witcher3(?:\.exe)?/iu],
  ['ELDEN RING', /eldenring(?:\.exe)?/iu],
  ["Baldur's Gate 3", /(?:^|[\\/\s])bg3(?:_dx11)?(?:\.exe)?(?:\s|$)/iu],
  ['Hades II', /hades2(?:\.exe)?/iu],
  ['Hades', /(?:^|[\\/\s])hades(?:\.exe)?(?:\s|$)/iu],
  ['Stardew Valley', /stardew valley(?:\.exe)?/iu],
  ['Terraria', /(?:^|[\\/\s])terraria(?:\.exe)?(?:\s|$)/iu],
  ['Factorio', /(?:^|[\\/\s])factorio(?:\.exe)?(?:\s|$)/iu],
  ['Satisfactory', /factorygame-win64-shipping|satisfactory(?:\.exe)?/iu],
  ['Subnautica', /subnautica(?:\.exe)?/iu],
  ["No Man's Sky", /(?:^|[\\/\s])nms(?:\.exe)?(?:\s|$)/iu],
  ['Destiny 2', /destiny2(?:\.exe)?/iu],
  ['Warframe', /warframe\.x64(?:\.exe)?/iu],
  ["Tom Clancy's Rainbow Six Siege", /rainbowsix(?:_?vulkan)?(?:\.exe)?/iu],
  ['Escape from Tarkov', /escapefromtarkov(?:\.exe)?/iu],
  ['Rust', /rustclient(?:\.exe)?/iu],
  ['Among Us', /among us(?:\.exe)?/iu],
  ['The Sims 4', /ts4_x64(?:\.exe)?/iu],
  ["Sid Meier's Civilization VI", /civilizationvi(?:_dx12)?(?:\.exe)?/iu],
  ['Rocket League', /rocketleague(?:\.exe)?/iu],
  ['Dead by Daylight', /deadbydaylight-win64-shipping/iu],
  ["PLAYERUNKNOWN'S BATTLEGROUNDS", /tslgame(?:\.exe)?/iu],
  ['Genshin Impact', /genshinimpact(?:\.exe)?/iu],
  ['Honkai: Star Rail', /(?:^|[\\/\s])starrail(?:\.exe)?(?:\s|$)/iu],
  ['Zenless Zone Zero', /zenlesszonezero(?:\.exe)?/iu],
  ['Path of Exile', /pathofexile(?:_x64)?(?:\.exe)?/iu],
  ['War Thunder', /aces(?:\.exe)?/iu],
  ['World of Tanks', /worldoftanks(?:\.exe)?/iu],
  ['World of Warships', /worldofwarships(?:\.exe)?/iu],
  ['osu!', /(?:^|[\\/\s])osu!(?:\.exe)?(?:\s|$)/iu],
  ['Brawlhalla', /brawlhalla(?:\.exe)?/iu],
  ['FiveM', /fivem(?:_gtaprocess)?(?:\.exe)?/iu],
  ["Garry's Mod", /[\\/]garrysmod[\\/]|gmod(?:\.exe)?/iu],
  ['The Elder Scrolls V: Skyrim', /skyrimse(?:\.exe)?/iu],
  ['Fallout 4', /fallout4(?:\.exe)?/iu],
  ['DOOM Eternal', /doometernalx64vk(?:\.exe)?/iu],
  ['Palworld', /palworld-win64-shipping/iu],
  ['HELLDIVERS 2', /helldivers2(?:\.exe)?/iu],
  ['Lethal Company', /lethal company(?:\.exe)?/iu],
  ['Phasmophobia', /phasmophobia(?:\.exe)?/iu],
  ['Content Warning', /content warning(?:\.exe)?/iu],
  ['Euro Truck Simulator 2', /eurotrucks2(?:\.exe)?/iu],
  ['American Truck Simulator', /amtrucks(?:\.exe)?/iu],
  ['Cities: Skylines II', /cities2(?:\.exe)?/iu],
  ['Sons of the Forest', /sonsoftheforest(?:\.exe)?/iu],
];

function processText(process) {
  return `${String(process?.name || '')} ${String(process?.commandLine || '')}`.trim();
}

export function detectGameFromProcesses(processes = []) {
  for (const [name, signature] of gameSignatures) {
    if (processes.some((process) => signature.test(processText(process)))) return name;
  }
  return null;
}

export function parseWindowsProcessList(output) {
  try {
    const parsed = JSON.parse(String(output || '').replace(/^\uFEFF/u, '').trim() || '[]');
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    return processes.map((process) => ({
      name: String(process?.Name || ''),
      commandLine: String(process?.CommandLine || ''),
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
    .map((commandLine) => ({ name: commandLine.split(/\s+/u)[0] || '', commandLine }));
}

export async function listDesktopProcesses(platform = process.platform) {
  if (platform === 'win32') {
    const command = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseWindowsProcessList(stdout);
  }
  if (platform === 'darwin' || platform === 'linux') {
    const { stdout } = await execFileAsync('ps', ['-axo', 'command='], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePosixProcessList(stdout);
  }
  return [];
}

export async function detectRunningGame(platform = process.platform) {
  try {
    return detectGameFromProcesses(await listDesktopProcesses(platform));
  } catch {
    return null;
  }
}
