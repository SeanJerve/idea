import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray
} from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AskRequest, AssistantEvent, HotkeyAction, Settings } from '@shared/types'
import { restoreBounds } from '@shared/window'
import { ask, cancel } from './assistant'
import { captureScreen } from './screen'
import { loadSettings, saveSettings } from './settings'
import { transcribe } from './transcribe'

// Lets tests (and portable setups) keep settings somewhere other than %APPDATA%.
if (process.env['SCREEN_COPILOT_USER_DATA']) app.setPath('userData', process.env['SCREEN_COPILOT_USER_DATA'])

let overlay: BrowserWindow | null = null
let tray: Tray | null = null
let clickThrough = false

const HOTKEYS: Record<string, HotkeyAction> = {
  'CommandOrControl+Shift+Space': 'focus-input',
  'CommandOrControl+Shift+A': 'voice-question',
  'CommandOrControl+Shift+R': 'suggest-reply',
  'CommandOrControl+Shift+L': 'toggle-listening',
  'CommandOrControl+Shift+K': 'click-through'
}

function createOverlay(): BrowserWindow {
  const settings = loadSettings()
  const { workArea } = screen.getPrimaryDisplay()
  const fallback = { width: 440, height: 600, x: workArea.x + workArea.width - 440 - 24, y: workArea.y + 24 }
  const bounds = restoreBounds(
    settings.windowBounds,
    screen.getAllDisplays().map((d) => d.workArea),
    fallback
  )

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    show: false,
    title: 'Screen Copilot',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep listening and speaking while the overlay is hidden.
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setOpacity(settings.overlayOpacity)
  win.setContentProtection(settings.hideFromCapture)
  win.once('ready-to-show', () => win.show())

  // Links in answers open in the browser, never inside the overlay.
  const openExternal = (url: string): void => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => (overlay = null))

  // Remember where the user put the overlay.
  let saveTimer: NodeJS.Timeout | undefined
  const rememberBounds = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!win.isDestroyed()) saveSettings({ windowBounds: win.getBounds() })
    }, 500)
  }
  win.on('move', rememberBounds)
  win.on('resize', rememberBounds)
  return win
}

function showOverlay(focus: boolean): void {
  if (!overlay) overlay = createOverlay()
  if (focus) {
    overlay.show()
    overlay.focus()
  } else if (!overlay.isVisible()) {
    // Don't steal focus from the app the user is working in.
    overlay.showInactive()
  }
}

/** Click-through: the overlay stays visible but clicks go to the window underneath. */
function setClickThrough(on: boolean): void {
  clickThrough = on
  overlay?.setIgnoreMouseEvents(on, { forward: true })
  overlay?.webContents.send('click-through', on)
}

function sendHotkey(action: HotkeyAction): void {
  if (action === 'click-through') {
    showOverlay(false)
    setClickThrough(!clickThrough)
    return
  }
  if (action === 'focus-input') {
    if (overlay?.isVisible() && overlay.isFocused() && !clickThrough) {
      overlay.hide()
      return
    }
    // Typing needs a clickable window.
    if (clickThrough) setClickThrough(false)
  }
  showOverlay(action === 'focus-input')
  overlay?.webContents.send('hotkey', action)
}

function registerHotkeys(): void {
  for (const [accelerator, action] of Object.entries(HOTKEYS)) {
    if (!globalShortcut.register(accelerator, () => sendHotkey(action))) {
      console.warn(`Could not register ${accelerator}; another app may be using it.`)
    }
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Screen Copilot')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show', click: () => showOverlay(true) },
      { label: 'Hide', click: () => overlay?.hide() },
      { label: 'Toggle click-through (Ctrl+Shift+K)', click: () => setClickThrough(!clickThrough) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showOverlay(true))
}

function applyWindowSettings(s: Settings): void {
  overlay?.setOpacity(s.overlayOpacity)
  overlay?.setContentProtection(s.hideFromCapture)
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const next = saveSettings(patch)
    applyWindowSettings(next)
    return next
  })
  ipcMain.handle('transcribe', (_e, wav: ArrayBuffer) => transcribe(wav, loadSettings()))
  ipcMain.handle('assistant:ask', async (event, req: AskRequest) => {
    const settings = loadSettings()
    const emit = (e: AssistantEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send('assistant:event', e)
    }
    let screenshot: string | null = null
    if (settings.includeScreenshot) {
      emit({ id: req.id, type: 'status', text: 'Looking at your screen…' })
      screenshot = await captureScreen(overlay, settings.hideFromCapture).catch(() => null)
    }
    emit({ id: req.id, type: 'status', text: 'Thinking…' })
    await ask(req, settings, screenshot, emit)
  })
  ipcMain.handle('assistant:cancel', (_e, id: string) => cancel(id))
  ipcMain.handle('window:hide', () => overlay?.hide())
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('session:export', async (_e, markdown: string) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
    const options = {
      title: 'Save session',
      defaultPath: join(app.getPath('documents'), `screen-copilot-${stamp}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = overlay ? await dialog.showSaveDialog(overlay, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, markdown, 'utf8')
    return result.filePath
  })
  ipcMain.handle('app:quit', () => app.quit())
}

function registerSystemAudio(): void {
  // getDisplayMedia() in the renderer lands here. We pick the screen ourselves (no picker)
  // and, on Windows, attach a loopback track: everything the computer is playing.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (process.platform === 'win32') {
      callback({ video: sources[0], audio: 'loopback' })
    } else {
      callback({ video: sources[0] })
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showOverlay(true))
  app.whenReady().then(() => {
    app.setAppUserModelId('com.seanjerve.screencopilot')
    registerIpc()
    registerSystemAudio()
    overlay = createOverlay()
    registerHotkeys()
    createTray()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // The app lives in the tray; closing the overlay doesn't quit it.
  app.on('window-all-closed', () => {})
}
