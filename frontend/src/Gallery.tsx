import { useRef, type PointerEvent } from 'react'
import type { Image, Tag } from './api'
import { ImageTags } from './ImageTags'

const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP = 10

type Press = { timer: number; x: number; y: number }

type Props = {
  images: Image[]
  picked: ReadonlySet<string>
  picking: boolean
  onView: (image: Image) => void
  onPick: (image: Image, extend: boolean) => void
  onAddTag: (image: Image, name: string) => void
  onRemoveTag: (image: Image, tag: Tag) => void
}

export function Gallery({ images, picked, picking, onView, onPick, onAddTag, onRemoveTag }: Props) {
  const press = useRef<Press>(undefined)
  const longPressed = useRef(false)

  function cancelPress() {
    clearTimeout(press.current?.timer)
    press.current = undefined
  }

  function startPress(e: PointerEvent, image: Image) {
    cancelPress()
    longPressed.current = false
    if (e.pointerType !== 'touch') return
    const timer = window.setTimeout(() => {
      press.current = undefined
      longPressed.current = true
      if (!picked.has(image.id)) onPick(image, false)
    }, LONG_PRESS_MS)
    press.current = { timer, x: e.clientX, y: e.clientY }
  }

  function movePress(e: PointerEvent) {
    const start = press.current
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancelPress()
  }

  return (
    <ul className={`gallery${picking ? ' picking' : ''}`}>
      {images.map((image) => (
        <li key={image.id} className={picked.has(image.id) ? 'picked' : undefined}>
          <div className="thumb">
            <a
              href={image.url}
              target="_blank"
              rel="noreferrer"
              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
              onPointerDown={(e) => startPress(e, image)}
              onPointerMove={movePress}
              onPointerUp={cancelPress}
              onPointerCancel={cancelPress}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => (press.current || longPressed.current) && e.preventDefault()}
              onClick={(e) => {
                e.preventDefault()
                if (longPressed.current) longPressed.current = false
                else if (!picking && !e.ctrlKey && !e.metaKey && !e.shiftKey) onView(image)
                else onPick(image, e.shiftKey)
              }}
            >
              <img src={image.thumbnail_url} alt={image.original_filename ?? ''} loading="lazy" />
            </a>
            <input
              type="checkbox"
              className="pick"
              aria-label={`Select ${image.original_filename ?? 'image'}`}
              checked={picked.has(image.id)}
              onChange={(e) => onPick(image, (e.nativeEvent as MouseEvent).shiftKey)}
            />
          </div>
          <span className="caption" title={image.original_filename ?? undefined}>
            {image.original_filename ?? 'Untitled'}
          </span>
          <ImageTags
            tags={image.tags}
            onAdd={(name) => onAddTag(image, name)}
            onRemove={(tag) => onRemoveTag(image, tag)}
          />
        </li>
      ))}
    </ul>
  )
}
