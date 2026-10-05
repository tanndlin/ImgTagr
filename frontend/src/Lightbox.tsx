import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { Image } from './api'

const SWIPE_PX = 50

type Point = { x: number; y: number }
const touchPoint = (e: TouchEvent): Point => ({ x: e.touches[0].clientX, y: e.touches[0].clientY })

type Props = {
  images: Image[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

export function Lightbox({ images, index, onIndex, onClose }: Props) {
  const image = images[index]
  const wrap = (delta: number) => (index + delta + images.length) % images.length
  const [lastDelta, setLastDelta] = useState(1)
  const step = (delta: number) => {
    setLastDelta(delta)
    onIndex(wrap(delta))
  }

  // Slides keep their position once placed, so finishing a swipe only moves the track
  const [anchor, setAnchor] = useState({ index, position: 0 })
  if (anchor.index !== index) {
    const forward = (anchor.index + 1) % images.length === index
    const backward = (anchor.index - 1 + images.length) % images.length === index
    let delta = 0
    if (forward && backward) {
      delta = lastDelta
    } else if (forward) {
      delta = 1
    } else if (backward) {
      delta = -1
    }

    setAnchor({ index, position: anchor.position + delta })
  }

  const slides = [0, lastDelta, -lastDelta]
    .map((offset) => ({ position: anchor.position + offset, image: images[wrap(offset)] }))
    .filter((slide, i, all) => all.findIndex((s) => s.image.id === slide.image.id) === i)
  const trackX = `${-anchor.position * 100}%`

  const track = useRef<HTMLDivElement>(null)
  const touchStart = useRef<Point>(undefined)
  const drag = useRef<Point>(undefined)

  // Moves the track directly rather than through state so iOS doesn't re-render every touchmove
  function moveTrack(offset?: Point) {
    drag.current = offset
    if (!track.current) {
      return
    }

    let [x, y] = [0, 0]
    if (offset) {
      const horizontal = Math.abs(offset.x) > Math.abs(offset.y)
      ;[x, y] = horizontal ? [offset.x, 0] : [0, Math.max(offset.y, 0)]
    }

    track.current.classList.toggle('dragging', !!offset)
    track.current.style.transform = `translate3d(calc(${trackX} + ${x}px), ${y}px, 0)`
  }

  function endSwipe() {
    const offset = drag.current
    touchStart.current = undefined
    if (
      offset &&
      images.length > 1 &&
      Math.abs(offset.x) > Math.abs(offset.y) &&
      Math.abs(offset.x) > SWIPE_PX
    ) {
      drag.current = undefined
      track.current?.classList.remove('dragging')
      return step(offset.x < 0 ? 1 : -1)
    }

    moveTrack(undefined)
    if (offset && Math.abs(offset.y) > Math.abs(offset.x) && offset.y > SWIPE_PX * 2) {
      onClose()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        step(-1)
      } else if (e.key === 'ArrowRight') {
        step(1)
      } else if (e.key === 'Escape') {
        onClose()
      } else {
        return
      }

      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  })

  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  useEffect(() => {
    for (const delta of [-2, 2]) {
      new window.Image().src = images[(index + delta + images.length) % images.length].url
    }
  }, [images, index])

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.original_filename ?? 'Image'}
      onClick={onClose}
      onTouchStart={(e) => {
        const zoomed = (window.visualViewport?.scale ?? 1) > 1
        touchStart.current = e.touches.length === 1 && !zoomed ? touchPoint(e) : undefined
        moveTrack(undefined)
      }}
      onTouchMove={(e) => {
        const start = touchStart.current
        if (!start) {
          return
        }

        if (e.touches.length > 1) {
          touchStart.current = undefined
          return moveTrack(undefined)
        }

        const now = touchPoint(e)
        moveTrack({ x: now.x - start.x, y: now.y - start.y })
      }}
      onTouchEnd={endSwipe}
      onTouchCancel={() => {
        touchStart.current = undefined
        moveTrack(undefined)
      }}
    >
      <div
        className="lightbox-track"
        ref={track}
        style={{ transform: `translate3d(${trackX}, 0, 0)` }}
      >
        {slides.map((slide) => (
          <div
            key={slide.image.id}
            className="lightbox-slide"
            style={{ left: `${slide.position * 100}%` }}
          >
            <img
              src={slide.image.url}
              alt={slide.position === anchor.position ? (slide.image.original_filename ?? '') : ''}
              aria-hidden={slide.position !== anchor.position}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button
            className="lightbox-nav prev"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation()
              step(-1)
            }}
          >
            ‹
          </button>
          <button
            className="lightbox-nav next"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation()
              step(1)
            }}
          >
            ›
          </button>
        </>
      )}
      <div className="lightbox-caption">
        {image.original_filename ?? 'Untitled'} · {index + 1} / {images.length}
      </div>
      <button className="lightbox-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
