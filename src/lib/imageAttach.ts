/**
 * Images the operator attaches to an assistant message. Each one is redrawn
 * on a canvas in the browser before it is sent: scaled to what Claude reads
 * (1568 px on the long edge), re-encoded as PNG or JPEG, and so stripped of
 * metadata such as a photo's location. The server checks the result again.
 */

export const MAX_ATTACHMENTS = 4
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const MAX_EDGE = 1568
/** Server limit is 1.5 MB per image; stay under it. */
const TARGET_BYTES = 1_350_000
const SOURCE_MAX_BYTES = 25_000_000

export interface Attachment {
  /** Local id (React key). */
  id: string
  mediaType: 'image/png' | 'image/jpeg'
  /** Base64 without the data: prefix. */
  data: string
  /** For the preview (CSP allows data: images). */
  dataUrl: string
  width: number
  height: number
  name: string
}

const bytesOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)

export async function prepareImage(file: File): Promise<Attachment> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) throw new Error('Attach PNG, JPEG, WebP or GIF images.')
  if (file.size > SOURCE_MAX_BYTES) throw new Error('That image is larger than 25 MB.')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read.')
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const width = Math.max(1, Math.round(bmp.width * scale))
  const height = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('That image could not be read.')
  // White behind transparent parts, so a JPEG fallback does not turn them black.
  g.fillStyle = '#fff'
  g.fillRect(0, 0, width, height)
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, width, height)
  bmp.close()

  // Screenshots stay sharp as PNG; photos (or PNGs that end up too big) go JPEG.
  let mediaType: Attachment['mediaType'] = 'image/png'
  let dataUrl = file.type === 'image/jpeg' ? '' : canvas.toDataURL('image/png')
  if (!dataUrl || bytesOf(dataUrl) > TARGET_BYTES) {
    mediaType = 'image/jpeg'
    for (const q of [0.92, 0.85, 0.75, 0.6]) {
      dataUrl = canvas.toDataURL('image/jpeg', q)
      if (bytesOf(dataUrl) <= TARGET_BYTES) break
    }
  }
  if (bytesOf(dataUrl) > TARGET_BYTES) throw new Error('That image is too large to send.')
  return {
    id: crypto.randomUUID(),
    mediaType,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    dataUrl,
    width,
    height,
    name: file.name || 'image',
  }
}

/** Image files from a paste or drop (other files are ignored). */
export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}
