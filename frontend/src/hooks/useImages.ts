import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  listImages,
  matchesFilter,
  sortedIndex,
  type Filter,
  type Image,
  type Tag,
  updateImage,
} from '../api'
import { useErrors } from '../context/errors'
import { filterKey } from './useFilter'

export type PatchImageTags = (update: (tags: Tag[]) => Tag[], imageIds?: string[]) => void

export function useImages(filter: Filter) {
  const { reportError } = useErrors()
  const [images, setImages] = useState<Image[]>([])
  // The cursor for the next page, and the filter it belongs to
  const [next, setNext] = useState<{ key: string; cursor: string }>()
  const listRequest = useRef(0)
  const loadingMore = useRef<number>(undefined)
  const sentinel = useRef<HTMLDivElement>(null)
  const filterRef = useRef(filter)
  const hasMoreRef = useRef(false)
  const cursor = next?.key === filterKey(filter) ? next.cursor : undefined
  const hasMore = cursor !== undefined

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  useEffect(() => {
    filterRef.current = filter
    const request = ++listRequest.current

    async function load() {
      try {
        const result = await listImages(filter)
        if (request !== listRequest.current) {
          return
        }

        setImages(result.images)
        setNext(result.next ? { key: filterKey(filter), cursor: result.next } : undefined)
      } catch (err) {
        if (request === listRequest.current) {
          reportError("Couldn't load images", err)
        }
      }
    }

    load()
  }, [filter, reportError])

  async function loadMore() {
    const request = listRequest.current
    if (cursor === undefined || loadingMore.current === request) {
      return
    }

    loadingMore.current = request
    try {
      const page = await listImages(filter, cursor)
      if (request !== listRequest.current) {
        return
      }

      setImages((prev) => {
        const loaded = new Set(prev.map((i) => i.id))
        return [...prev, ...page.images.filter((i) => !loaded.has(i.id))]
      })
      setNext(page.next ? { key: filterKey(filter), cursor: page.next } : undefined)
    } catch (err) {
      if (request !== listRequest.current) {
        return
      }

      setNext(undefined)
      reportError("Couldn't load more images", err)
    } finally {
      if (loadingMore.current === request) {
        loadingMore.current = undefined
      }
    }
  }

  const onSentinelVisible = useEffectEvent(loadMore)

  useEffect(() => {
    if (!hasMore || !sentinel.current) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && onSentinelVisible(),
      { rootMargin: '800px' },
    )
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [hasMore, images])

  // An image sorting past the loaded end arrives with a later page instead
  function placeImage(image: Image) {
    setImages((prev) => {
      const rest = prev.filter((i) => i.id !== image.id)
      if (!matchesFilter(image, filterRef.current)) {
        return rest
      }

      const index = sortedIndex(rest, image, filterRef.current.sort)
      if (index === -1) {
        return hasMoreRef.current ? rest : [...rest, image]
      }

      return rest.toSpliced(index, 0, image)
    })
  }

  async function renameImage(image: Image, name: string) {
    try {
      placeImage(await updateImage(image.id, { original_filename: name }))
    } catch (err) {
      reportError("Couldn't rename image", err)
    }
  }

  const patchImageTags: PatchImageTags = (update, imageIds) =>
    setImages((prev) =>
      prev.map((i) => (!imageIds || imageIds.includes(i.id) ? { ...i, tags: update(i.tags) } : i)),
    )

  const removeImages = (ids: ReadonlySet<string>) =>
    setImages((prev) => prev.filter((i) => !ids.has(i.id)))

  return {
    images,
    hasMore,
    loadMore,
    sentinel,
    placeImage,
    renameImage,
    patchImageTags,
    removeImages,
  }
}
