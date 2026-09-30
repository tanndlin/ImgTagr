import { useEffect } from 'react'
import type { Image } from './api'

type Props = {
  images: Image[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

export function Lightbox({ images, index, onIndex, onClose }: Props) {
  const image = images[index]
  const step = (delta: number) => onIndex((index + delta + images.length) % images.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'Escape') onClose()
      else return
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
    for (const delta of [-1, 1]) new window.Image().src = images[(index + delta + images.length) % images.length].url
  }, [images, index])

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.original_filename ?? 'Image'} onClick={onClose}>
      <img key={image.id} src={image.url} alt={image.original_filename ?? ''} onClick={(e) => e.stopPropagation()} />
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
