import { useEffect, useState, type DragEvent } from 'react'
import { listImages, uploadImage, type Image } from './api'
import { debugLog } from './debugLog'

const MAX_CONCURRENT_UPLOADS = 3
let nextUploadKey = 0

type Upload = {
  key: string
  name: string
  status: 'uploading' | 'done' | 'error'
  error?: string
}

function App() {
  const [images, setImages] = useState<Image[]>([])
  const [error, setError] = useState<string>()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    listImages()
      .then(setImages)
      .catch((err) => setError(`Couldn't load images: ${err.message}`))
  }, [])

  useEffect(() => {
    const show = (e: ErrorEvent | PromiseRejectionEvent) =>
      setError(String('reason' in e ? e.reason : e.message))
    window.addEventListener('error', show)
    window.addEventListener('unhandledrejection', show)
    return () => {
      window.removeEventListener('error', show)
      window.removeEventListener('unhandledrejection', show)
    }
  }, [])

  const updateUpload = (key: string, patch: Partial<Upload>) =>
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)))

  async function uploadFiles(files: File[]) {
    debugLog('uploadFiles', files.map((f) => ({ name: f.name, type: f.type, size: f.size })))
    const queue = files.map((file) => ({ file, key: String(nextUploadKey++) }))
    setUploads((prev) => [
      ...queue.map(({ file, key }) => ({ key, name: file.name, status: 'uploading' as const })),
      ...prev,
    ])

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const image = await uploadImage(next.file)
          setImages((prev) => [image, ...prev.filter((i) => i.id !== image.id)])
          updateUpload(next.key, { status: 'done' })
        } catch (err) {
          debugLog('upload failed', String(err))
          updateUpload(next.key, { status: 'error', error: (err as Error).message })
        }
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    uploadFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <main>
      <header>
        <h1>ImgTagr</h1>
      </header>

      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <strong>Drop images here</strong> or click to choose
        <span className="hint">JPEG, PNG, WebP or GIF, up to 25 MB</span>
        <input
          type="file"
          className="visually-hidden"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(e) => {
            debugLog('onChange', e.target.files?.length)
            uploadFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </label>

      {uploads.length > 0 && (
        <ul className="uploads">
          {uploads.map((u) => (
            <li key={u.key} className={u.status}>
              <span className="name">{u.name}</span>
              <span className="status">
                {u.status === 'uploading' ? 'Uploading…' : u.status === 'done' ? 'Done' : u.error}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {images.length === 0 && !error ? (
        <p className="empty">No images yet.</p>
      ) : (
        <ul className="gallery">
          {images.map((image) => (
            <li key={image.id}>
              <a href={image.url} target="_blank" rel="noreferrer">
                <img
                  src={image.thumbnail_url}
                  alt={image.original_filename ?? ''}
                  loading="lazy"
                />
              </a>
              <span className="caption" title={image.original_filename ?? undefined}>
                {image.original_filename ?? 'Untitled'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

export default App
