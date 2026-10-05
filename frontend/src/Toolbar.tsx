import { isSort, SORTS, type Sort } from './api'

type Props = {
  search: string
  sort: Sort
  onSearch: (search: string) => void
  onSort: (sort: Sort) => void
}

export function Toolbar({ search, sort, onSearch, onSort }: Props) {
  return (
    <div className="toolbar">
      <input
        type="search"
        className="search"
        placeholder="Search filenames and tags"
        aria-label="Search images"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <select
        className="sort"
        aria-label="Sort images"
        value={sort}
        onChange={(e) => isSort(e.target.value) && onSort(e.target.value)}
      >
        {Object.entries(SORTS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
