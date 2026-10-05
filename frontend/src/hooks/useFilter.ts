import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SORT, isSort, type Filter, type Sort } from '../api'

const SEARCH_DEBOUNCE_MS = 250

const params = () => new URLSearchParams(window.location.search)
const readTagsParam = () => params().get('tags')?.split(',').filter(Boolean) ?? []
const readSearchParam = () => params().get('q') ?? ''
const readUntaggedParam = () => params().has('untagged')

function readSortParam(): Sort {
  const sort = params().get('sort')
  return isSort(sort) ? sort : DEFAULT_SORT
}

function setParam(search: URLSearchParams, name: string, value: string | undefined) {
  if (value === undefined) {
    search.delete(name)
  } else {
    search.set(name, value)
  }
}

function writeParams({ tagIds, search, untagged, sort }: Filter) {
  const next = params()
  setParam(next, 'tags', tagIds.length ? tagIds.join(',') : undefined)
  setParam(next, 'q', search || undefined)
  setParam(next, 'untagged', untagged ? '' : undefined)
  setParam(next, 'sort', sort === DEFAULT_SORT ? undefined : sort)

  const query = next.toString().replace(/%2C/g, ',')
  history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )
}

export const filterKey = ({ tagIds, search, untagged, sort }: Filter) =>
  `${tagIds.join(',')}|${search}|${untagged}|${sort}`

export function useFilter() {
  const [tagIds, setTagIds] = useState<string[]>(readTagsParam)
  const [searchInput, setSearchInput] = useState(readSearchParam)
  const [search, setSearch] = useState(searchInput)
  const [untagged, setUntagged] = useState(readUntaggedParam)
  const [sort, setSort] = useState(readSortParam)
  const filter = useMemo(
    () => ({ tagIds, search, untagged, sort }),
    [tagIds, search, untagged, sort],
  )

  useEffect(() => {
    writeParams(filter)
  }, [filter])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  function toggleTag(id: string) {
    setUntagged(false)
    setTagIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  function toggleUntagged() {
    setTagIds([])
    setUntagged((prev) => !prev)
  }

  function clearTags() {
    setTagIds([])
    setUntagged(false)
  }

  return {
    filter,
    searchInput,
    setSearchInput,
    setSort,
    setTagIds,
    toggleTag,
    toggleUntagged,
    clearTags,
  }
}
