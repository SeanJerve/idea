import type { AskRequest, ReplyMode, TranscriptEntry } from './types'

export const SYSTEM_PROMPT = `You are a live desktop assistant. The user runs you in the background while they work, meet, study, or talk with people. With each request you get:
- a screenshot of the user's current screen, or images the user chose (an area they selected, or a picture they added),
- a rolling transcript from automatic speech-to-text. "Me" is the user's microphone; "Them" is everything their computer plays (call participants, videos, and so on). Transcripts can contain recognition errors, so read through obvious mistakes,
- the user's request, and sometimes a mode describing what they're doing.

Your answer appears in a small overlay window and may be read aloud, so:
- Lead with the answer. No preamble, no restating the question.
- Keep it short: a few sentences or a tight list, unless the user asks for depth.
- Refer to what is on the screen or what was said when it helps ("the error on line 42", "their question about pricing").
- If the screenshot or transcript doesn't contain what you need, say what is missing in one line.`

const VOICE_STYLE = `This answer will be spoken aloud. Write plain sentences with no markdown, lists, code blocks, or symbols that sound odd when read.`

/** Roughly 15k tokens of transcript; long meetings keep their most recent part. */
export const TRANSCRIPT_CHAR_BUDGET = 60_000

export function formatTranscript(entries: TranscriptEntry[], now: number, budget = TRANSCRIPT_CHAR_BUDGET): string {
  if (entries.length === 0) return '(nothing transcribed yet)'
  const lines: string[] = []
  let used = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    const ago = Math.max(0, Math.round((now - e.at) / 1000))
    const line = `[${formatAgo(ago)} ago] ${e.speaker === 'me' ? 'Me' : 'Them'}: ${e.text}`
    if (used + line.length > budget && lines.length > 0) {
      lines.push(`(${i + 1} earlier lines omitted)`)
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  return lines.reverse().join('\n')
}

function formatAgo(seconds: number): string {
  if (seconds < 120) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  return m < 120 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

export function taskText(req: Pick<AskRequest, 'kind' | 'question'>): string {
  switch (req.kind) {
    case 'suggest-reply':
      return 'Suggest what I could say next in this conversation. Write it in the first person, ready for me to say, then add one short line on why if it helps.'
    case 'summarize':
      return 'Summarize the conversation so far: the key points, any decisions, and open questions or action items.'
    default:
      return req.question.trim()
  }
}

export interface PromptOptions {
  now: number
  replyMode: ReplyMode
  customInstructions: string
  /** What visual context comes with the request. */
  visual: 'screenshot' | 'attachments' | 'none'
  modeName?: string
  modeInstructions?: string
  replyLanguage?: string
  /** Read aloud regardless of reply mode. */
  spoken?: boolean
}

/** Builds the text part of the user turn. Images are attached separately. */
export function buildUserText(req: AskRequest, opts: PromptOptions): string {
  const parts: string[] = []

  if (req.history.length > 0) {
    const recent = req.history.slice(-4)
    parts.push(
      '<earlier_exchanges>\n' +
        recent.map((h) => `User: ${h.question}\nYou: ${h.answer}`).join('\n\n') +
        '\n</earlier_exchanges>'
    )
  }

  parts.push(`<transcript>\n${formatTranscript(req.transcript, opts.now)}\n</transcript>`)
  if (opts.visual === 'attachments') {
    parts.push('(The attached image is what the user chose to show you: an area of their screen or a picture they added.)')
  } else if (opts.visual === 'none') {
    parts.push('(No screenshot attached to this request.)')
  }
  if (opts.modeInstructions?.trim()) {
    parts.push(`<mode name="${opts.modeName ?? ''}">\n${opts.modeInstructions.trim()}\n</mode>`)
  }
  if (opts.customInstructions.trim()) {
    parts.push(`<user_preferences>\n${opts.customInstructions.trim()}\n</user_preferences>`)
  }
  if (opts.replyLanguage?.trim()) parts.push(`Answer in ${opts.replyLanguage.trim()}.`)
  if (opts.replyMode !== 'text' || opts.spoken) parts.push(VOICE_STYLE)
  parts.push(`<request>\n${taskText(req)}\n</request>`)

  return parts.join('\n\n')
}

export const TRANSLATE_SYSTEM = `You translate single lines of live speech transcripts. Reply with the translation only: no quotes, notes, or explanations. Keep names, numbers, and technical terms. If the line is already in the target language, reply with exactly: SAME`

export function translatePrompt(text: string, language: string): string {
  return `Target language: ${language}\n\nLine:\n${text}`
}

/** Interprets the translator's reply; null means no translation is needed. */
export function parseTranslation(reply: string, original: string): string | null {
  const t = reply.trim()
  if (!t || t === 'SAME' || t.replace(/[.!?]$/, '') === 'SAME') return null
  if (t.toLowerCase() === original.trim().toLowerCase()) return null
  return t
}
