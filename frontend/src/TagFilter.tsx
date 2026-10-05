import type { TagSummary } from './api'
import { useStats } from './context/stats'
import { tagStyle } from './tagStyle'

type Props = {
  tags: TagSummary[]
  selected: string[]
  untagged: boolean
  onToggle: (id: string) => void
  onToggleUntagged: () => void
  onClear: () => void
  onRename: (tag: TagSummary) => void
  onColor: (tag: TagSummary, color: string) => void
  onDelete: (tag: TagSummary) => void
}

export function TagFilter({
  tags,
  selected,
  untagged,
  onToggle,
  onToggleUntagged,
  onClear,
  onRename,
  onColor,
  onDelete,
}: Props) {
  const untaggedCount = useStats().stats?.untagged_count

  if (tags.length === 0) {
    return null
  }

  return (
    <div className="tag-filter">
      <ul>
        <li className={`filter-chip untagged${untagged ? ' active' : ''}`}>
          <button
            type="button"
            className="toggle"
            aria-pressed={untagged}
            onClick={onToggleUntagged}
          >
            Untagged {untaggedCount !== undefined && <span className="count">{untaggedCount}</span>}
          </button>
        </li>
        {tags.map((tag) => {
          const active = selected.includes(tag.id)
          return (
            <li
              key={tag.id}
              className={`filter-chip${active ? ' active' : ''}`}
              style={tagStyle(tag.color)}
            >
              <label className="swatch" title="Change color">
                <input
                  type="color"
                  aria-label={`Color of tag ${tag.name}`}
                  value={tag.color}
                  onChange={(e) => onColor(tag, e.target.value)}
                />
              </label>
              <button
                type="button"
                className="toggle"
                aria-pressed={active}
                onClick={() => onToggle(tag.id)}
              >
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
      {(selected.length > 0 || untagged) && (
        <button type="button" className="clear-filter" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  )
}
