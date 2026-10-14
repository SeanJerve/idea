import { Segmenter, type Segment } from './vad.ts'
import { concat } from './wav.ts'

export const SAMPLE_RATE = 16_000

/**
 * Taps a MediaStream, resamples it to 16 kHz mono, and reports finished
 * utterances. Can also record everything verbatim (for spoken questions).
 */
export class StreamCapture {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private segmenter = new Segmenter({ sampleRate: SAMPLE_RATE })
  private recording: Float32Array[] | null = null
  /** While muted, audio is dropped (used while our own voice reply plays). */
  muted = false

  constructor(
    readonly stream: MediaStream,
    private readonly onSegment: (seg: Segment) => void
  ) {}

  get level(): number {
    return this.segmenter.level
  }

  get speaking(): boolean {
    return this.segmenter.speaking
  }

  async start(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    await this.ctx.audioWorklet.addModule('./pcm-tap.js')
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-tap', { channelCount: 1, channelCountMode: 'explicit' })
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handle(e.data)
    // The worklet only runs when connected to the output; a zero gain keeps it silent.
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    source.connect(this.node).connect(sink).connect(this.ctx.destination)
  }

  /** Starts recording everything (bypassing voice detection) until stopRecording(). */
  startRecording(): void {
    this.segmenter.reset()
    this.recording = []
  }

  stopRecording(): Float32Array | null {
    const chunks = this.recording
    this.recording = null
    return chunks && chunks.length ? concat(chunks) : null
  }

  mute(on: boolean): void {
    this.muted = on
    if (on) this.segmenter.reset()
  }

  async stop(): Promise<void> {
    const tail = this.segmenter.flush()
    if (tail && !this.muted) this.onSegment(tail)
    this.node?.port.close()
    this.stream.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.ctx = null
  }

  private handle(block: Float32Array): void {
    if (this.recording) {
      this.recording.push(block)
      return
    }
    if (this.muted) return
    for (const seg of this.segmenter.push(block)) this.onSegment(seg)
  }
}

export async function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    video: false
  })
}

/**
 * Everything the computer plays (Windows loopback). The main process answers
 * getDisplayMedia without showing a picker. The video track is discarded.
 */
export async function openSystemAudio(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  stream.getVideoTracks().forEach((t) => {
    t.stop()
    stream.removeTrack(t)
  })
  if (stream.getAudioTracks().length === 0) {
    throw new Error('System audio capture is only available on Windows.')
  }
  return stream
}
