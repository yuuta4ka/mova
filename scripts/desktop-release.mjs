#!/usr/bin/env node

import { copyFile, link, lstat, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

export function desktopReleaseAssetNames(version) {
  return [
    'latest-mac.yml',
    'latest.yml',
    `Mova-${version}-arm64.dmg`,
    `Mova-${version}-arm64.dmg.blockmap`,
    `Mova-${version}-arm64.zip`,
    `Mova-${version}-arm64.zip.blockmap`,
    `Mova.Setup.${version}.exe`,
    `Mova.Setup.${version}.exe.blockmap`,
  ];
}

export function desktopLocalArtifactNames(version) {
  return [
    ...desktopReleaseAssetNames(version),
    `Mova Setup ${version}.exe`,
    `Mova Setup ${version}.exe.blockmap`,
  ];
}

export function parseLandingVersions(source) {
  const version = source.match(/const version = ['"]([^'"]+)['"]/u)?.[1] || '';
  const releaseTag = source.match(/const releaseTag = ['"]([^'"]+)['"]/u)?.[1] || '';
  return { version, releaseTag };
}

export async function readDesktopReleaseConfig(root = projectRoot) {
  const packagePath = join(root, 'package.json');
  const landingPath = join(root, 'src', 'LandingPage.tsx');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const landingVersions = parseLandingVersions(await readFile(landingPath, 'utf8'));
  const version = String(packageJson.version || '').trim();
  const owner = String(packageJson.build?.publish?.owner || '').trim();
  const repo = String(packageJson.build?.publish?.repo || '').trim();

  if (!version || /[\/\\\0]/u.test(version)) throw new Error('В package.json указана некорректная версия desktop-приложения.');
  if (!owner || !repo) throw new Error('В package.json не настроен GitHub-репозиторий для desktop-релизов.');
  if (landingVersions.version !== version || landingVersions.releaseTag !== version) {
    throw new Error(
      `Версия package.json (${version}) не совпадает с version/releaseTag в src/LandingPage.tsx ` +
      `(${landingVersions.version || 'не указана'}/${landingVersions.releaseTag || 'не указана'}).`,
    );
  }

  return {
    version,
    tag: `v${version}`,
    repository: `${owner}/${repo}`,
    releaseDir: join(root, 'release'),
    assets: desktopReleaseAssetNames(version),
  };
}

async function pathSize(path, seenFiles) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    const identity = `${info.dev}:${info.ino}`;
    if (seenFiles.has(identity)) return 0;
    seenFiles.add(identity);
    return info.size;
  }
  const entries = await readdir(path);
  let total = 0;
  for (const entry of entries) total += await pathSize(join(path, entry), seenFiles);
  return total;
}

export async function pruneDesktopReleaseDirectory(releaseDir, version, logger = console.log) {
  try {
    const releaseInfo = await lstat(releaseDir);
    if (releaseInfo.isSymbolicLink() || !releaseInfo.isDirectory()) {
      throw new Error(`${releaseDir} должен быть обычной папкой.`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      logger('Папки release/ пока нет — очищать нечего.');
      return { removed: [], reclaimedBytes: 0 };
    }
    throw error;
  }

  const keep = new Set(desktopLocalArtifactNames(version));
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const removed = [];
  let reclaimedBytes = 0;
  const seenFiles = new Set();

  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    const target = join(releaseDir, entry.name);
    reclaimedBytes += await pathSize(target, seenFiles);
    await rm(target, { recursive: true, force: true });
    removed.push(entry.name);
  }

  if (removed.length) {
    logger(`Удалено старых desktop-артефактов: ${removed.length} (${formatBytes(reclaimedBytes)}).`);
  } else {
    logger('Старых desktop-артефактов нет.');
  }
  return { removed, reclaimedBytes };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export async function verifyDesktopReleaseArtifacts(releaseDir, version) {
  const localArtifacts = desktopLocalArtifactNames(version);
  for (const name of localArtifacts) {
    const assetPath = join(releaseDir, name);
    let info;
    try {
      info = await stat(assetPath);
    } catch {
      throw new Error(`Не найден desktop-артефакт: release/${name}`);
    }
    if (!info.isFile() || info.size <= 0) throw new Error(`Desktop-артефакт пуст: release/${name}`);
  }

  const windowsMetadata = await readFile(join(releaseDir, 'latest.yml'), 'utf8');
  const macMetadata = await readFile(join(releaseDir, 'latest-mac.yml'), 'utf8');
  const versionLine = new RegExp(`^version:\\s*['"]?${escapeRegExp(version)}['"]?\\s*$`, 'mu');
  if (!versionLine.test(windowsMetadata) || !windowsMetadata.includes(`Mova.Setup.${version}.exe`)) {
    throw new Error('release/latest.yml не соответствует версии или имени Windows-установщика.');
  }
  if (
    !versionLine.test(macMetadata) ||
    !macMetadata.includes(`Mova-${version}-arm64.zip`) ||
    !macMetadata.includes(`Mova-${version}-arm64.dmg`)
  ) {
    throw new Error('release/latest-mac.yml не соответствует macOS-артефактам.');
  }

  return desktopReleaseAssetNames(version);
}

export async function createWindowsInstallerAliases(releaseDir, version) {
  const aliases = [
    [`Mova.Setup.${version}.exe`, `Mova Setup ${version}.exe`],
    [`Mova.Setup.${version}.exe.blockmap`, `Mova Setup ${version}.exe.blockmap`],
  ];

  for (const [sourceName, aliasName] of aliases) {
    const source = join(releaseDir, sourceName);
    const alias = join(releaseDir, aliasName);
    const sourceInfo = await stat(source);
    if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error(`Не найден Windows-артефакт: release/${sourceName}`);
    await rm(alias, { force: true });
    try {
      await link(source, alias);
    } catch (error) {
      if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
      await copyFile(source, alias);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function verifyDmg(path) {
  if (process.platform !== 'darwin') {
    console.warn('Проверка DMG через hdiutil пропущена: команда доступна только на macOS.');
    return;
  }
  const result = spawnSync('hdiutil', ['verify', path], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('hdiutil не смог проверить DMG.');
}

async function runCli() {
  const command = process.argv[2];
  const config = await readDesktopReleaseConfig();

  if (command === 'version') {
    console.log(config.version);
    return;
  }
  if (command === 'tag') {
    console.log(config.tag);
    return;
  }
  if (command === 'repository') {
    console.log(config.repository);
    return;
  }
  if (command === 'check-version') {
    console.log(`Desktop-версия ${config.version} синхронизирована со страницей загрузки.`);
    return;
  }
  if (command === 'prune') {
    await pruneDesktopReleaseDirectory(config.releaseDir, config.version);
    return;
  }
  if (command === 'verify') {
    const assets = await verifyDesktopReleaseArtifacts(config.releaseDir, config.version);
    verifyDmg(join(config.releaseDir, `Mova-${config.version}-arm64.dmg`));
    console.log(`Проверены ${assets.length} файлов desktop-релиза ${config.version}.`);
    return;
  }
  if (command === 'alias-windows') {
    await createWindowsInstallerAliases(config.releaseDir, config.version);
    console.log(`Созданы локальные имена Windows-артефактов для версии ${config.version}.`);
    return;
  }
  if (command === 'assets') {
    for (const name of config.assets) console.log(join(config.releaseDir, name));
    return;
  }

  throw new Error('Использование: node scripts/desktop-release.mjs <version|tag|repository|check-version|prune|verify|alias-windows|assets>');
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  runCli().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}
