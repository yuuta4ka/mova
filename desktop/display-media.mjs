const safeLoopbackPlatforms = new Set(['darwin', 'win32']);

export function desktopDisplayMediaStreams(source, audioRequested, platform = process.platform) {
  if (!source) return {};
  return {
    video: source,
    ...(audioRequested && safeLoopbackPlatforms.has(platform) ? { audio: 'loopback' } : {}),
  };
}
