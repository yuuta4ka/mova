const sourceKindFromId = (id) => {
  if (String(id).startsWith('window:')) return 'window';
  if (String(id).startsWith('screen:')) return 'screen';
  if (String(id).startsWith('device:')) return 'device';
  return null;
};

const imageDataUrl = (image) => {
  try {
    return image && !image.isEmpty?.() ? image.toDataURL() : '';
  } catch {
    return '';
  }
};

export function buildSharePickerSources(sources) {
  return sources.flatMap((source) => {
    const kind = sourceKindFromId(source.id);
    if (!kind) return [];
    return [{
      id: String(source.id),
      name: String(source.name || (kind === 'screen' ? 'Экран' : 'Приложение')),
      kind,
      displayId: String(source.display_id || ''),
      thumbnail: imageDataUrl(source.thumbnail),
      appIcon: imageDataUrl(source.appIcon),
    }];
  });
}

export function availableSharePickerTabs(sources) {
  return ['window', 'screen', 'device'].filter((kind) => sources.some((source) => source.kind === kind));
}
