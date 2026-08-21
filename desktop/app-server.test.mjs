import { describe, expect, it } from 'vitest';
import { desktopAppPageUrl, desktopAppUrlCandidates, isTrustedDesktopOrigin, productionAppUrls } from './app-server.mjs';

describe('desktop production server selection', () => {
  it('uses the branded domain with the Amvera host as an automatic fallback', () => {
    expect(desktopAppUrlCandidates({ packaged: true })).toEqual([
      'https://hola-mova.ru',
      'https://movamoskov-yuuta.amvera.io',
    ]);
  });

  it('keeps localhost for development and permits an explicit technical override', () => {
    expect(desktopAppUrlCandidates({ packaged: false })).toEqual(['http://127.0.0.1:5173']);
    expect(desktopAppUrlCandidates({ packaged: true, environmentUrl: 'https://preview.example.com/path/?ignored=1' }))
      .toEqual(['https://preview.example.com/path']);
  });

  it('opens the application route and trusts only configured candidates', () => {
    expect(desktopAppPageUrl(productionAppUrls[0])).toBe('https://hola-mova.ru/app');
    expect(isTrustedDesktopOrigin('https://hola-mova.ru/app/chat', productionAppUrls)).toBe(true);
    expect(isTrustedDesktopOrigin('https://example.com/app', productionAppUrls)).toBe(false);
  });
});
