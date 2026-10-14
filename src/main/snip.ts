import { BrowserWindow, ipcMain, type NativeImage } from 'electron'
import { join } from 'node:path'
import type { Bounds, ImageAttachment } from '@shared/types'
import { fitWithin, selectionToCrop, type Size } from '@shared/window'
import { MAX_EDGE, captureDisplay } from './screen'

interface Session {
  image: NativeImage
  resolve: (result: ImageAttachment | null) => void
}

const sessions = new Map<number, Session>()

export function registerSnipIpc(): void {
  ipcMain.handle('snip:image', (e) => sessions.get(e.sender.id)?.image.toDataURL() ?? null)
  ipcMain.handle('snip:done', (e, selection: Bounds | null, view: Size) => {
    const session = sessions.get(e.sender.id)
    if (!session) return
    sessions.delete(e.sender.id)
    session.resolve(selection ? crop(session.image, selection, view) : null)
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}

function crop(image: NativeImage, selection: Bounds, view: Size): ImageAttachment | null {
  const rect = selectionToCrop(selection, view, image.getSize())
  if (!rect) return null
  const part = image.crop(rect)
  const out = part.resize(fitWithin(part.getSize(), MAX_EDGE))
  return { mediaType: 'image/jpeg', data: out.toJPEG(88).toString('base64') }
}

/**
 * Freezes the screen under the mouse and lets the user drag a rectangle over it.
 * Resolves to that area as an image, or null if they press Esc.
 */
export async function snip(overlay: BrowserWindow | null, keepHidden: boolean): Promise<ImageAttachment | null> {
  // Capture at full resolution so small text in a small selection stays readable.
  const shot = await captureDisplay(overlay, keepHidden, 3840)
  if (!shot) return null
  const { bounds } = shot.display

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#000000',
    title: 'Select an area',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setBounds(bounds)

  return new Promise((resolve) => {
    const id = win.webContents.id
    sessions.set(id, { image: shot.image, resolve })
    win.on('closed', () => {
      // Closed some other way (Alt+F4): treat as cancelled.
      if (sessions.delete(id)) resolve(null)
    })
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/snip.html`)
    else void win.loadFile(join(__dirname, '../renderer/snip.html'))
  })
}
