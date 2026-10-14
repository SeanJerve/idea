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
import { parseHotkey } from '@shared/hotkeys'
import type { AskRequest, AssistantEvent, HotkeyAction, HotkeyStatus, Settings } from '@shared/types'
import { restoreBounds } from '@shared/window'
import { ask, cancel, translate } from './assistant'
import { captureScreen } from './screen'
import { loadSettings, saveSettings } from './settings'
import { registerSnipIpc, snip } from './snip'
import { transcribe } from './transcribe'

// Lets tests (and portable setups) keep settings somewhere other than %APPDATA%.
if (process.env['SCREEN_COPILOT_USER_DATA']) app.setPath('userData', process.env['SCREEN_COPILOT_USER_DATA'])

let overlay: BrowserWindow | null = null
let tray: Tray | null = null
let clickThrough = false
let hotkeyStatus: HotkeyStatus[] = []
let snipping = false
/** Launched at sign-in: stay in the tray until called. */
let startHidden = process.argv.includes('--hidden')

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
  win.once('ready-to-show', () => {
    if (!startHidden) win.show()
    startHidden = false
  })

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

/** (Re)registers the user's shortcuts and records which ones couldn't be set. */
function registerHotkeys(hotkeys: Record<HotkeyAction, string>): void {
  globalShortcut.unregisterAll()
  const taken = new Set<string>()
  hotkeyStatus = (Object.entries(hotkeys) as [HotkeyAction, string][]).map(([action, raw]) => {
    if (!raw.trim()) return { action, accelerator: '', error: 'Off' }
    const parsed = parseHotkey(raw)
    if (!parsed.ok) return { action, accelerator: raw, error: parsed.error }
    const key = parsed.accelerator.toLowerCase()
    if (taken.has(key)) return { action, accelerator: parsed.accelerator, error: 'Already used for another action.' }
    taken.add(key)
    let ok = false
    try {
      ok = globalShortcut.register(parsed.accelerator, () => sendHotkey(action))
    } catch {
      ok = false
    }
    return ok
      ? { action, accelerator: parsed.accelerator }
      : { action, accelerator: parsed.accelerator, error: 'Another app is already using this shortcut.' }
  })
}

function applyLoginItem(on: boolean): void {
  // Windows and macOS only; Linux desktops handle autostart differently.
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
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
      { label: 'Ask about an area of the screen', click: () => sendHotkey('snip') },
      { label: 'Toggle click-through', click: () => setClickThrough(!clickThrough) },
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

async function runSnip(): Promise<Awaited<ReturnType<typeof snip>>> {
  if (snipping) return null
  snipping = true
  try {
    return await snip(overlay, loadSettings().hideFromCapture)
  } finally {
    snipping = false
    showOverlay(true)
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const before = loadSettings()
    const next = saveSettings(patch)
    applyWindowSettings(next)
    if (JSON.stringify(before.hotkeys) !== JSON.stringify(next.hotkeys)) registerHotkeys(next.hotkeys)
    if (before.launchAtLogin !== next.launchAtLogin) applyLoginItem(next.launchAtLogin)
    return next
  })
  ipcMain.handle('hotkeys:status', () => hotkeyStatus)
  ipcMain.handle('translate', (_e, text: string) => translate(text, loadSettings()))
  ipcMain.handle('snip', () => runSnip())
  ipcMain.handle('transcribe', (_e, wav: ArrayBuffer) => transcribe(wav, loadSettings()))
  ipcMain.handle('assistant:ask', async (event, req: AskRequest) => {
    const settings = loadSettings()
    const emit = (e: AssistantEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send('assistant:event', e)
    }
    let screenshot: string | null = null
    // An area the user picked (or an image they added) replaces the full screenshot.
    if (settings.includeScreenshot && (req.images ?? []).length === 0) {
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
    registerSnipIpc()
    registerSystemAudio()
    overlay = createOverlay()
    registerHotkeys(loadSettings().hotkeys)
    createTray()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // The app lives in the tray; closing the overlay doesn't quit it.
  app.on('window-all-closed', () => {})
}
