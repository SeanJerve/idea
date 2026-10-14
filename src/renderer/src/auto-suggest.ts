import type { TranscriptEntry } from '../../shared/types'

const QUESTION_START =
  /^(so,?\s+)?(what|why|how|when|where|who|which|can|could|would|will|should|do|does|did|is|are|was|were|have|has|tell me|walk me|talk me|describe|explain|give me)\b/i

/** Rough check for whether a transcribed line asks something. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  if (/\?["')\]]*$/.test(t)) return true
  return t.split(/\s+/).length >= 4 && QUESTION_START.test(t)
}

export interface AutoSuggestOptions {
  /** Quiet time after the question before suggesting, so they can finish talking. */
  delayMs?: number
  /** Minimum time between automatic suggestions. */
  cooldownMs?: number
}

/**
 * Decides when to suggest a reply on its own: after the other side asks a
 * question and then stops talking, unless the user has already started answering.
 * Call onEntry() for each transcript line and poll() on a timer.
 */
export class AutoSuggest {
  private readonly delayMs: number
  private readonly cooldownMs: number
  private dueAt: number | null = null
  private lastFired = -Infinity

  constructor(opts: AutoSuggestOptions = {}) {
    this.delayMs = opts.delayMs ?? 1200
    this.cooldownMs = opts.cooldownMs ?? 15_000
  }

  get pending(): boolean {
    return this.dueAt !== null
  }

  onEntry(entry: TranscriptEntry, now: number): void {
    if (entry.speaker === 'me') {
      // The user is already answering.
      this.dueAt = null
    } else if (looksLikeQuestion(entry.text) || this.dueAt !== null) {
      this.dueAt = now + this.delayMs
    }
  }

  /** Returns true exactly when a suggestion should be made now. */
  poll(now: number, theyAreTalking: boolean): boolean {
    if (this.dueAt === null) return false
    if (theyAreTalking) {
      this.dueAt = Math.max(this.dueAt, now + this.delayMs)
      return false
    }
    if (now < this.dueAt) return false
    this.dueAt = null
    if (now - this.lastFired < this.cooldownMs) return false
    this.lastFired = now
    return true
  }

  cancel(): void {
    this.dueAt = null
  }
}
