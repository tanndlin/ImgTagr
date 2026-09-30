import type { TagSummary } from './api'

type Props = {
  tags: TagSummary[]
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  onRename: (tag: TagSummary) => void
  onDelete: (tag: TagSummary) => void
}

export function TagFilter({ tags, selected, onToggle, onClear, onRename, onDelete }: Props) {
  if (tags.length === 0) return null

  return (
    <div className="tag-filter">
      <ul>
        {tags.map((tag) => {
          const active = selected.includes(tag.id)
          return (
            <li key={tag.id} className={`filter-chip${active ? ' active' : ''}`}>
              <button type="button" className="toggle" aria-pressed={active} onClick={() => onToggle(tag.id)}>
                {tag.name} <span className="count">{tag.image_count}</span>
              </button>
              <button
                type="button"
                className="action"
                title="Rename tag"
                aria-label={`Rename tag ${tag.name}`}
                onClick={() => onRename(tag)}
              >
                ✎
              </button>
              <button
                type="button"
                className="action"
                title="Delete tag"
                aria-label={`Delete tag ${tag.name}`}
                onClick={() => onDelete(tag)}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      {selected.length > 0 && (
        <button type="button" className="clear-filter" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  )
}
