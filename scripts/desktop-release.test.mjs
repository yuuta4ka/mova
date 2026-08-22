import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createWindowsInstallerAliases,
  desktopLocalArtifactNames,
  desktopReleaseAssetNames,
  parseLandingVersions,
  pruneDesktopReleaseDirectory,
  verifyDesktopReleaseArtifacts,
} from './desktop-release.mjs';

describe('desktop release tooling', () => {
  it('uses asset names shared by GitHub downloads and auto-update metadata', () => {
    expect(desktopReleaseAssetNames('1.2.3')).toEqual([
      'latest-mac.yml',
      'latest.yml',
      'Mova-1.2.3-arm64.dmg',
      'Mova-1.2.3-arm64.dmg.blockmap',
      'Mova-1.2.3-arm64.zip',
      'Mova-1.2.3-arm64.zip.blockmap',
      'Mova.Setup.1.2.3.exe',
      'Mova.Setup.1.2.3.exe.blockmap',
    ]);
  });

  it('reads the two landing page version constants', () => {
    expect(parseLandingVersions("const version = '1.2.3';\nconst releaseTag = '1.2.3';")).toEqual({
      version: '1.2.3',
      releaseTag: '1.2.3',
    });
  });

  it('removes old versions and unpacked build folders while keeping current release assets', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'mova-release-prune-'));
    await writeFile(join(releaseDir, 'Mova-1.2.3-arm64.dmg'), 'current');
    await writeFile(join(releaseDir, 'latest-mac.yml'), 'current metadata');
    await writeFile(join(releaseDir, 'Mova-1.2.2-arm64.dmg'), 'old');
    await mkdir(join(releaseDir, 'mac-arm64'));
    await writeFile(join(releaseDir, 'mac-arm64', 'Mova'), 'unpacked');

    const result = await pruneDesktopReleaseDirectory(releaseDir, '1.2.3', () => {});

    expect(result.removed).toEqual(expect.arrayContaining(['Mova-1.2.2-arm64.dmg', 'mac-arm64']));
    await expect(readFile(join(releaseDir, 'Mova-1.2.3-arm64.dmg'), 'utf8')).resolves.toBe('current');
    await expect(readFile(join(releaseDir, 'latest-mac.yml'), 'utf8')).resolves.toBe('current metadata');
    await expect(readFile(join(releaseDir, 'Mova-1.2.2-arm64.dmg'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a local Windows installer name with spaces without changing the published asset name', async () => {
    const version = '1.2.3';
    const releaseDir = await mkdtemp(join(tmpdir(), 'mova-release-alias-'));
    await writeFile(join(releaseDir, `Mova.Setup.${version}.exe`), 'installer');
    await writeFile(join(releaseDir, `Mova.Setup.${version}.exe.blockmap`), 'blockmap');

    await createWindowsInstallerAliases(releaseDir, version);

    await expect(readFile(join(releaseDir, `Mova Setup ${version}.exe`), 'utf8')).resolves.toBe('installer');
    await expect(readFile(join(releaseDir, `Mova Setup ${version}.exe.blockmap`), 'utf8')).resolves.toBe('blockmap');
  });

  it('verifies all release files and their updater metadata', async () => {
    const version = '1.2.3';
    const releaseDir = await mkdtemp(join(tmpdir(), 'mova-release-verify-'));
    for (const name of desktopLocalArtifactNames(version)) {
      const contents = name === 'latest.yml'
        ? `version: ${version}\npath: Mova.Setup.${version}.exe\n`
        : name === 'latest-mac.yml'
          ? `version: ${version}\nfiles:\n  - url: Mova-${version}-arm64.zip\n  - url: Mova-${version}-arm64.dmg\n`
          : 'artifact';
      await writeFile(join(releaseDir, name), contents);
    }

    await expect(verifyDesktopReleaseArtifacts(releaseDir, version)).resolves.toEqual(desktopReleaseAssetNames(version));
  });
});
