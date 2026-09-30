import { useState } from 'react'
import { MAX_TAG_LENGTH } from './api'
import { TAG_NAMES_LIST_ID } from './ImageTags'

type Props = {
  count: number
  total: number
  onAddTag: (name: string) => void
  onDownload: () => void
  onSelectAll: () => void
  onClear: () => void
}

export function SelectionBar({ count, total, onAddTag, onDownload, onSelectAll, onClear }: Props) {
  const [draft, setDraft] = useState('')
  const name = draft.trim()

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
      <span className="selection-count">{count} selected</span>
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
      <button type="button" onClick={onDownload}>
        Download
      </button>
      {count < total && (
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
