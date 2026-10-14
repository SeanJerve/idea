import { getMode } from './modes.ts'
import {
  DEFAULT_HOTKEYS,
  DEFAULT_SETTINGS,
  type AskKind,
  type AskRequest,
  type Effort,
  type HotkeyAction,
  type ImageAttachment,
  type ReplyMode,
  type Settings,
  type TranscriptEntry
} from './types.ts'

/**
 * Everything crossing the preload bridge from the renderer is treated as
 * untrusted here, so a compromised or buggy renderer cannot drive the main
 * process into unexpected states, oversized allocations, or wrong types.
 */

export const LIMITS = {
  question: 8_000,
  customInstructions: 4_000,
  shortText: 400,
  url: 2_000,
  translateLine: 4_000,
  clipboard: 200_000,
  exportBytes: 20_000_000,
  /** One WAV clip (16 kHz mono): ~20 minutes is well beyond any real utterance. */
  wavBytes: 80_000_000,
  images: 4,
  imageBytes: 12_000_000,
  transcriptEntries: 4_000,
  historyEntries: 12
}

const EFFORTS: Effort[] = ['low', 'medium', 'high']
const REPLY_MODES: ReplyMode[] = ['text', 'voice', 'both']
const THEMES: Settings['theme'][] = ['system', 'dark', 'light']
const IMAGE_TYPES: ImageAttachment['mediaType'][] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ASK_KINDS: AskKind[] = ['question', 'suggest-reply', 'summarize']
const SPEAKERS = ['me', 'them']

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** True for an endpoint that won't send the API key in cleartext over the network. */
export function isSafeSttBaseUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  // Plain HTTP only to the local machine (a self-hosted transcription server).
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  }
  return false
}

/** Keeps only known settings, coerces each to its expected type, and clamps ranges. */
export function sanitizeSettingsPatch(raw: unknown): Partial<Settings> {
  if (typeof raw !== 'object' || raw === null) return {}
  const input = raw as Record<string, unknown>
  const out: Partial<Settings> = {}
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(input, k)

  const strings: [keyof Settings, number][] = [
    ['anthropicApiKey', LIMITS.shortText],
    ['sttApiKey', LIMITS.shortText],
    ['sttModel', LIMITS.shortText],
    ['sttLanguage', LIMITS.shortText],
    ['voiceName', LIMITS.shortText],
    ['replyLanguage', LIMITS.shortText],
    ['model', LIMITS.shortText],
    ['translateModel', LIMITS.shortText],
    ['customInstructions', LIMITS.customInstructions]
  ]
  for (const [key, max] of strings) {
    if (has(key)) {
      const v = str(input[key], max)
      if (v !== null) out[key] = v.trim() as never
    }
  }

  if (has('sttBaseUrl')) {
    const v = str(input.sttBaseUrl, LIMITS.url)
    if (v !== null) out.sttBaseUrl = v.trim()
  }
  if (has('mode')) out.mode = getMode(String(input.mode)).id
  if (has('effort')) out.effort = oneOf(input.effort, EFFORTS, DEFAULT_SETTINGS.effort)
  if (has('replyMode')) out.replyMode = oneOf(input.replyMode, REPLY_MODES, DEFAULT_SETTINGS.replyMode)
  if (has('theme')) out.theme = oneOf(input.theme, THEMES, DEFAULT_SETTINGS.theme)

  const bools: (keyof Settings)[] = [
    'captureMic',
    'captureSystem',
    'includeScreenshot',
    'autoSuggest',
    'hideFromCapture',
    'launchAtLogin'
  ]
  for (const key of bools) if (has(key) && typeof input[key] === 'boolean') out[key] = input[key] as never

  // A wrong-typed number is ignored rather than reset to the default, so one bad
  // field in a patch never silently overwrites a good saved value.
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (has('contextMinutes') && num(input.contextMinutes)) out.contextMinutes = Math.round(clampNumber(input.contextMinutes, 1, 60, 3))
  if (has('voiceRate') && num(input.voiceRate)) out.voiceRate = clampNumber(input.voiceRate, 0.5, 2, 1)
  if (has('overlayOpacity') && num(input.overlayOpacity)) out.overlayOpacity = clampNumber(input.overlayOpacity, 0.4, 1, 1)

  if (has('hotkeys') && typeof input.hotkeys === 'object' && input.hotkeys !== null) {
    const raw = input.hotkeys as Record<string, unknown>
    const hotkeys = {} as Record<HotkeyAction, string>
    let ok = false
    for (const action of Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]) {
      const v = str(raw[action], 120)
      hotkeys[action] = v ?? DEFAULT_HOTKEYS[action]
      if (v !== null) ok = true
    }
    if (ok) out.hotkeys = hotkeys
  }

  if (has('windowBounds')) {
    const b = input.windowBounds
    if (b === null) out.windowBounds = null
    else if (typeof b === 'object') {
      const r = b as Record<string, unknown>
      const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
      if (num(r.x) && num(r.y) && num(r.width) && num(r.height)) {
        out.windowBounds = { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) }
      }
    }
  }

  return out
}

function validImage(value: unknown): ImageAttachment | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!IMAGE_TYPES.includes(v.mediaType as ImageAttachment['mediaType'])) return null
  if (typeof v.data !== 'string' || v.data.length === 0 || v.data.length > LIMITS.imageBytes) return null
  // Base64 only — no data: URLs, no stray bytes.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v.data)) return null
  return { mediaType: v.mediaType as ImageAttachment['mediaType'], data: v.data }
}

function validTranscriptEntry(value: unknown): TranscriptEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const text = str(v.text, LIMITS.question)
  if (text === null) return null
  if (!SPEAKERS.includes(v.speaker as string)) return null
  const at = typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : Date.now()
  return { speaker: v.speaker as TranscriptEntry['speaker'], text, at }
}

/** Validates an ask request from the renderer; returns null if it can't be trusted. */
export function validateAskRequest(raw: unknown): AskRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>

  const id = str(v.id, 64)
  if (!id) return null
  if (!ASK_KINDS.includes(v.kind as AskKind)) return null
  const question = str(v.question, LIMITS.question)
  if (question === null) return null

  const images = Array.isArray(v.images)
    ? v.images.slice(0, LIMITS.images).map(validImage).filter((x): x is ImageAttachment => x !== null)
    : []

  const transcript = Array.isArray(v.transcript)
    ? v.transcript
        .slice(-LIMITS.transcriptEntries)
        .map(validTranscriptEntry)
        .filter((x): x is TranscriptEntry => x !== null)
    : []

  const history = Array.isArray(v.history)
    ? v.history
        .slice(-LIMITS.historyEntries)
        .map((h) => {
          if (typeof h !== 'object' || h === null) return null
          const q = str((h as Record<string, unknown>).question, LIMITS.question)
          const a = str((h as Record<string, unknown>).answer, LIMITS.question * 2)
          return q !== null && a !== null ? { question: q, answer: a } : null
        })
        .filter((x): x is { question: string; answer: string } => x !== null)
    : []

  return {
    id,
    kind: v.kind as AskKind,
    question,
    modeId: getMode(String(v.modeId)).id,
    images,
    spoken: v.spoken === true,
    transcript,
    history
  }
}
