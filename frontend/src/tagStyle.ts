import type { CSSProperties } from 'react'

export function tagStyle(color: string): CSSProperties | undefined {
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
    .exec(color)
    ?.slice(1)
    .map((h) => parseInt(h, 16))
  if (!rgb) {
    return undefined
  }

  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
  return {
    '--tag-bg': color,
    '--tag-fg': luminance > 0.55 ? '#1a1a1a' : '#ffffff',
  } as CSSProperties
}
