const usbHardwareIdSuffix = /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/iu;

export function cleanAudioDeviceLabel(label: string) {
  return label.replace(usbHardwareIdSuffix, '').trim();
}

export function audioDeviceLabel(device: MediaDeviceInfo, fallback: string) {
  return cleanAudioDeviceLabel(device.label) || fallback;
}
