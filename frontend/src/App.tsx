import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  addTagToImages,
  deleteImages,
  deleteTag,
  downloadImages,
  getStats,
  listImages,
  listTags,
  matchesFilter,
  PAGE_SIZE,
  removeTag,
  updateTag,
  uploadImage,
  type Filter,
  type Image,
  type Stats,
  type Tag,
  type TagSummary,
} from './api'
import { Dropzone } from './Dropzone'
import { Gallery } from './Gallery'
import { TAG_NAMES_LIST_ID } from './ImageTags'
import { Lightbox } from './Lightbox'
import { SelectionBar } from './SelectionBar'
import { TagFilter } from './TagFilter'

const MAX_CONCURRENT_UPLOADS = 3
let nextUploadKey = 0
let nextPendingTagId = 0

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
const sortTags = <T extends Tag>(tags: T[]) => [...tags].sort(byName)
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${value.toFixed(exp && value < 10 ? 1 : 0)} ${units[exp]}`
}

const SEARCH_DEBOUNCE_MS = 250
const COLOR_SAVE_DEBOUNCE_MS = 400

function readTagsParam() {
  return new URLSearchParams(window.location.search).get('tags')?.split(',').filter(Boolean) ?? []
}

const readSearchParam = () => new URLSearchParams(window.location.search).get('q') ?? ''
const readUntaggedParam = () => new URLSearchParams(window.location.search).has('untagged')

const filterKey = ({ tagIds, search, untagged }: Filter) => `${tagIds.join(',')}|${search}|${untagged}`

function writeParams({ tagIds, search, untagged }: Filter) {
  const params = new URLSearchParams(window.location.search)
  if (tagIds.length) params.set('tags', tagIds.join(','))
  else params.delete('tags')
  if (search) params.set('q', search)
  else params.delete('q')
  if (untagged) params.set('untagged', '')
  else params.delete('untagged')
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
  const [moreFor, setMoreFor] = useState<string>()
  const listRequest = useRef(0)
  const loadingMore = useRef<number>(undefined)
  const sentinel = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [tags, setTags] = useState<TagSummary[]>([])
  const [stats, setStats] = useState<Stats>()
  const [selected, setSelected] = useState<string[]>(readTagsParam)
  const [searchInput, setSearchInput] = useState(readSearchParam)
  const [search, setSearch] = useState(searchInput)
  const [untagged, setUntagged] = useState(readUntaggedParam)
  const filter: Filter = { tagIds: selected, search, untagged }
  const filterRef = useRef(filter)
  const tagsRequest = useRef(0)
  const colorSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const lastPicked = useRef<string>(undefined)
  const pickedImages = images.filter((i) => picked.has(i.id))
  const [viewing, setViewing] = useState<string>()
  const viewingIndex = images.findIndex((i) => i.id === viewing)
  const hasMore = moreFor === filterKey(filter)

  useEffect(() => {
    const filter = { tagIds: selected, search, untagged }
    filterRef.current = filter
    writeParams(filter)
    const request = ++listRequest.current
    listImages(filter)
      .then((result) => {
        if (request !== listRequest.current) return
        setImages(result)
        setMoreFor(result.length === PAGE_SIZE ? filterKey(filter) : undefined)
      })
      .catch((err) => request === listRequest.current && setError(`Couldn't load images: ${message(err)}`))
  }, [selected, search, untagged])

  async function loadMore() {
    const request = listRequest.current
    if (!hasMore || loadingMore.current === request) return
    loadingMore.current = request
    try {
      const page = await listImages(filter, images.at(-1))
      if (request !== listRequest.current) return
      setImages((prev) => {
        const loaded = new Set(prev.map((i) => i.id))
        return [...prev, ...page.filter((i) => !loaded.has(i.id))]
      })
      if (page.length < PAGE_SIZE) setMoreFor(undefined)
    } catch (err) {
      if (request !== listRequest.current) return
      setMoreFor(undefined)
      setError(`Couldn't load more images: ${message(err)}`)
    } finally {
      if (loadingMore.current === request) loadingMore.current = undefined
    }
  }

  const onSentinelVisible = useEffectEvent(loadMore)

  useEffect(() => {
    if (!hasMore || !sentinel.current) return
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && onSentinelVisible(), {
      rootMargin: '800px',
    })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [hasMore, images])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

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

  function refreshStats() {
    getStats()
      .then(setStats)
      .catch((err) => setError(`Couldn't load storage usage: ${message(err)}`))
  }

  useEffect(refreshStats, [])

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
    const queue = files.map((file) => ({ file, key: String(nextUploadKey++) }))
    setUploads((prev) => [
      ...queue.map(({ file, key }) => ({ key, name: file.name, status: 'uploading' as const })),
      ...prev,
    ])

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const image = await uploadImage(next.file)
          if (matchesFilter(image, filterRef.current)) setImages((prev) => [image, ...prev.filter((i) => i.id !== image.id)])
          updateUpload(next.key, { status: 'done' })
        } catch (err) {
          updateUpload(next.key, { status: 'error', error: message(err) })
        }
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker))
    refreshStats()
  }

  const patchImageTags = (update: (tags: Tag[]) => Tag[], imageIds?: string[]) =>
    setImages((prev) => prev.map((i) => (!imageIds || imageIds.includes(i.id) ? { ...i, tags: update(i.tags) } : i)))

  async function tagImages(targets: Image[], name: string) {
    const lower = name.toLowerCase()
    const ids = targets.filter((i) => !i.tags.some((t) => t.name.toLowerCase() === lower)).map((i) => i.id)
    if (!ids.length) return
    const pendingId = `pending-${nextPendingTagId++}`
    const color = tags.find((t) => t.name.toLowerCase() === lower)?.color ?? ''
    patchImageTags((prev) => sortTags([...prev, { id: pendingId, name, color }]), ids)
    try {
      const tag = await addTagToImages(ids, name)
      patchImageTags((prev) => sortTags([...prev.filter((t) => t.id !== pendingId && t.id !== tag.id), tag]), ids)
    } catch (err) {
      patchImageTags((prev) => prev.filter((t) => t.id !== pendingId), ids)
      setError(`Couldn't add tag: ${message(err)}`)
    }
    refreshTags()
    refreshStats()
  }

  async function removeImageTag(image: Image, tag: Tag) {
    patchImageTags((prev) => prev.filter((t) => t.id !== tag.id), [image.id])
    try {
      await removeTag(image.id, tag.id)
    } catch (err) {
      patchImageTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : sortTags([...prev, tag])), [image.id])
      setError(`Couldn't remove tag: ${message(err)}`)
    }
    refreshTags()
    refreshStats()
  }

  async function onRenameTag(tag: TagSummary) {
    const name = prompt('Rename tag', tag.name)?.trim()
    if (!name || name === tag.name) return
    try {
      const renamed = await updateTag(tag.id, { name })
      const rename = <T extends Tag>(t: T) => (t.id === renamed.id ? { ...t, name: renamed.name } : t)
      setTags((prev) => sortTags(prev.map(rename)))
      patchImageTags((prev) => sortTags(prev.map(rename)))
    } catch (err) {
      setError(`Couldn't rename tag: ${message(err)}`)
    }
  }

  // Applies immediately while the picker drags, saving once it settles
  function onColorTag(tag: TagSummary, color: string) {
    const recolor = <T extends Tag>(t: T) => (t.id === tag.id ? { ...t, color } : t)
    setTags((prev) => prev.map(recolor))
    patchImageTags((prev) => prev.map(recolor))
    clearTimeout(colorSaves.current.get(tag.id))
    colorSaves.current.set(
      tag.id,
      setTimeout(() => {
        colorSaves.current.delete(tag.id)
        updateTag(tag.id, { color }).catch((err) => {
          setError(`Couldn't change tag color: ${message(err)}`)
          refreshTags()
        })
      }, COLOR_SAVE_DEBOUNCE_MS),
    )
  }

  async function onDeleteTag(tag: TagSummary) {
    if (!confirm(`Delete tag "${tag.name}" from all images?`)) return
    try {
      await deleteTag(tag.id)
      setTags((prev) => prev.filter((t) => t.id !== tag.id))
      patchImageTags((prev) => prev.filter((t) => t.id !== tag.id))
      setSelected((prev) => (prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : prev))
      refreshStats()
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
    refreshStats()
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

  function toggleFilter(id: string) {
    setUntagged(false)
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  function toggleUntagged() {
    setSelected([])
    setUntagged((prev) => !prev)
  }

  return (
    <main>
      <header>
        <h1>ImgTagr</h1>
        {stats && (
          <span className="stats">
            {stats.image_count.toLocaleString()} {stats.image_count === 1 ? 'image' : 'images'} ·{' '}
            {formatBytes(stats.total_bytes)}
          </span>
        )}
      </header>

      <Dropzone onFiles={uploadFiles} />

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

      <input
        type="search"
        className="search"
        placeholder="Search filenames and tags"
        aria-label="Search images"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />

      <TagFilter
        tags={tags}
        selected={selected}
        untagged={untagged}
        untaggedCount={stats?.untagged_count}
        onToggle={toggleFilter}
        onToggleUntagged={toggleUntagged}
        onClear={() => {
          setSelected([])
          setUntagged(false)
        }}
        onRename={onRenameTag}
        onColor={onColorTag}
        onDelete={onDeleteTag}
      />

      <datalist id={TAG_NAMES_LIST_ID}>
        {tags.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>

      {images.length === 0 && !error ? (
        <p className="empty">
          {search
            ? 'No images match your search.'
            : untagged
              ? 'Every image has a tag.'
              : selected.length
                ? 'No images have all of these tags.'
                : 'No images yet.'}
        </p>
      ) : (
        <Gallery
          images={images}
          picked={picked}
          picking={pickedImages.length > 0}
          onView={(image) => setViewing(image.id)}
          onPick={togglePick}
          onAddTag={(image, name) => tagImages([image], name)}
          onRemoveTag={removeImageTag}
        />
      )}
      {hasMore && <div ref={sentinel} aria-hidden="true" />}

      {viewingIndex !== -1 && (
        <Lightbox
          images={images}
          index={viewingIndex}
          onIndex={(index) => {
            setViewing(images[index].id)
            if (index >= images.length - 3) loadMore()
          }}
          onClose={() => setViewing(undefined)}
        />
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
