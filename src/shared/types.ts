export type Speaker = 'me' | 'them'

export interface TranscriptEntry {
  speaker: Speaker
  text: string
  /** Epoch milliseconds when the utterance ended. */
  at: number
}

export type ReplyMode = 'text' | 'voice' | 'both'

export type HotkeyAction =
  | 'focus-input'
  | 'voice-question'
  | 'suggest-reply'
  | 'toggle-listening'
  | 'click-through'
  | 'snip'

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  'focus-input': 'CommandOrControl+Shift+Space',
  'voice-question': 'CommandOrControl+Shift+A',
  'suggest-reply': 'CommandOrControl+Shift+R',
  'toggle-listening': 'CommandOrControl+Shift+L',
  // Not Ctrl+Shift+K: Microsoft Teams uses it to raise your hand.
  'click-through': 'CommandOrControl+Shift+X',
  'snip': 'CommandOrControl+Shift+G'
}

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  'focus-input': 'Show overlay / type a question',
  'voice-question': 'Ask out loud',
  'suggest-reply': 'Suggest a reply',
  'toggle-listening': 'Start / stop listening',
  'click-through': 'Click-through on / off',
  'snip': 'Ask about an area of the screen'
}
export type Effort = 'low' | 'medium' | 'high'

export interface Settings {
  anthropicApiKey: string
  model: string
  effort: Effort
  /** Model used for live translation of transcript lines. */
  translateModel: string
  /** Active mode (see modes.ts). */
  mode: string
  /** Language for answers and translations; empty means match the user. */
  replyLanguage: string

  /** OpenAI-compatible speech-to-text endpoint (OpenAI, Groq, a local server...). */
  sttBaseUrl: string
  sttApiKey: string
  sttModel: string
  /** ISO-639-1 code such as "en"; empty lets the STT service detect it. */
  sttLanguage: string

  replyMode: ReplyMode
  voiceName: string
  voiceRate: number

  captureMic: boolean
  captureSystem: boolean
  includeScreenshot: boolean
  /** How much recent transcript to send with each question. */
  contextMinutes: number

  /** Suggest a reply automatically when the other side asks a question. */
  autoSuggest: boolean

  /** Keep the overlay out of screenshots and screen shares. */
  hideFromCapture: boolean
  overlayOpacity: number
  customInstructions: string
  /** Last overlay position and size, restored on launch. */
  windowBounds: Bounds | null
  hotkeys: Record<HotkeyAction, string>
  launchAtLogin: boolean
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: '',
  model: 'claude-opus-5-5',
  effort: 'low',
  translateModel: 'claude-opus-5-5',
  mode: 'general',
  replyLanguage: '',

  sttBaseUrl: 'https://api.openai.com/v1',
  sttApiKey: '',
  sttModel: 'gpt-4o-mini-transcribe',
  sttLanguage: '',

  replyMode: 'text',
  voiceName: '',
  voiceRate: 1.1,

  captureMic: true,
  captureSystem: true,
  includeScreenshot: true,
  contextMinutes: 3,
  autoSuggest: false,

  hideFromCapture: true,
  overlayOpacity: 0.94,
  customInstructions: '',
  windowBounds: null,
  hotkeys: { ...DEFAULT_HOTKEYS },
  launchAtLogin: false
}

export const STT_PRESETS: Record<string, Pick<Settings, 'sttBaseUrl' | 'sttModel'>> = {
  OpenAI: { sttBaseUrl: 'https://api.openai.com/v1', sttModel: 'gpt-4o-mini-transcribe' },
  Groq: { sttBaseUrl: 'https://api.groq.com/openai/v1', sttModel: 'whisper-large-v3-turbo' }
}

export const MODEL_OPTIONS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']

/** What the user wants from a request. */
export type AskKind = 'question' | 'suggest-reply' | 'summarize'

export interface ImageAttachment {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  /** Base64, no data: prefix. */
  data: string
}

export interface AskRequest {
  id: string
  kind: AskKind
  /** The user's question; empty for the quick actions. */
  question: string
  /** Mode whose instructions apply. */
  modeId: string
  /** Images the user attached (snipped region, pasted or dropped). When present, no full screenshot is taken. */
  images: ImageAttachment[]
  /** The answer will be read aloud. */
  spoken?: boolean
  transcript: TranscriptEntry[]
  /** Earlier questions and answers in this session, oldest first. */
  history: { question: string; answer: string }[]
}

export type AssistantEvent =
  | { id: string; type: 'status'; text: string }
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'done'; text: string }
  | { id: string; type: 'error'; message: string }

export interface HotkeyStatus {
  action: HotkeyAction
  accelerator: string
  /** Why it isn't active, if it isn't. */
  error?: string
}

export interface CopilotApi {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  transcribe(wav: ArrayBuffer): Promise<string>
  ask(req: AskRequest): Promise<void>
  cancel(id: string): Promise<void>
  hideWindow(): Promise<void>
  quit(): Promise<void>
  copyText(text: string): Promise<void>
  /** Lets the user drag over part of the screen; resolves to that area, or null if cancelled. */
  snip(): Promise<ImageAttachment | null>
  /** Translates one line into the reply language; resolves to null when it's already in that language. */
  translate(text: string): Promise<string | null>
  hotkeyStatus(): Promise<HotkeyStatus[]>
  /** Snip window only: the frozen screen image as a data URL. */
  snipImage(): Promise<string | null>
  /** Snip window only: report the selection (CSS pixels) or null to cancel. */
  finishSnip(selection: Bounds | null, view: { width: number; height: number }): Promise<void>
  /** Opens a save dialog; resolves to the saved path, or null if cancelled. */
  exportSession(markdown: string): Promise<string | null>
  onAssistantEvent(cb: (e: AssistantEvent) => void): () => void
  onHotkey(cb: (action: HotkeyAction) => void): () => void
  onClickThrough(cb: (on: boolean) => void): () => void
}
