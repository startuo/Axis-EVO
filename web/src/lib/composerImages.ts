import { imageMediaType, type TurnImage } from '@axis/protocol';

export const MAX_DRAFT_IMAGES = 4;
export const MAX_DRAFT_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ALL_DRAFT_IMAGE_BYTES = 16 * 1024 * 1024;

export type ImageAttachment = Omit<TurnImage, 'turnId' | 'sha256'> & { kind: 'image'; data: string };

export function draftImageUrl(image: ImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

export function turnImageUrl(image: TurnImage): string {
  return `/api/runtime/agent/turns/${encodeURIComponent(image.turnId)}/images/${image.sha256}`;
}

export async function loadDraftImage(file: File): Promise<ImageAttachment> {
  const media = imageMediaType.safeParse(file.type);
  if (!media.success) throw new Error('图片附件仅支持 PNG、JPEG 或 WebP。');
  if (file.size === 0 || file.size > MAX_DRAFT_IMAGE_BYTES) throw new Error('每张图片大小需在 0 至 2 MiB 之间。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法读取图片，请重新导出后再附加。');
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (!width || !height || width > 4096 || height > 4096) throw new Error('图片宽高各需不超过 4096 像素。');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.onload = () => {
      const prefix = `data:${media.data};base64,`;
      if (typeof reader.result === 'string' && reader.result.startsWith(prefix)) resolve(reader.result.slice(prefix.length));
      else reject(new Error('无法编码图片。'));
    };
    reader.readAsDataURL(file);
  });
  return { kind: 'image', name: (file.name.trim() || 'image').slice(0, 120), mediaType: media.data,
    sizeBytes: file.size, width, height, data };
}
