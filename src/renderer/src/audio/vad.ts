import { concat } from './wav.ts'

export interface SegmenterOptions {
  sampleRate: number
  frameMs?: number
  /** Audio kept from just before speech starts, so first syllables aren't clipped. */
  preRollMs?: number
  /** Silence that ends an utterance. */
  hangoverMs?: number
  /** Utterances with less speech than this are dropped as noise. */
  minSpeechMs?: number
  /** Long monologues are cut here so transcripts keep flowing. */
  maxSegmentMs?: number
  /** Absolute floor for the speech threshold (RMS). */
  minThreshold?: number
  /** Speech must be this many times louder than the tracked noise floor. */
  noiseMultiplier?: number
}

export interface Segment {
  samples: Float32Array
  /** Index of the first sample of the segment, counted from the first push(). */
  startSample: number
}

/**
 * Energy-based voice activity detector. Feed it audio in any block size and it
 * returns finished utterances. The speech threshold follows the background noise.
 */
export class Segmenter {
  private readonly frameSize: number
  private readonly preRollFrames: number
  private readonly hangoverFrames: number
  private readonly minSpeechFrames: number
  private readonly maxFrames: number
  private readonly minThreshold: number
  private readonly noiseMultiplier: number

  private pending = new Float32Array(0)
  private preRoll: Float32Array[] = []
  private active: Float32Array[] | null = null
  private activeStart = 0
  private speechFrames = 0
  private silentFrames = 0
  private loudStreak = 0
  private noiseFloor = 0.004
  private consumed = 0

  /** RMS of the latest frame, for level meters. */
  level = 0

  constructor(opts: SegmenterOptions) {
    const frameMs = opts.frameMs ?? 20
    const frames = (ms: number): number => Math.max(1, Math.round(ms / frameMs))
    this.frameSize = Math.round((opts.sampleRate * frameMs) / 1000)
    this.preRollFrames = frames(opts.preRollMs ?? 300)
    this.hangoverFrames = frames(opts.hangoverMs ?? 700)
    this.minSpeechFrames = frames(opts.minSpeechMs ?? 250)
    this.maxFrames = frames(opts.maxSegmentMs ?? 20_000)
    this.minThreshold = opts.minThreshold ?? 0.01
    this.noiseMultiplier = opts.noiseMultiplier ?? 3
  }

  get speaking(): boolean {
    return this.active !== null
  }

  push(block: Float32Array): Segment[] {
    const data = this.pending.length ? concat([this.pending, block]) : block
    const out: Segment[] = []
    let i = 0
    for (; i + this.frameSize <= data.length; i += this.frameSize) {
      const seg = this.processFrame(data.slice(i, i + this.frameSize))
      if (seg) out.push(seg)
    }
    this.pending = data.slice(i)
    return out
  }

  /** Ends the current utterance now (if it has enough speech) and returns it. */
  flush(): Segment | null {
    if (!this.active) return null
    return this.finish()
  }

  /** Drops any utterance in progress, e.g. while our own text-to-speech is playing. */
  reset(): void {
    this.active = null
    this.preRoll = []
    this.loudStreak = 0
  }

  private threshold(): number {
    return Math.max(this.minThreshold, this.noiseFloor * this.noiseMultiplier)
  }

  private processFrame(frame: Float32Array): Segment | null {
    let sum = 0
    for (let k = 0; k < frame.length; k++) sum += frame[k] * frame[k]
    const rms = Math.sqrt(sum / frame.length)
    this.level = rms
    const loud = rms > this.threshold()
    const frameStart = this.consumed
    this.consumed += frame.length

    if (!this.active) {
      if (loud) {
        this.loudStreak++
      } else {
        this.loudStreak = 0
        // Track the noise floor only while nobody is talking.
        this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02
      }
      this.preRoll.push(frame)
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift()
      // Two loud frames in a row starts an utterance; one click doesn't.
      if (this.loudStreak >= 2) {
        this.active = this.preRoll
        this.activeStart = frameStart + frame.length - this.preRoll.length * this.frameSize
        this.preRoll = []
        this.speechFrames = this.loudStreak
        this.silentFrames = 0
        this.loudStreak = 0
      }
      return null
    }

    this.active.push(frame)
    if (loud) {
      this.speechFrames++
      this.silentFrames = 0
    } else {
      this.silentFrames++
    }
    if (this.silentFrames >= this.hangoverFrames || this.active.length >= this.maxFrames) {
      return this.finish()
    }
    return null
  }

  private finish(): Segment | null {
    const frames = this.active ?? []
    const enough = this.speechFrames >= this.minSpeechFrames
    this.active = null
    this.speechFrames = 0
    this.silentFrames = 0
    if (!enough) return null
    return { samples: concat(frames), startSample: this.activeStart }
  }
}
