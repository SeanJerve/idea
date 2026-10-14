import type { TranscriptEntry } from '../../shared/types'

/** How far apart (ms) a mic line and a computer-audio line can be and still count as the same speech. */
const ECHO_WINDOW_MS = 10_000

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Share of the shorter text's words that also appear in the longer one (0..1).
 * Speech-to-text of the same audio through two paths rarely matches exactly.
 */
export function overlap(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  if (wa.length === 0 || wb.length === 0) return 0
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  const pool = new Map<string, number>()
  for (const w of long) pool.set(w, (pool.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of short) {
    const n = pool.get(w) ?? 0
    if (n > 0) {
      shared++
      pool.set(w, n - 1)
    }
  }
  return shared / short.length
}

/**
 * True when a mic line is the other person's voice leaking from the speakers
 * into the microphone. Very short lines ("yeah", "okay") are never treated as echo.
 */
export function isEcho(a: TranscriptEntry, b: TranscriptEntry): boolean {
  if (a.speaker === b.speaker) return false
  if (Math.abs(a.at - b.at) > ECHO_WINDOW_MS) return false
  if (Math.min(words(a.text).length, words(b.text).length) < 3) return false
  return overlap(a.text, b.text) >= 0.6
}

export class Transcript {
  readonly entries: TranscriptEntry[] = []
  private readonly max: number

  constructor(max = 2000) {
    this.max = max
  }

  /**
   * Adds an entry in time order. Returns false if it was dropped as echo.
   * Computer audio is the clean copy, so a matching mic line loses either way.
   */
  add(entry: TranscriptEntry): boolean {
    const twin = this.entries.findIndex((e) => isEcho(e, entry))
    if (twin !== -1) {
      if (entry.speaker === 'me') return false
      this.entries.splice(twin, 1)
    }
    // Clips finish transcribing out of order; keep the list sorted by time.
    let i = this.entries.length
    while (i > 0 && this.entries[i - 1].at > entry.at) i--
    this.entries.splice(i, 0, entry)
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max)
    return true
  }

  recent(minutes: number, now: number): TranscriptEntry[] {
    const cutoff = now - minutes * 60_000
    return this.entries.filter((e) => e.at >= cutoff)
  }

  clear(): void {
    this.entries.length = 0
  }
}

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** A readable Markdown record of the session, for saving to a file. */
export function sessionMarkdown(
  entries: TranscriptEntry[],
  exchanges: { question: string; answer: string }[],
  at: number
): string {
  const lines = [`# Screen Copilot session, ${new Date(at).toLocaleString()}`, '', '## Transcript', '']
  if (entries.length === 0) lines.push('_No transcript._')
  for (const e of entries) lines.push(`**${clock(e.at)} ${e.speaker === 'me' ? 'Me' : 'Them'}:** ${e.text}  `)
  lines.push('', '## Questions and answers', '')
  if (exchanges.length === 0) lines.push('_None._')
  for (const x of exchanges) lines.push(`### ${x.question}`, '', x.answer, '')
  return lines.join('\n').trimEnd() + '\n'
}
