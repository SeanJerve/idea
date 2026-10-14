import { desktopCapturer, screen, type BrowserWindow } from 'electron'

/** Long edge of the image sent to the model. 1080p reads screen text well at a moderate token cost. */
const MAX_EDGE = 1920

function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Captures the display the mouse is on, as base64 JPEG.
 * The overlay is excluded from capture for the duration so the model never sees its own window.
 */
export async function captureScreen(overlay: BrowserWindow | null, keepHidden: boolean): Promise<string | null> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const physical = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }

  if (overlay && !keepHidden) overlay.setContentProtection(true)
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: targetSize(physical.width, physical.height)
    })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    return source.thumbnail.toJPEG(85).toString('base64')
  } finally {
    if (overlay && !keepHidden) overlay.setContentProtection(false)
  }
}
