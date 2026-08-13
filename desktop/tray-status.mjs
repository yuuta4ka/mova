export const desktopStatusColor = '#76ded0';

export function resolveDesktopCallStatus(value = {}) {
  if (!value.active) return 'idle';
  if (value.deafened) return 'headphones-off';
  if (value.muted) return 'mic-off';
  return value.speaking ? 'speaking' : 'silent';
}

export function desktopCallStatusLabel(status) {
  if (status === 'speaking') return 'Микрофон передаёт звук';
  if (status === 'silent') return 'Микрофон включён, звук не передаётся';
  if (status === 'mic-off') return 'Микрофон выключен';
  if (status === 'headphones-off') return 'Наушники выключены';
  return 'Mova работает в фоне';
}

function statusMark(status, { x = 16, y = 16, radius = 10, strokeWidth = 2.4 } = {}) {
  const color = desktopStatusColor;
  if (status === 'speaking') return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}"/>`;
  if (status === 'silent') return `<circle cx="${x}" cy="${y}" r="${radius - strokeWidth / 2}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  if (status === 'mic-off') {
    return `<g fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="M${x - 3.5} ${y - 2.5}v-3a3.5 3.5 0 0 1 6.7-1.4M${x + 3.5} ${y - 2.5}v2.5a3.5 3.5 0 0 1-5.7 2.7M${x - 3.5} ${y}v.2a3.5 3.5 0 0 0 .7 2.1M${x - 7} ${y}a7 7 0 0 0 11.5 5.4M${x} ${y + 7}v4M${x - 4} ${y + 11}h8M${x - 8} ${y - 9}l16 18"/></g>`;
  }
  if (status === 'headphones-off') {
    return `<g fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="M${x - 8} ${y + 2}v-2a8 8 0 0 1 1.4-4.5M${x - 3.8} ${y - 7.1}A8 8 0 0 1 ${x + 8} ${y}v2M${x - 8} ${y + 2}h2.5a2 2 0 0 1 2 2v4h-2.5a2 2 0 0 1-2-2zM${x + 8} ${y + 2}h-2.5a2 2 0 0 0-2 2v4h2.5a2 2 0 0 0 2-2zM${x - 9} ${y - 9}l18 18"/></g>`;
  }
  return `<g fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 23V9l9 10L25 9v14"/></g>`;
}

export function desktopStatusSvg(status, { size = 32, badge = false } = {}) {
  const background = badge ? '' : '<rect x="1" y="1" width="30" height="30" rx="9" fill="#080c12" stroke="#233140" stroke-width="1.5"/>';
  const mark = statusMark(status, badge ? { x: 16, y: 16, radius: 11, strokeWidth: 2.8 } : undefined);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${background}${mark}</svg>`;
}

export function shouldKeepDesktopWindowOpen(isQuitting) {
  return !isQuitting;
}
