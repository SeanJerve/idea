export type Speaker = 'me' | 'them'

export interface TranscriptEntry {
  speaker: Speaker
  text: string
  /** Epoch milliseconds when the utterance ended. */
  at: number
}

export type ReplyMode = 'text' | 'voice' | 'both'
export type Effort = 'low' | 'medium' | 'high'

export interface Settings {
  anthropicApiKey: string
  model: string
  effort: Effort

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
  windowBounds: null
}

export const STT_PRESETS: Record<string, Pick<Settings, 'sttBaseUrl' | 'sttModel'>> = {
  OpenAI: { sttBaseUrl: 'https://api.openai.com/v1', sttModel: 'gpt-4o-mini-transcribe' },
  Groq: { sttBaseUrl: 'https://api.groq.com/openai/v1', sttModel: 'whisper-large-v3-turbo' }
}

export const MODEL_OPTIONS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']

/** What the user wants from a request. */
export type AskKind = 'question' | 'suggest-reply' | 'summarize'

export interface AskRequest {
  id: string
  kind: AskKind
  /** The user's question; empty for the quick actions. */
  question: string
  transcript: TranscriptEntry[]
  /** Earlier questions and answers in this session, oldest first. */
  history: { question: string; answer: string }[]
}

export type AssistantEvent =
  | { id: string; type: 'status'; text: string }
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'done'; text: string }
  | { id: string; type: 'error'; message: string }

export type HotkeyAction = 'focus-input' | 'voice-question' | 'suggest-reply' | 'toggle-listening' | 'click-through'

export interface CopilotApi {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  transcribe(wav: ArrayBuffer): Promise<string>
  ask(req: AskRequest): Promise<void>
  cancel(id: string): Promise<void>
  hideWindow(): Promise<void>
  quit(): Promise<void>
  copyText(text: string): Promise<void>
  /** Opens a save dialog; resolves to the saved path, or null if cancelled. */
  exportSession(markdown: string): Promise<string | null>
  onAssistantEvent(cb: (e: AssistantEvent) => void): () => void
  onHotkey(cb: (action: HotkeyAction) => void): () => void
  onClickThrough(cb: (on: boolean) => void): () => void
}
