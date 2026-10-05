import { useRef, useState } from 'react'
import type { Image } from './api'

// The extension stays fixed so downloads keep opening in the right app
function splitName(image: Image) {
  const name = image.original_filename ?? ''
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    return [name.slice(0, dot), name.slice(dot)]
  }

  return [name, name ? '' : `.${image.url.split('.').pop()}`]
}

type Props = {
  image: Image
  onRename: (name: string) => void
}

export function ImageName({ image, onRename }: Props) {
  const [draft, setDraft] = useState<string>()
  const cancelled = useRef(false)
  const [stem, extension] = splitName(image)

  function save() {
    const name = draft?.trim()
    setDraft(undefined)
    if (name && name !== stem && !cancelled.current) {
      onRename(name + extension)
    }
  }

  if (draft === undefined) {
    return (
      <button
        type="button"
        className="caption"
        title={image.original_filename ?? undefined}
        aria-label={`Rename ${image.original_filename ?? 'image'}`}
        onClick={() => {
          cancelled.current = false
          setDraft(stem)
        }}
      >
        {image.original_filename ?? 'Untitled'}
      </button>
    )
  }

  return (
    <input
      className="caption-input"
      aria-label="Image name"
      maxLength={255 - extension.length}
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          cancelled.current = true
          setDraft(undefined)
        }
      }}
    />
  )
}
