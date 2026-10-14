import type { ImageAttachment } from '@shared/types'
import { fitWithin } from '@shared/window'

export const MAX_ATTACHMENTS = 4

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Shrinks a pasted or dropped image to a sensible size and re-encodes it as JPEG. */
export async function imageToAttachment(blob: Blob, maxEdge = 1920): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(blob)
  const size = fitWithin({ width: bitmap.width, height: bitmap.height }, maxEdge)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that image.')
  // Transparent PNGs would turn black as JPEG; give them a white page.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
  return { mediaType: 'image/jpeg', data: toBase64(await out.arrayBuffer()) }
}

export function imagesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const item of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null
    if (file && file.type.startsWith('image/')) files.push(file)
  }
  return files
}

export function dataUrl(a: ImageAttachment): string {
  return `data:${a.mediaType};base64,${a.data}`
}
