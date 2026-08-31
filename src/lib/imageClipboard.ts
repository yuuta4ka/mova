const imageBlobFromSource = async (source: string) => {
  const response = await fetch(source, source.startsWith('data:') ? undefined : { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Не удалось загрузить изображение');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Источник не является изображением');
  return blob;
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Не удалось прочитать изображение'));
  reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать изображение'));
  reader.readAsDataURL(blob);
});

const loadBitmapImage = async (blob: Blob) => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context: CanvasRenderingContext2D) => context.drawImage(bitmap, 0, 0),
      close: () => bitmap.close(),
    };
  }
  const source = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Не удалось декодировать изображение'));
      image.src = source;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context: CanvasRenderingContext2D) => context.drawImage(image, 0, 0),
      close: () => URL.revokeObjectURL(source),
    };
  } catch (error) {
    URL.revokeObjectURL(source);
    throw error;
  }
};

const pngBlob = async (blob: Blob) => {
  if (blob.type === 'image/png') return blob;
  const image = await loadBitmapImage(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение');
    image.draw(context);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Не удалось подготовить изображение')), 'image/png'));
  } finally {
    image.close();
  }
};

export async function copyImageToClipboard(source: string) {
  if (!source) throw new Error('Изображение недоступно');
  const desktopClipboard = window.movaDesktopShell?.writeClipboardImage;
  if (desktopClipboard) {
    const sourceBlob = await imageBlobFromSource(source);
    const dataUrl = await blobToDataUrl(await pngBlob(sourceBlob));
    const copied = await desktopClipboard(dataUrl);
    if (!copied) throw new Error('Системный буфер обмена не принял изображение');
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Копирование изображений недоступно');
  const image = imageBlobFromSource(source).then(pngBlob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}
