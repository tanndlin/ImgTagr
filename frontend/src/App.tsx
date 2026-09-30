import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  addTagToImages,
  deleteImages,
  deleteTag,
  downloadImages,
  listImages,
  listTags,
  MAX_TAG_LENGTH,
  removeTag,
  renameTag,
  uploadImage,
  type Image,
  type Tag,
  type TagSummary,
} from './api'
import { debugLog } from './debugLog'
import { ImageTags, TAG_NAMES_LIST_ID } from './ImageTags'
import { SelectionBar } from './SelectionBar'
import { TagFilter } from './TagFilter'

const MAX_CONCURRENT_UPLOADS = 3
let nextUploadKey = 0
let nextPendingTagId = 0

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
const sortTags = <T extends Tag>(tags: T[]) => [...tags].sort(byName)
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function readTagsParam() {
  return new URLSearchParams(window.location.search).get('tags')?.split(',').filter(Boolean) ?? []
}

function writeTagsParam(ids: string[]) {
  const params = new URLSearchParams(window.location.search)
  if (ids.length) params.set('tags', ids.join(','))
  else params.delete('tags')
  const query = params.toString().replace(/%2C/g, ',')
  history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

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
  const [tags, setTags] = useState<TagSummary[]>([])
  const [selected, setSelected] = useState<string[]>(readTagsParam)
  const selectedRef = useRef(selected)
  const tagsRequest = useRef(0)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const lastPicked = useRef<string>(undefined)
  const pickedImages = images.filter((i) => picked.has(i.id))

  useEffect(() => {
    selectedRef.current = selected
    writeTagsParam(selected)
    let stale = false
    listImages(selected)
      .then((result) => !stale && setImages(result))
      .catch((err) => !stale && setError(`Couldn't load images: ${message(err)}`))
    return () => {
      stale = true
    }
  }, [selected])

  // Ignores responses that a newer request has superseded
  async function fetchTags() {
    const request = ++tagsRequest.current
    const result = await listTags()
    return request === tagsRequest.current ? result : undefined
  }

  const tagsError = (err: unknown) => setError(`Couldn't load tags: ${message(err)}`)

  function refreshTags() {
    fetchTags()
      .then((result) => result && setTags(result))
      .catch(tagsError)
  }

  useEffect(() => {
    fetchTags()
      .then((result) => {
        if (!result) return
        setTags(result)
        const known = new Set(result.map((t) => t.id))
        setSelected((prev) => (prev.every((id) => known.has(id)) ? prev : prev.filter((id) => known.has(id))))
      })
      .catch(tagsError)
  }, [])

  useEffect(() => {
    const clearPicked = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setPicked(new Set())
    }
    window.addEventListener('keydown', clearPicked)
    return () => window.removeEventListener('keydown', clearPicked)
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
          const matches = selectedRef.current.every((id) => image.tags.some((t) => t.id === id))
          if (matches) setImages((prev) => [image, ...prev.filter((i) => i.id !== image.id)])
          updateUpload(next.key, { status: 'done' })
        } catch (err) {
          debugLog('upload failed', String(err))
          updateUpload(next.key, { status: 'error', error: (err as Error).message })
        }
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker))
  }

  const patchImageTags = (imageIds: string[], update: (tags: Tag[]) => Tag[]) =>
    setImages((prev) => prev.map((i) => (imageIds.includes(i.id) ? { ...i, tags: update(i.tags) } : i)))

  async function tagImages(targets: Image[], name: string) {
    if (name.length > MAX_TAG_LENGTH) return setError(`Tag names can be at most ${MAX_TAG_LENGTH} characters`)
    const lower = name.toLowerCase()
    const ids = targets.filter((i) => !i.tags.some((t) => t.name.toLowerCase() === lower)).map((i) => i.id)
    if (!ids.length) return
    const pendingId = `pending-${nextPendingTagId++}`
    patchImageTags(ids, (prev) => sortTags([...prev, { id: pendingId, name }]))
    try {
      const tag = await addTagToImages(ids, name)
      patchImageTags(ids, (prev) =>
        sortTags([...prev.filter((t) => t.id !== pendingId && t.id !== tag.id), tag]),
      )
    } catch (err) {
      patchImageTags(ids, (prev) => prev.filter((t) => t.id !== pendingId))
      setError(`Couldn't add tag: ${message(err)}`)
    }
    refreshTags()
  }

  async function removeImageTag(image: Image, tag: Tag) {
    patchImageTags([image.id], (prev) => prev.filter((t) => t.id !== tag.id))
    try {
      await removeTag(image.id, tag.id)
    } catch (err) {
      patchImageTags([image.id], (prev) => (prev.some((t) => t.id === tag.id) ? prev : sortTags([...prev, tag])))
      setError(`Couldn't remove tag: ${message(err)}`)
    }
    refreshTags()
  }

  async function onRenameTag(tag: TagSummary) {
    const name = prompt('Rename tag', tag.name)?.trim()
    if (!name || name === tag.name) return
    if (name.length > MAX_TAG_LENGTH) return setError(`Tag names can be at most ${MAX_TAG_LENGTH} characters`)
    try {
      const renamed = await renameTag(tag.id, name)
      const rename = <T extends Tag>(t: T) => (t.id === renamed.id ? { ...t, name: renamed.name } : t)
      setTags((prev) => sortTags(prev.map(rename)))
      setImages((prev) => prev.map((i) => ({ ...i, tags: sortTags(i.tags.map(rename)) })))
    } catch (err) {
      setError(`Couldn't rename tag: ${message(err)}`)
    }
  }

  async function onDeleteTag(tag: TagSummary) {
    if (!confirm(`Delete tag "${tag.name}" from all images?`)) return
    try {
      await deleteTag(tag.id)
      setTags((prev) => prev.filter((t) => t.id !== tag.id))
      setImages((prev) => prev.map((i) => ({ ...i, tags: i.tags.filter((t) => t.id !== tag.id) })))
      setSelected((prev) => (prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : prev))
    } catch (err) {
      setError(`Couldn't delete tag: ${message(err)}`)
    }
  }

  async function onDeleteImages(targets: Image[]) {
    const noun = targets.length === 1 ? 'this image' : `these ${targets.length} images`
    if (!confirm(`Permanently delete ${noun}?`)) return
    const ids = new Set(targets.map((i) => i.id))
    try {
      await deleteImages([...ids])
      setImages((prev) => prev.filter((i) => !ids.has(i.id)))
      setPicked((prev) => new Set([...prev].filter((id) => !ids.has(id))))
    } catch (err) {
      setError(`Couldn't delete images: ${message(err)}`)
    }
    refreshTags()
  }

  // Shift extends from the last clicked image, setting the whole range to the clicked image's new state
  function togglePick(image: Image, extend: boolean) {
    const anchor = extend ? images.findIndex((i) => i.id === lastPicked.current) : -1
    lastPicked.current = image.id
    setPicked((prev) => {
      const next = new Set(prev)
      const on = !prev.has(image.id)
      const index = images.indexOf(image)
      const range = anchor === -1 ? [image] : images.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
      for (const i of range) {
        if (on) next.add(i.id)
        else next.delete(i.id)
      }
      return next
    })
  }

  const toggleFilter = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))

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

      <TagFilter
        tags={tags}
        selected={selected}
        onToggle={toggleFilter}
        onClear={() => setSelected([])}
        onRename={onRenameTag}
        onDelete={onDeleteTag}
      />

      <datalist id={TAG_NAMES_LIST_ID}>
        {tags.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>

      {images.length === 0 && !error ? (
        <p className="empty">{selected.length ? 'No images have all of these tags.' : 'No images yet.'}</p>
      ) : (
        <ul className={`gallery${pickedImages.length ? ' picking' : ''}`}>
          {images.map((image) => (
            <li key={image.id} className={picked.has(image.id) ? 'picked' : undefined}>
              <div className="thumb">
                <a
                  href={image.url}
                  target="_blank"
                  rel="noreferrer"
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onClick={(e) => {
                    if (!pickedImages.length && !e.ctrlKey && !e.metaKey && !e.shiftKey) return
                    e.preventDefault()
                    togglePick(image, e.shiftKey)
                  }}
                >
                  <img
                    src={image.thumbnail_url}
                    alt={image.original_filename ?? ''}
                    loading="lazy"
                  />
                </a>
                <input
                  type="checkbox"
                  className="pick"
                  aria-label={`Select ${image.original_filename ?? 'image'}`}
                  checked={picked.has(image.id)}
                  onChange={(e) => togglePick(image, (e.nativeEvent as MouseEvent).shiftKey)}
                />
              </div>
              <span className="caption" title={image.original_filename ?? undefined}>
                {image.original_filename ?? 'Untitled'}
              </span>
              <ImageTags
                tags={image.tags}
                onAdd={(name) => tagImages([image], name)}
                onRemove={(tag) => removeImageTag(image, tag)}
              />
            </li>
          ))}
        </ul>
      )}

      {pickedImages.length > 0 && (
        <SelectionBar
          images={pickedImages}
          total={images.length}
          onAddTag={(name) => tagImages(pickedImages, name)}
          onDownload={() => downloadImages(pickedImages.map((i) => i.id))}
          onDownloadError={(err) => setError(`Couldn't download images: ${message(err)}`)}
          onDelete={() => onDeleteImages(pickedImages)}
          onSelectAll={() => setPicked(new Set(images.map((i) => i.id)))}
          onClear={() => setPicked(new Set())}
        />
      )}
    </main>
  )
}

export default App
