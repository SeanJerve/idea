import type { AskRequest, ReplyMode, TranscriptEntry } from './types'

export const SYSTEM_PROMPT = `You are a live desktop assistant. The user runs you in the background while they work, meet, or talk with people. With each request you get:
- a screenshot of the user's current screen (when available),
- a rolling transcript from automatic speech-to-text. "Me" is the user's microphone; "Them" is everything their computer plays (call participants, videos, and so on). Transcripts can contain recognition errors, so read through obvious mistakes,
- the user's request.

Your answer appears in a small overlay window and may be read aloud, so:
- Lead with the answer. No preamble, no restating the question.
- Keep it short: a few sentences or a tight list, unless the user asks for depth.
- Refer to what is on the screen or what was said when it helps ("the error on line 42", "their question about pricing").
- If the screenshot or transcript doesn't contain what you need, say what is missing in one line.`

const VOICE_STYLE = `This answer will be spoken aloud. Write plain sentences with no markdown, lists, code blocks, or symbols that sound odd when read.`

export function formatTranscript(entries: TranscriptEntry[], now: number): string {
  if (entries.length === 0) return '(nothing transcribed yet)'
  return entries
    .map((e) => {
      const ago = Math.max(0, Math.round((now - e.at) / 1000))
      return `[${ago}s ago] ${e.speaker === 'me' ? 'Me' : 'Them'}: ${e.text}`
    })
    .join('\n')
}

export function recentTranscript(entries: TranscriptEntry[], minutes: number, now: number): TranscriptEntry[] {
  const cutoff = now - minutes * 60_000
  return entries.filter((e) => e.at >= cutoff)
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

/** Builds the text part of the user turn. The screenshot, if any, is attached separately. */
export function buildUserText(
  req: AskRequest,
  opts: { now: number; replyMode: ReplyMode; customInstructions: string; hasScreenshot: boolean }
): string {
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
  if (!opts.hasScreenshot) parts.push('(No screenshot attached to this request.)')
  if (opts.customInstructions.trim()) {
    parts.push(`<user_preferences>\n${opts.customInstructions.trim()}\n</user_preferences>`)
  }
  if (opts.replyMode !== 'text') parts.push(VOICE_STYLE)
  parts.push(`<request>\n${taskText(req)}\n</request>`)

  return parts.join('\n\n')
}
