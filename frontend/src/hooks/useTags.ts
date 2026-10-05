import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  addTagToImages,
  deleteTag as deleteTagRequest,
  listTags,
  mergeTag,
  removeTag,
  updateTag,
  type Image,
  type Tag,
  type TagSummary,
} from '../api'
import { useErrors } from '../context/errors'
import { useStats } from '../context/stats'
import type { PatchImageTags } from './useImages'

const COLOR_SAVE_DEBOUNCE_MS = 400
let nextPendingTagId = 0

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
const sortTags = <T extends Tag>(tags: T[]) => [...tags].sort(byName)

type Options = {
  patchImageTags: PatchImageTags
  setTagIds: Dispatch<SetStateAction<string[]>>
}

export function useTags({ patchImageTags, setTagIds }: Options) {
  const { reportError } = useErrors()
  const { refreshStats } = useStats()
  const [tags, setTags] = useState<TagSummary[]>([])
  const tagsRequest = useRef(0)
  const colorSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Ignores responses that a newer request has superseded
  async function fetchTags() {
    const request = ++tagsRequest.current
    const result = await listTags()
    return request === tagsRequest.current ? result : undefined
  }

  async function refreshTags() {
    try {
      const result = await fetchTags()
      if (result) {
        setTags(result)
      }
    } catch (err) {
      reportError("Couldn't load tags", err)
    }
  }

  useEffect(() => {
    async function loadTags() {
      try {
        const result = await fetchTags()
        if (!result) {
          return
        }

        setTags(result)
        const known = new Set(result.map((t) => t.id))
        setTagIds((prev) =>
          prev.every((id) => known.has(id)) ? prev : prev.filter((id) => known.has(id)),
        )
      } catch (err) {
        reportError("Couldn't load tags", err)
      }
    }

    loadTags()
  }, [reportError, setTagIds])

  async function tagImages(targets: Image[], name: string) {
    const lower = name.toLowerCase()
    const ids = targets
      .filter((i) => !i.tags.some((t) => t.name.toLowerCase() === lower))
      .map((i) => i.id)
    if (!ids.length) {
      return
    }

    const pendingId = `pending-${nextPendingTagId++}`
    const color = tags.find((t) => t.name.toLowerCase() === lower)?.color ?? ''
    patchImageTags((prev) => sortTags([...prev, { id: pendingId, name, color }]), ids)
    try {
      const tag = await addTagToImages(ids, name)
      patchImageTags(
        (prev) => sortTags([...prev.filter((t) => t.id !== pendingId && t.id !== tag.id), tag]),
        ids,
      )
    } catch (err) {
      patchImageTags((prev) => prev.filter((t) => t.id !== pendingId), ids)
      reportError("Couldn't add tag", err)
    }

    refreshTags()
    refreshStats()
  }

  async function untagImage(image: Image, tag: Tag) {
    patchImageTags((prev) => prev.filter((t) => t.id !== tag.id), [image.id])
    try {
      await removeTag(image.id, tag.id)
    } catch (err) {
      patchImageTags(
        (prev) => (prev.some((t) => t.id === tag.id) ? prev : sortTags([...prev, tag])),
        [image.id],
      )
      reportError("Couldn't remove tag", err)
    }

    refreshTags()
    refreshStats()
  }

  async function renameTag(tag: TagSummary) {
    const name = prompt('Rename tag', tag.name)?.trim().replace(/\s+/g, ' ')
    if (!name || name === tag.name) {
      return
    }

    const existing = tags.find(
      (t) => t.id !== tag.id && t.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      return mergeTags(tag, existing)
    }

    try {
      const renamed = await updateTag(tag.id, { name })
      const rename = <T extends Tag>(t: T) =>
        t.id === renamed.id ? { ...t, name: renamed.name } : t
      setTags((prev) => sortTags(prev.map(rename)))
      patchImageTags((prev) => sortTags(prev.map(rename)))
    } catch (err) {
      reportError("Couldn't rename tag", err)
    }
  }

  async function mergeTags(source: TagSummary, target: TagSummary) {
    const count = source.image_count === 1 ? '1 image' : `${source.image_count} images`
    if (
      !confirm(
        `"${target.name}" already exists. Merge "${source.name}" into it? Its ${count} will be tagged "${target.name}" instead.`,
      )
    ) {
      return
    }

    try {
      const merged = await mergeTag(source.id, target.id)
      patchImageTags((prev) =>
        prev.some((t) => t.id === source.id)
          ? sortTags([...prev.filter((t) => t.id !== source.id && t.id !== merged.id), merged])
          : prev,
      )
      setTagIds((prev) =>
        prev.includes(source.id)
          ? [...new Set(prev.map((id) => (id === source.id ? merged.id : id)))]
          : prev,
      )
    } catch (err) {
      reportError("Couldn't merge tags", err)
    }

    refreshTags()
  }

  // Applies immediately while the picker drags, saving once it settles
  function colorTag(tag: TagSummary, color: string) {
    const recolor = <T extends Tag>(t: T) => (t.id === tag.id ? { ...t, color } : t)
    setTags((prev) => prev.map(recolor))
    patchImageTags((prev) => prev.map(recolor))
    clearTimeout(colorSaves.current.get(tag.id))
    colorSaves.current.set(
      tag.id,
      setTimeout(async () => {
        colorSaves.current.delete(tag.id)
        try {
          await updateTag(tag.id, { color })
        } catch (err) {
          reportError("Couldn't change tag color", err)
          refreshTags()
        }
      }, COLOR_SAVE_DEBOUNCE_MS),
    )
  }

  async function deleteTag(tag: TagSummary) {
    if (!confirm(`Delete tag "${tag.name}" from all images?`)) {
      return
    }

    try {
      await deleteTagRequest(tag.id)
      setTags((prev) => prev.filter((t) => t.id !== tag.id))
      patchImageTags((prev) => prev.filter((t) => t.id !== tag.id))
      setTagIds((prev) => (prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : prev))
      refreshStats()
    } catch (err) {
      reportError("Couldn't delete tag", err)
    }
  }

  return { tags, refreshTags, tagImages, untagImage, renameTag, colorTag, deleteTag }
}
