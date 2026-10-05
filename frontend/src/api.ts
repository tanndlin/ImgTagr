export type Profile = {
  id: string
  name: string
}

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

export const SORTS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
  largest: 'Largest first',
  smallest: 'Smallest first',
} as const

export type Sort = keyof typeof SORTS

export const DEFAULT_SORT: Sort = 'newest'

export const isSort = (value: string | null): value is Sort =>
  value !== null && Object.hasOwn(SORTS, value)

export type Filter = {
  tagIds: string[]
  search: string
  untagged: boolean
  sort: Sort
}

export const MAX_TAG_LENGTH = 64

// Fired when the API says the session is gone, so the app returns to the profile picker
export const SIGNED_OUT = 'imgtagr:signed-out'

// Tolerates empty bodies (204) by resolving to null
async function readJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = await readJson(res)
  if (res.status === 401) {
    window.dispatchEvent(new Event(SIGNED_OUT))
  }

  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }

  return body as T
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const PAGE_SIZE = 100

function sortValue(image: Image, sort: Sort) {
  if (sort === 'name_asc' || sort === 'name_desc') {
    return image.original_filename ?? ''
  }

  if (sort === 'largest' || sort === 'smallest') {
    return String(image.size_bytes)
  }

  return image.created_at
}

export async function listImages(
  { tagIds, search, untagged, sort }: Filter,
  after?: Image,
): Promise<Image[]> {
  const params = [`limit=${PAGE_SIZE}`]
  if (tagIds.length) {
    params.push(`tags=${tagIds.map(encodeURIComponent).join(',')}`)
  }

  if (search) {
    params.push(`q=${encodeURIComponent(search)}`)
  }

  if (untagged) {
    params.push('untagged=true')
  }

  if (sort !== DEFAULT_SORT) {
    params.push(`sort=${sort}`)
  }

  if (after) {
    params.push(`after=${encodeURIComponent(sortValue(after, sort))}`, `after_id=${after.id}`)
  }

  return parse(await fetch(`/api/images?${params.join('&')}`))
}

// Mirrors the API's ordering: the sort key, then id
function compareImages(a: Image, b: Image, sort: Sort) {
  const key = (image: Image) => {
    if (sort === 'name_asc' || sort === 'name_desc') {
      return (image.original_filename ?? '').toLowerCase()
    }

    if (sort === 'largest' || sort === 'smallest') {
      return image.size_bytes
    }

    return Date.parse(image.created_at)
  }
  const [x, y] = [key(a), key(b)]
  const order = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
  const result = order || a.id.localeCompare(b.id)
  return sort === 'newest' || sort === 'name_desc' || sort === 'largest' ? -result : result
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

export async function getStats(): Promise<Stats> {
  return parse(await fetch('/api/images/stats'))
}

const parseJson = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// XHR because fetch can't report upload progress
export function uploadImage(file: File, onProgress?: (fraction: number) => void): Promise<Image> {
  const form = new FormData()
  form.append('file', file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/images')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(e.loaded / e.total)
      }
    }
    xhr.upload.onload = () => onProgress?.(1)
    xhr.onload = () => {
      const body = parseJson(xhr.responseText)
      if (xhr.status === 401) {
        window.dispatchEvent(new Event(SIGNED_OUT))
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body)
      } else {
        reject(new Error(body?.error ?? `HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    xhr.send(form)
  })
}

export async function getSession(): Promise<Profile | null> {
  const res = await fetch('/api/session')
  return res.status === 401 ? null : parse(res)
}

export async function listProfiles(): Promise<Profile[]> {
  return parse(await fetch('/api/profiles'))
}

export async function createProfile(name: string, password: string): Promise<Profile> {
  return parse(await fetch('/api/profiles', jsonInit('POST', { name, password })))
}

export async function signIn(id: string, password: string): Promise<Profile> {
  return parse(await fetch(`/api/profiles/${id}/login`, jsonInit('POST', { password })))
}

export async function signOut(): Promise<void> {
  await parse(await fetch('/api/session', { method: 'DELETE' }))
}

export async function listTags(): Promise<TagSummary[]> {
  return parse(await fetch('/api/tags'))
}

export async function deleteImages(imageIds: string[]): Promise<void> {
  await parse(await fetch('/api/images/delete', jsonInit('POST', { image_ids: imageIds })))
}

// A native form POST lets the browser stream the download instead of buffering it in memory
function postDownload(action: string, fields: Record<string, string> = {}) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
  form.remove()
}

export function downloadImages(imageIds: string[]) {
  postDownload('/api/images/download', { ids: imageIds.join(',') })
}

// Files are named after the tag: tag_1.jpg, tag_2.png…
export function downloadTag(id: string) {
  postDownload(`/api/tags/${id}/download`)
}

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

export async function addTagToImages(imageIds: string[], name: string): Promise<Tag> {
  return parse(await fetch('/api/images/tags', jsonInit('POST', { image_ids: imageIds, name })))
}

export async function removeTag(imageId: string, tagId: string): Promise<void> {
  await parse(await fetch(`/api/images/${imageId}/tags/${tagId}`, { method: 'DELETE' }))
}

export async function updateTag(
  id: string,
  changes: { name?: string; color?: string },
): Promise<Tag> {
  return parse(await fetch(`/api/tags/${id}`, jsonInit('PATCH', changes)))
}

export async function mergeTag(id: string, into: string): Promise<Tag> {
  return parse(await fetch(`/api/tags/${id}/merge`, jsonInit('POST', { into })))
}

export async function deleteTag(id: string): Promise<void> {
  await parse(await fetch(`/api/tags/${id}`, { method: 'DELETE' }))
}
