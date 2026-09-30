import { useState } from 'react'
import { fetchImageFiles, type Image, MAX_TAG_LENGTH, prefersShare } from './api'
import { TAG_NAMES_LIST_ID } from './ImageTags'

type Props = {
  images: Image[]
  total: number
  onAddTag: (name: string) => void
  onDownload: () => void
  onDownloadError: (err: unknown) => void
  onDelete: () => void
  onSelectAll: () => void
  onClear: () => void
}

export function SelectionBar({ images, total, onAddTag, onDownload, onDownloadError, onDelete, onSelectAll, onClear }: Props) {
  const [draft, setDraft] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<{ key: string; files: File[] }>()
  const [savedKey, setSavedKey] = useState<string>()
  const name = draft.trim()
  const key = images.map((i) => i.id).join(',')
  const files = prepared?.key === key ? prepared.files : undefined

  // Safari only allows share() right after a tap, so files are fetched first and shared on a second tap
  async function prepare() {
    if (!prefersShare(images.length)) return onDownload()
    setPreparing(true)
    try {
      const files = await fetchImageFiles(images)
      if (navigator.canShare({ files })) setPrepared({ key, files })
      else onDownload()
    } catch (err) {
      onDownloadError(err)
    } finally {
      setPreparing(false)
    }
  }

  function share(files: File[]) {
    navigator
      .share({ files })
      .then(() => setSavedKey(key))
      .catch((err) => err.name !== 'AbortError' && onDownloadError(err))
  }

  return (
    <form
      className="selection-bar"
      aria-label="Selected images"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name) return
        onAddTag(name)
        setDraft('')
      }}
    >
      <span className="selection-count">{images.length} selected</span>
      <input
        className="selection-input"
        placeholder="Tag name"
        aria-label="Tag to add to selected images"
        list={TAG_NAMES_LIST_ID}
        maxLength={MAX_TAG_LENGTH}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="submit" className="primary" disabled={!name}>
        Add tag
      </button>
      {files ? (
        <button type="button" className="primary" onClick={() => share(files)}>
          {savedKey === key ? 'Saved ✓' : 'Save to Photos'}
        </button>
      ) : (
        <button type="button" disabled={preparing} onClick={prepare}>
          {preparing ? 'Preparing…' : 'Download'}
        </button>
      )}
      <button type="button" className="danger" onClick={onDelete}>
        Delete
      </button>
      {images.length < total && (
        <button type="button" onClick={onSelectAll}>
          Select all
        </button>
      )}
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </form>
  )
}
