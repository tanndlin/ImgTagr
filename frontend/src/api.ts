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
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
}

export async function listImages(): Promise<Image[]> {
  return parse(await fetch('/api/images'))
}

export async function uploadImage(file: File): Promise<Image> {
  const form = new FormData()
  form.append('file', file)
  return parse(await fetch('/api/images', { method: 'POST', body: form }))
}
