import type { Bounds } from './types'

function intersection(a: Bounds, b: Bounds): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Restores saved overlay bounds if enough of the window would still be on a
 * connected screen (monitors get unplugged); otherwise uses the fallback.
 * The result is clamped to fit inside the screen it lands on.
 */
export function restoreBounds(saved: Bounds | null, workAreas: Bounds[], fallback: Bounds): Bounds {
  if (!saved || workAreas.length === 0) return fallback
  let best: Bounds | null = null
  let bestArea = 0
  for (const area of workAreas) {
    const a = intersection(saved, area)
    if (a > bestArea) {
      best = area
      bestArea = a
    }
  }
  // Need a usable chunk visible (at least the title bar and some content).
  if (!best || bestArea < Math.min(saved.width * saved.height * 0.25, 120 * 80)) return fallback

  const width = Math.min(saved.width, best.width)
  const height = Math.min(saved.height, best.height)
  return {
    width,
    height,
    x: Math.min(Math.max(saved.x, best.x), best.x + best.width - width),
    y: Math.min(Math.max(saved.y, best.y), best.y + best.height - height)
  }
}

export interface Size {
  width: number
  height: number
}

/**
 * Converts a drag selection made on the snip window (CSS pixels, any drag
 * direction) into a crop rectangle on the captured image (its own pixels).
 * Returns null for a selection too small to be intentional.
 */
export function selectionToCrop(sel: Bounds, view: Size, image: Size, minSize = 8): Bounds | null {
  const x1 = Math.min(sel.x, sel.x + sel.width)
  const y1 = Math.min(sel.y, sel.y + sel.height)
  const x2 = Math.max(sel.x, sel.x + sel.width)
  const y2 = Math.max(sel.y, sel.y + sel.height)
  const cx1 = Math.max(0, x1)
  const cy1 = Math.max(0, y1)
  const cx2 = Math.min(view.width, x2)
  const cy2 = Math.min(view.height, y2)
  if (cx2 - cx1 < minSize || cy2 - cy1 < minSize) return null

  const sx = image.width / view.width
  const sy = image.height / view.height
  const x = Math.floor(cx1 * sx)
  const y = Math.floor(cy1 * sy)
  return {
    x,
    y,
    width: Math.min(image.width - x, Math.ceil(cx2 * sx) - x),
    height: Math.min(image.height - y, Math.ceil(cy2 * sy) - y)
  }
}

/** Scales a size down (never up) so its long edge fits maxEdge. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height))
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}
