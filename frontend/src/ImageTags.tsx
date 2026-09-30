import { useState } from 'react'
import { MAX_TAG_LENGTH, type Tag } from './api'

export const TAG_NAMES_LIST_ID = 'tag-names'
const isPending = (tag: Tag) => tag.id.startsWith('pending-')

type Props = {
  tags: Tag[]
  onAdd: (name: string) => void
  onRemove: (tag: Tag) => void
}

export function ImageTags({ tags, onAdd, onRemove }: Props) {
  const [draft, setDraft] = useState('')

  return (
    <div className="image-tags">
      {tags.map((tag) => (
        <span key={tag.id} className={`tag-chip${isPending(tag) ? ' pending' : ''}`}>
          <span className="tag-name">{tag.name}</span>
          <button
            type="button"
            aria-label={`Remove tag ${tag.name}`}
            disabled={isPending(tag)}
            onClick={() => onRemove(tag)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        placeholder="+ tag"
        aria-label="Add tag"
        list={TAG_NAMES_LIST_ID}
        maxLength={MAX_TAG_LENGTH}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const name = draft.trim()
            if (name) onAdd(name)
            setDraft('')
          } else if (e.key === 'Escape') {
            setDraft('')
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
