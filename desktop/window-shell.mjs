export function desktopWindowFrameOptions(platform) {
  if (platform !== 'win32') return {};
  return {
    frame: false,
    thickFrame: true,
    hasShadow: true,
    roundedCorners: true,
  };
}
