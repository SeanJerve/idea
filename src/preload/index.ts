import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AssistantEvent, CopilotApi, HotkeyAction } from '@shared/types'

const api: CopilotApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  transcribe: (wav) => ipcRenderer.invoke('transcribe', wav),
  ask: (req) => ipcRenderer.invoke('assistant:ask', req),
  cancel: (id) => ipcRenderer.invoke('assistant:cancel', id),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  snip: () => ipcRenderer.invoke('snip'),
  translate: (text) => ipcRenderer.invoke('translate', text),
  hotkeyStatus: () => ipcRenderer.invoke('hotkeys:status'),
  snipImage: () => ipcRenderer.invoke('snip:image'),
  finishSnip: (selection, view) => ipcRenderer.invoke('snip:done', selection, view),
  exportSession: (markdown) => ipcRenderer.invoke('session:export', markdown),
  onAssistantEvent(cb) {
    const listener = (_e: IpcRendererEvent, event: AssistantEvent): void => cb(event)
    ipcRenderer.on('assistant:event', listener)
    return () => ipcRenderer.off('assistant:event', listener)
  },
  onHotkey(cb) {
    const listener = (_e: IpcRendererEvent, action: HotkeyAction): void => cb(action)
    ipcRenderer.on('hotkey', listener)
    return () => ipcRenderer.off('hotkey', listener)
  },
  onClickThrough(cb) {
    const listener = (_e: IpcRendererEvent, on: boolean): void => cb(on)
    ipcRenderer.on('click-through', listener)
    return () => ipcRenderer.off('click-through', listener)
  }
}

contextBridge.exposeInMainWorld('copilot', api)
