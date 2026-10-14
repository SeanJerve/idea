import { takeSentences, toSpeakable } from './speech-text.ts'

/**
 * Speaks a streamed answer sentence by sentence using the voices built into
 * Windows, so the reply starts before the whole answer has arrived.
 */
export class VoiceReply {
  private buffer = ''
  private pending = 0
  private generation = 0

  constructor(
    private readonly getVoice: () => { name: string; rate: number },
    private readonly onSpeakingChange: (speaking: boolean) => void
  ) {}

  feed(delta: string): void {
    this.buffer += delta
    const { sentences, rest } = takeSentences(this.buffer)
    this.buffer = rest
    sentences.forEach((s) => this.say(s))
  }

  finish(): void {
    const tail = this.buffer
    this.buffer = ''
    if (tail.trim()) this.say(tail)
  }

  stop(): void {
    this.generation++
    this.buffer = ''
    this.pending = 0
    speechSynthesis.cancel()
    this.onSpeakingChange(false)
  }

  private say(text: string): void {
    const spoken = toSpeakable(text)
    if (!spoken) return
    const u = new SpeechSynthesisUtterance(spoken)
    const { name, rate } = this.getVoice()
    const voice = speechSynthesis.getVoices().find((v) => v.name === name)
    if (voice) u.voice = voice
    u.rate = rate
    const gen = this.generation
    const done = (): void => {
      if (gen !== this.generation) return
      this.pending = Math.max(0, this.pending - 1)
      if (this.pending === 0) this.onSpeakingChange(false)
    }
    u.onend = done
    u.onerror = done
    if (this.pending === 0) this.onSpeakingChange(true)
    this.pending++
    speechSynthesis.speak(u)
  }
}
