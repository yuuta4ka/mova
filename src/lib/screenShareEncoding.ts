interface ScreenShareQuality {
  width: number;
  height: number;
  frameRate: number;
}

export function screenShareMaxBitrate({ width, height, frameRate }: ScreenShareQuality) {
  const pixels = Math.max(1, width * height);
  const frames = Math.max(1, frameRate);
  const estimated = pixels * frames * 0.075;
  return Math.round(Math.min(12_000_000, Math.max(1_200_000, estimated)));
}

export function screenShareContentHint(frameRate: number): 'detail' | 'motion' {
  return frameRate >= 30 ? 'motion' : 'detail';
}

export async function configureScreenShareSender(sender: RTCRtpSender, quality: ScreenShareQuality) {
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return false;
  parameters.degradationPreference = 'maintain-framerate';
  const maxBitrate = screenShareMaxBitrate(quality);
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = maxBitrate;
    encoding.maxFramerate = quality.frameRate;
    encoding.scaleResolutionDownBy = 1;
    encoding.priority = 'high';
    encoding.networkPriority = 'high';
  }
  await sender.setParameters(parameters);
  return true;
}
