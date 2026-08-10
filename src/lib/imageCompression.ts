export interface ImageCompressionOptions {
  maxDimension?: number;
  maxBytes?: number;
  quality?: number;
  skipBelowBytes?: number;
}

export const fileToDataUrl = (file?: Blob) =>
  new Promise<string>((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

async function decodeImage(file: File) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(bitmap, 0, 0, width, height),
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Не удалось декодировать изображение'));
    image.src = url;
  });
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(image, 0, 0, width, height),
    close: () => URL.revokeObjectURL(url),
  };
}

function outputName(name: string, type: string) {
  const extension = type === 'image/webp' ? '.webp' : type === 'image/jpeg' ? '.jpg' : '.png';
  return `${name.replace(/\.[^.]+$/, '') || 'image'}${extension}`;
}

export async function compressImageFile(file: File, options: ImageCompressionOptions = {}) {
  if (!file.type.startsWith('image/') || ['image/gif', 'image/svg+xml'].includes(file.type)) return file;
  const maxDimension = options.maxDimension ?? 4096;
  const maxBytes = options.maxBytes ?? 7_500_000;
  const skipBelowBytes = options.skipBelowBytes ?? 350_000;
  if (file.size <= skipBelowBytes) return file;

  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    decoded.draw(context, width, height);

    const outputType = 'image/webp';
    const qualities = [options.quality ?? 0.93, 0.9, 0.86, 0.82];
    let compressed: Blob | null = null;
    for (const quality of qualities) {
      compressed = await canvasBlob(canvas, outputType, quality);
      if (compressed && compressed.size <= maxBytes) break;
    }
    if (!compressed || compressed.size > maxBytes) throw new Error('Изображение не удалось сжать до 8 МБ');
    // Do not introduce a lossy generation when it barely changes the payload.
    if (scale === 1 && compressed.size > file.size * 0.9) return file;
    return new File([compressed], outputName(file.name, compressed.type), { type: compressed.type, lastModified: file.lastModified });
  } finally {
    decoded.close();
  }
}

export async function prepareImageDataUrl(file: File, options?: ImageCompressionOptions) {
  const prepared = await compressImageFile(file, options);
  return { file: prepared, dataUrl: await fileToDataUrl(prepared) };
}
