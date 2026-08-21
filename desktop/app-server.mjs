export const developmentAppUrl = 'http://127.0.0.1:5173';
export const productionAppUrls = Object.freeze([
  'https://hola-mova.ru',
  'https://movamoskov-yuuta.amvera.io',
]);

export function normalizeDesktopAppUrl(value, { allowLocal = false } = {}) {
  try {
    const url = new URL(String(value || '').trim());
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function desktopAppUrlCandidates({ packaged, environmentUrl = '' }) {
  const override = normalizeDesktopAppUrl(environmentUrl, { allowLocal: true });
  if (override) return [override];
  return packaged ? [...productionAppUrls] : [developmentAppUrl];
}

export function desktopAppPageUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.pathname === '/') url.pathname = '/app';
  return url.toString();
}

export function isTrustedDesktopOrigin(value, candidates) {
  try {
    const origin = new URL(value).origin;
    return candidates.some((candidate) => new URL(candidate).origin === origin);
  } catch {
    return false;
  }
}
