import { useState } from 'react'

export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false)

  return (
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
      <span className="hint">JPEG, PNG, WebP or GIF, up to 100 MB</span>
      <input
        type="file"
        className="visually-hidden"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </label>
  )
}
