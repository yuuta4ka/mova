import type { MessageAttachment } from './api';

export const imageAlbumType = 'image/album';
export const maximumAlbumImages = 10;

export function attachmentImages(attachment?: MessageAttachment | null): MessageAttachment[] {
  if (!attachment?.type.startsWith('image/')) return [];
  if (attachment.type !== imageAlbumType) return [attachment];
  return Array.isArray(attachment.items)
    ? attachment.items.filter((item) => item?.type?.startsWith('image/') && item.type !== imageAlbumType)
    : [];
}

export function attachmentPrimaryImage(attachment?: MessageAttachment | null): MessageAttachment | undefined {
  return attachmentImages(attachment)[0];
}

export function attachmentImageSource(attachment?: MessageAttachment | null): string {
  const image = attachmentPrimaryImage(attachment);
  return image?.url || image?.dataUrl || '';
}

export function attachmentSearchText(attachment?: MessageAttachment | null): string {
  if (!attachment) return '';
  return [attachment.name, ...attachmentImages(attachment).map((item) => item.name)].join(' ').toLocaleLowerCase();
}

export function photoCountLabel(count: number): string {
  const tens = count % 100;
  const units = count % 10;
  const noun = tens >= 11 && tens <= 19 ? 'фотографий' : units === 1 ? 'фотография' : units >= 2 && units <= 4 ? 'фотографии' : 'фотографий';
  return `${count} ${noun}`;
}

export function createImageAlbum(images: MessageAttachment[]): MessageAttachment {
  if (images.length === 1) return images[0];
  return {
    name: photoCountLabel(images.length),
    type: imageAlbumType,
    size: images.reduce((total, image) => total + Number(image.size || 0), 0),
    items: images,
  };
}
