import { useEffect, useEffectEvent, useState } from 'react'
import { uploadImage, type Image } from '../api'
import { useStats } from '../context/stats'
import { message } from '../message'

const MAX_CONCURRENT_UPLOADS = 3
const PASTE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_SIZE_KEY = 'uploadMaxSize'
export const MAX_SIZES = [4096, 2560, 1920, 1280]
let nextUploadKey = 0

function storedMaxSize() {
  try {
    const size = Number(localStorage.getItem(MAX_SIZE_KEY))
    return MAX_SIZES.includes(size) ? size : null
  } catch {
    return null
  }
}

export type Upload = {
  key: string
  name: string
  status: 'uploading' | 'done' | 'error'
  progress: number
  error?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

// Clipboard images all arrive as image.png, so name them after the paste time
function namePasted(file: File) {
  const ext = /^image\.(\w+)$/i.exec(file.name)?.[1]
  if (!ext) {
    return file
  }

  const d = new Date()
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type })
}

export function useUploads(onUploaded: (image: Image) => void) {
  const { refreshStats } = useStats()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [maxSize, setMaxSizeState] = useState(storedMaxSize)

  function setMaxSize(size: number | null) {
    setMaxSizeState(size)
    try {
      localStorage.setItem(MAX_SIZE_KEY, String(size ?? ''))
    } catch {}
  }

  const updateUpload = (key: string, patch: Partial<Upload>) =>
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)))

  async function uploadFiles(files: File[]) {
    const queue = files.map((file) => ({ file, key: String(nextUploadKey++) }))
    const rows = queue.map(({ file, key }): Upload => ({
      key,
      name: file.name,
      status: 'uploading',
      progress: 0,
    }))
    setUploads((prev) => [...rows, ...prev])

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { key } = next
        let percent = 0
        const onProgress = (fraction: number) => {
          const p = Math.floor(fraction * 100)
          if (p === percent) {
            return
          }

          percent = p
          updateUpload(key, { progress: p / 100 })
        }

        try {
          onUploaded(await uploadImage(next.file, maxSize, onProgress))
          updateUpload(key, { status: 'done' })
        } catch (err) {
          updateUpload(key, { status: 'error', error: message(err) })
        }
      }
    }

    await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker))
    refreshStats()
  }

  const onPaste = useEffectEvent(uploadFiles)

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        PASTE_TYPES.includes(f.type),
      )
      if (!files.length) {
        return
      }

      e.preventDefault()
      onPaste(files.map(namePasted))
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])

  return { uploads, uploadFiles, maxSize, setMaxSize }
}
