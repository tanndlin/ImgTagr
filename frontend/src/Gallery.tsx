import type { Image, Tag } from './api'
import { ImageTags } from './ImageTags'

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
              onClick={(e) => {
                e.preventDefault()
                if (!picking && !e.ctrlKey && !e.metaKey && !e.shiftKey) onView(image)
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
