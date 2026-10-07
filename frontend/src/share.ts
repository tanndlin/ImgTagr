import type { Image } from './api'

const MAX_SHARE_IMAGES = 50

// On phones the share sheet saves straight to Photos, where a zip would land in Files
export function prefersShare(count: number) {
  return (
    count <= MAX_SHARE_IMAGES && 'canShare' in navigator && matchMedia('(pointer: coarse)').matches
  )
}

export async function fetchImageFiles(images: Image[]): Promise<File[]> {
  return Promise.all(
    images.map(async (image) => {
      const res = await fetch(image.url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const name = image.original_filename ?? image.url.split('/').pop() ?? image.id
      return new File([await res.blob()], name, { type: image.content_type })
    }),
  )
}
