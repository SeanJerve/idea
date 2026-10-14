import { desktopCapturer, screen, type BrowserWindow, type Display, type NativeImage } from 'electron'
import { fitWithin } from '@shared/window'

/** Long edge of the image sent to the model. 1080p reads screen text well at a moderate token cost. */
export const MAX_EDGE = 1920

/**
 * Captures the display the mouse is on. The overlay is excluded from capture
 * for the duration so the model never sees its own window.
 */
export async function captureDisplay(
  overlay: BrowserWindow | null,
  keepHidden: boolean,
  maxEdge: number
): Promise<{ image: NativeImage; display: Display } | null> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const physical = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }

  if (overlay && !keepHidden) overlay.setContentProtection(true)
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: fitWithin(physical, maxEdge) })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    return { image: source.thumbnail, display }
  } finally {
    if (overlay && !keepHidden) overlay.setContentProtection(false)
  }
}

/** Screenshot of the display under the mouse, as base64 JPEG sized for the model. */
export async function captureScreen(overlay: BrowserWindow | null, keepHidden: boolean): Promise<string | null> {
  const shot = await captureDisplay(overlay, keepHidden, MAX_EDGE)
  return shot ? shot.image.toJPEG(85).toString('base64') : null
}
