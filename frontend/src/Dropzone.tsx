import { useState } from 'react'
import { IMAGE_TYPES, MAX_UPLOAD_MB } from './api'
import { MAX_SIZES } from './hooks/useUploads'

type Props = {
  maxSize: number | null
  onFiles: (files: File[]) => void
  onMaxSize: (size: number | null) => void
}

export function Dropzone({ maxSize, onFiles, onMaxSize }: Props) {
  const [dragging, setDragging] = useState(false)

  return (
    <>
      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          onFiles(Array.from(e.dataTransfer.files))
        }}
      >
        <strong>Drop images here</strong> or click to choose
        <span className="hint">
          or paste with Ctrl+V · JPEG, PNG, WebP or GIF, up to {MAX_UPLOAD_MB} MB
        </span>
        <input
          type="file"
          className="visually-hidden"
          accept={IMAGE_TYPES.join(',')}
          multiple
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </label>
      <label className="max-size hint">
        Resize uploads to
        <select
          className="sort"
          value={maxSize ?? ''}
          onChange={(e) => onMaxSize(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Original size</option>
          {MAX_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}px max (JPEG)
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
