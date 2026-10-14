import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_HOTKEYS, DEFAULT_SETTINGS, type Settings } from '@shared/types'

const SECRET_KEYS = ['anthropicApiKey', 'sttApiKey'] as const

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function encrypt(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value
  return 'enc:' + safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (!value.startsWith('enc:')) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  } catch {
    return ''
  }
}

let cache: Settings | null = null

export function loadSettings(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  if (existsSync(settingsPath())) {
    try {
      stored = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    } catch {
      stored = {}
    }
  }
  const merged: Settings = { ...DEFAULT_SETTINGS, ...stored }
  // Shortcuts added in later versions get their defaults.
  merged.hotkeys = { ...DEFAULT_HOTKEYS, ...(stored.hotkeys ?? {}) }
  for (const key of SECRET_KEYS) merged[key] = decrypt(merged[key] ?? '')

  // Environment variables fill in keys that were never saved.
  if (!merged.anthropicApiKey && process.env.ANTHROPIC_API_KEY) merged.anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!merged.sttApiKey && process.env.OPENAI_API_KEY) merged.sttApiKey = process.env.OPENAI_API_KEY

  cache = merged
  return merged
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...loadSettings(), ...patch }
  const onDisk: Settings = { ...next }
  for (const key of SECRET_KEYS) onDisk[key] = encrypt(next[key])
  writeFileSync(settingsPath(), JSON.stringify(onDisk, null, 2))
  cache = next
  return next
}
