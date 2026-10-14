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
