export interface ImageCompressionOptions {
  maxDimension?: number;
  maxBytes?: number;
  quality?: number;
  skipBelowBytes?: number;
}

export interface ImageCrop {
  x: number;
  y: number;
  zoom: number;
}

export interface ImageCropOptions {
  outputSize?: number;
  maxBytes?: number;
  quality?: number;
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

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const imageSizeLabel = (bytes: number) => bytes >= 1_000_000 ? `${Math.round(bytes / 100_000) / 10} МБ` : `${Math.round(bytes / 1_000)} КБ`;

async function decodeImage(file: File) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(bitmap, 0, 0, width, height),
      drawCrop: (context: CanvasRenderingContext2D, sourceX: number, sourceY: number, sourceSize: number, outputSize: number) => context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize),
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
    drawCrop: (context: CanvasRenderingContext2D, sourceX: number, sourceY: number, sourceSize: number, outputSize: number) => context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize),
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
    // Re-encoding a compact original can make it larger. An image that already
    // satisfies the requested payload limit must never fail compression.
    if (!compressed || compressed.size > maxBytes) {
      if (file.size <= maxBytes) return file;
      throw new Error(`Изображение не удалось подготовить до ${imageSizeLabel(maxBytes)}`);
    }
    // Do not introduce a lossy generation when it barely changes the payload.
    if (scale === 1 && compressed.size > file.size * 0.9) return file;
    return new File([compressed], outputName(file.name, compressed.type), { type: compressed.type, lastModified: file.lastModified });
  } finally {
    decoded.close();
  }
}

export async function cropImageFile(file: File, crop: ImageCrop, options: ImageCropOptions = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения');
  const outputSize = options.outputSize ?? 1024;
  const maxBytes = options.maxBytes ?? 650_000;
  const zoom = clamp(crop.zoom, 1, 3);
  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new Error('Не удалось открыть изображение. Попробуйте другой файл');
  }
  try {
    const sourceSize = Math.min(decoded.width, decoded.height) / zoom;
    const sourceX = (decoded.width - sourceSize) * (1 - clamp(crop.x, -1, 1)) / 2;
    const sourceY = (decoded.height - sourceSize) * (1 - clamp(crop.y, -1, 1)) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Не удалось обработать изображение');
    const qualities = [options.quality ?? 0.92, 0.86, 0.78, 0.68, 0.58];
    const outputSizes = [...new Set([outputSize, Math.round(outputSize * 0.875), Math.round(outputSize * 0.75), Math.round(outputSize * 0.625), Math.round(outputSize * 0.5)])];
    let cropped: Blob | null = null;
    for (const size of outputSizes) {
      canvas.width = size;
      canvas.height = size;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      decoded.drawCrop(context, sourceX, sourceY, sourceSize, size);
      for (const quality of qualities) {
        cropped = await canvasBlob(canvas, 'image/webp', quality);
        if (cropped && cropped.size <= maxBytes) break;
      }
      if (cropped && cropped.size <= maxBytes) break;
    }
    if (!cropped || cropped.size > maxBytes) throw new Error(`Аватар не удалось подготовить до ${imageSizeLabel(maxBytes)}`);
    return new File([cropped], outputName(file.name, cropped.type), { type: cropped.type, lastModified: file.lastModified });
  } finally {
    decoded.close();
  }
}

export async function prepareImageDataUrl(file: File, options?: ImageCompressionOptions) {
  const prepared = await compressImageFile(file, options);
  return { file: prepared, dataUrl: await fileToDataUrl(prepared) };
}
