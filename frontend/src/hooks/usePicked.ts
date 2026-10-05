import { useEffect, useRef, useState } from 'react'
import type { Image } from '../api'

export function usePicked(images: Image[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const lastPicked = useRef<string>(undefined)
  const pickedImages = images.filter((i) => picked.has(i.id))

  useEffect(() => {
    const clear = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
        setPicked(new Set())
      }
    }
    window.addEventListener('keydown', clear)
    return () => window.removeEventListener('keydown', clear)
  }, [])

  // Shift extends from the last clicked image, setting the whole range to the clicked image's new state
  function togglePick(image: Image, extend: boolean) {
    const anchor = extend ? images.findIndex((i) => i.id === lastPicked.current) : -1
    lastPicked.current = image.id
    setPicked((prev) => {
      const next = new Set(prev)
      const on = !prev.has(image.id)
      const index = images.indexOf(image)
      const range =
        anchor === -1 ? [image] : images.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
      for (const i of range) {
        if (on) {
          next.add(i.id)
        } else {
          next.delete(i.id)
        }
      }

      return next
    })
  }

  const pickAll = () => setPicked(new Set(images.map((i) => i.id)))
  const clearPicked = () => setPicked(new Set())
  const unpick = (ids: ReadonlySet<string>) =>
    setPicked((prev) => new Set([...prev].filter((id) => !ids.has(id))))

  return { picked, pickedImages, togglePick, pickAll, clearPicked, unpick }
}
