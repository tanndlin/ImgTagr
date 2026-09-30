export type Tag = {
  id: string
  name: string
  color: string
}

export type TagSummary = Tag & {
  image_count: number
}

export type Image = {
  id: string
  url: string
  thumbnail_url: string
  original_filename: string | null
  content_type: string
  size_bytes: number
  width: number
  height: number
  created_at: string
  tags: Tag[]
}

export type Stats = {
  image_count: number
  total_bytes: number
  untagged_count: number
}

export type Filter = {
  tagIds: string[]
  search: string
  untagged: boolean
}

export const MAX_TAG_LENGTH = 64

// Tolerates empty bodies (204) by resolving to null
async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const PAGE_SIZE = 100

export async function listImages({ tagIds, search, untagged }: Filter, after?: Image): Promise<Image[]> {
  const params = [`limit=${PAGE_SIZE}`]
  if (tagIds.length) params.push(`tags=${tagIds.map(encodeURIComponent).join(',')}`)
  if (search) params.push(`q=${encodeURIComponent(search)}`)
  if (untagged) params.push('untagged=true')
  if (after) params.push(`before=${encodeURIComponent(after.created_at)}`, `before_id=${after.id}`)
  return parse(await fetch(`/api/images?${params.join('&')}`))
}

export function matchesFilter(image: Image, { tagIds, search, untagged }: Filter) {
  const q = search.toLowerCase()
  return (
    tagIds.every((id) => image.tags.some((t) => t.id === id)) &&
    (!untagged || image.tags.length === 0) &&
    [image.original_filename ?? '', ...image.tags.map((t) => t.name)].some((s) => s.toLowerCase().includes(q))
  )
}

export async function getStats(): Promise<Stats> {
  return parse(await fetch('/api/images/stats'))
}

export async function uploadImage(file: File): Promise<Image> {
  const form = new FormData()
  form.append('file', file)
  return parse(await fetch('/api/images', { method: 'POST', body: form }))
}

export async function listTags(): Promise<TagSummary[]> {
  return parse(await fetch('/api/tags'))
}

export async function deleteImages(imageIds: string[]): Promise<void> {
  await parse(await fetch('/api/images/delete', jsonInit('POST', { image_ids: imageIds })))
}

// A native form POST lets the browser stream the download instead of buffering it in memory
export function downloadImages(imageIds: string[]) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/images/download'
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'ids'
  input.value = imageIds.join(',')
  form.append(input)
  document.body.append(form)
  form.submit()
  form.remove()
}

const MAX_SHARE_IMAGES = 50

// On phones the share sheet saves straight to Photos, where a zip would land in Files
export function prefersShare(count: number) {
  return count <= MAX_SHARE_IMAGES && 'canShare' in navigator && matchMedia('(pointer: coarse)').matches
}

export async function fetchImageFiles(images: Image[]): Promise<File[]> {
  return Promise.all(
    images.map(async (image) => {
      const res = await fetch(image.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const name = image.original_filename ?? image.url.split('/').pop() ?? image.id
      return new File([await res.blob()], name, { type: image.content_type })
    }),
  )
}

export async function addTagToImages(imageIds: string[], name: string): Promise<Tag> {
  return parse(await fetch('/api/images/tags', jsonInit('POST', { image_ids: imageIds, name })))
}

export async function removeTag(imageId: string, tagId: string): Promise<void> {
  await parse(await fetch(`/api/images/${imageId}/tags/${tagId}`, { method: 'DELETE' }))
}

export async function updateTag(id: string, changes: { name?: string; color?: string }): Promise<Tag> {
  return parse(await fetch(`/api/tags/${id}`, jsonInit('PATCH', changes)))
}

export async function mergeTag(id: string, into: string): Promise<Tag> {
  return parse(await fetch(`/api/tags/${id}/merge`, jsonInit('POST', { into })))
}

export async function deleteTag(id: string): Promise<void> {
  await parse(await fetch(`/api/tags/${id}`, { method: 'DELETE' }))
}
