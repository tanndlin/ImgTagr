import type { Filter, Image, Sort } from './api'

const byName = (image: Image) => (image.original_filename ?? '').toLowerCase()
const bySize = (image: Image) => image.size_bytes
const byUpload = (image: Image) => Date.parse(image.created_at)
const byTaken = (image: Image) => Date.parse(image.taken_at ?? image.created_at)

// Mirrors the API's ordering: the sort key, then id
const SORT_KEYS: Record<Sort, [key: (image: Image) => string | number, descending: boolean]> = {
  newest: [byUpload, true],
  oldest: [byUpload, false],
  name_asc: [byName, false],
  name_desc: [byName, true],
  largest: [bySize, true],
  smallest: [bySize, false],
  taken_newest: [byTaken, true],
  taken_oldest: [byTaken, false],
}

function compareImages(a: Image, b: Image, sort: Sort) {
  const [key, descending] = SORT_KEYS[sort]
  const [x, y] = [key(a), key(b)]
  const order = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
  const result = order || a.id.localeCompare(b.id)
  return descending ? -result : result
}

// Where image belongs among sorted images, or -1 when it falls past the end
export function sortedIndex(images: Image[], image: Image, sort: Sort) {
  return images.findIndex((i) => compareImages(image, i, sort) < 0)
}

export function matchesFilter(image: Image, { tagIds, search, untagged }: Filter) {
  const q = search.toLowerCase()
  return (
    tagIds.every((id) => image.tags.some((t) => t.id === id)) &&
    (!untagged || image.tags.length === 0) &&
    [image.original_filename ?? '', ...image.tags.map((t) => t.name)].some((s) =>
      s.toLowerCase().includes(q),
    )
  )
}
