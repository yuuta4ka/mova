const clampLevel = (value: number) => Math.max(0.12, Math.min(1, value));

export function normalizeVoiceWaveform(samples: number[], targetSize = 40) {
  const size = Math.max(8, Math.min(96, Math.round(targetSize)));
  const source = samples.filter(Number.isFinite).map(clampLevel);
  if (!source.length) return Array.from({ length: size }, (_, index) => 0.28 + ((index * 7) % 5) * 0.06);
  if (source.length === 1) return Array(size).fill(Math.round(source[0] * 100) / 100);

  const resampled = source.length >= size
    ? Array.from({ length: size }, (_, index) => {
        const start = Math.floor((index * source.length) / size);
        const end = Math.max(start + 1, Math.ceil(((index + 1) * source.length) / size));
        return Math.max(...source.slice(start, end));
      })
    : Array.from({ length: size }, (_, index) => {
        const position = (index * (source.length - 1)) / Math.max(1, size - 1);
        const left = Math.floor(position);
        const right = Math.min(source.length - 1, left + 1);
        const mix = position - left;
        return source[left] * (1 - mix) + source[right] * mix;
      });

  return resampled.map((value) => Math.round(clampLevel(value) * 100) / 100);
}
