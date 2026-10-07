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
  taken_at: string | null
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
  taken_newest: 'Taken, newest first',
  taken_oldest: 'Taken, oldest first',
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

// Limits and formats the API enforces
export const MAX_TAG_LENGTH = 64
export const MAX_PROFILE_NAME_LENGTH = 32
export const MAX_FILENAME_LENGTH = 255
export const MAX_UPLOAD_MB = 100
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

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

// Shared by fetch and XHR responses
function settle<T>(status: number, body: { error?: string } | null): T {
  if (status === 401) {
    window.dispatchEvent(new Event(SIGNED_OUT))
  }

  if (status < 200 || status >= 300) {
    throw new Error(body?.error ?? `HTTP ${status}`)
  }

  return body as T
}

async function parse<T>(res: Response): Promise<T> {
  return settle(res.status, await readJson(res))
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export type ImagePage = {
  images: Image[]
  // Pass back as `after` for the next page; null on the last page
  next: string | null
}

export async function listImages(
  { tagIds, search, untagged, sort }: Filter,
  after?: string,
): Promise<ImagePage> {
  const params = new URLSearchParams()
  if (tagIds.length) {
    params.set('tags', tagIds.join(','))
  }

  if (search) {
    params.set('q', search)
  }

  if (untagged) {
    params.set('untagged', 'true')
  }

  if (sort !== DEFAULT_SORT) {
    params.set('sort', sort)
  }

  if (after) {
    params.set('after', after)
  }

  return parse(await fetch(`/api/images?${params}`))
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
export function uploadImage(
  file: File,
  maxSize: number | null,
  onProgress?: (fraction: number) => void,
): Promise<Image> {
  const form = new FormData()
  if (maxSize) {
    form.append('max_size', String(maxSize))
  }

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
      try {
        resolve(settle(xhr.status, parseJson(xhr.responseText)))
      } catch (err) {
        reject(err)
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

export async function updateImage(
  id: string,
  changes: { original_filename: string },
): Promise<Image> {
  return parse(await fetch(`/api/images/${id}`, jsonInit('PATCH', changes)))
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
