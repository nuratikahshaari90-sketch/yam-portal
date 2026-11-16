import { supabase, FILES_BUCKET } from './supabase'

export interface PickedFile {
  id: string
  blob: Blob
  contentType: string
  name: string
  previewUrl: string
}

/** Shrink photos to max 1600px JPEG so uploads are small on mobile data. PDFs are kept as-is. */
export async function prepareFile(file: File): Promise<PickedFile> {
  const id = crypto.randomUUID()
  if (file.type === 'application/pdf') {
    return { id, blob: file, contentType: file.type, name: file.name, previewUrl: '' }
  }
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo or a PDF file.')
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not read photo'))), 'image/jpeg', 0.8))
    return { id, blob, contentType: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg', previewUrl: URL.createObjectURL(blob) }
  } catch {
    // Some formats (e.g. HEIC on older browsers) cannot be resized: upload the original.
    return { id, blob: file, contentType: file.type || 'image/jpeg', name: file.name, previewUrl: '' }
  }
}

export function storagePath(staffId: string, folder: 'leave' | 'receipts', f: PickedFile): string {
  const ext = f.contentType === 'application/pdf' ? 'pdf' : f.contentType === 'image/png' ? 'png' : 'jpg'
  return `${staffId}/${folder}/${f.id}.${ext}`
}

export async function openStoredFile(path: string) {
  const w = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, 300)
  if (error || !data) {
    w?.close()
    throw error ?? new Error('Could not open file')
  }
  if (w) w.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}
