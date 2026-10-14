import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Segmenter } from '../src/renderer/src/audio/vad.ts'

const RATE = 16_000

function tone(ms: number, amp: number): Float32Array {
  const n = (RATE * ms) / 1000
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}

function noise(ms: number, amp: number): Float32Array {
  const n = (RATE * ms) / 1000
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * (Math.random() * 2 - 1)
  return out
}

/** Feeds audio in worklet-sized blocks and collects segments. */
function feed(seg: Segmenter, audio: Float32Array): Float32Array[] {
  const found: Float32Array[] = []
  for (let i = 0; i < audio.length; i += 2048) {
    for (const s of seg.push(audio.slice(i, i + 2048))) found.push(s.samples)
  }
  return found
}

test('detects one utterance between silences', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  const found = [...feed(seg, noise(1000, 0.002)), ...feed(seg, tone(1500, 0.3)), ...feed(seg, noise(1500, 0.002))]
  assert.equal(found.length, 1)
  const seconds = found[0].length / RATE
  // Speech + pre-roll + hangover.
  assert.ok(seconds > 1.5 && seconds < 2.8, `segment was ${seconds}s`)
})

test('ignores background noise and short clicks', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  const found = [...feed(seg, noise(3000, 0.003)), ...feed(seg, tone(40, 0.5)), ...feed(seg, noise(2000, 0.003))]
  assert.equal(found.length, 0)
})

test('splits two utterances separated by a pause', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  const audio = [noise(500, 0.002), tone(800, 0.3), noise(1200, 0.002), tone(800, 0.3), noise(1200, 0.002)]
  const found = audio.flatMap((a) => feed(seg, a))
  assert.equal(found.length, 2)
})

test('cuts long monologues at maxSegmentMs', () => {
  const seg = new Segmenter({ sampleRate: RATE, maxSegmentMs: 2000 })
  const found = feed(seg, tone(5000, 0.3))
  assert.ok(found.length >= 2, `got ${found.length} segments`)
  for (const s of found) assert.ok(s.length / RATE <= 2.05)
})

test('flush returns speech in progress', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  feed(seg, tone(800, 0.3))
  assert.ok(seg.speaking)
  assert.ok(seg.flush())
  assert.equal(seg.speaking, false)
})

test('adapts to steady background noise (fan, hum) instead of streaming it', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  // Noise above the absolute threshold: at most one short false start while the floor adapts...
  const fromNoise = feed(seg, noise(20_000, 0.03))
  assert.ok(fromNoise.length <= 1, `noise produced ${fromNoise.length} segments`)
  for (const s of fromNoise) assert.ok(s.length / RATE < 8, `noise segment ${s.length / RATE}s`)
  assert.equal(seg.speaking, false)
  // ...and real speech on top of it is still picked up.
  const fromSpeech = [...feed(seg, tone(1200, 0.4)), ...feed(seg, noise(1500, 0.03))]
  assert.equal(fromSpeech.length, 1)
})

test('pre-roll keeps the start of the word', () => {
  const seg = new Segmenter({ sampleRate: RATE, preRollMs: 300 })
  const lead = noise(1000, 0.002)
  const speech = tone(1000, 0.3)
  const [segment] = [...feed(seg, lead), ...feed(seg, speech), ...feed(seg, noise(1500, 0.002))]
  // The segment begins before the tone did.
  assert.ok(segment.length / RATE >= 1.0 + 0.25, `segment ${segment.length / RATE}s`)
})

test('reset() discards speech in progress', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  feed(seg, tone(600, 0.3))
  seg.reset()
  assert.equal(seg.speaking, false)
  assert.equal(seg.flush(), null)
})

test('handles odd block sizes', () => {
  const seg = new Segmenter({ sampleRate: RATE })
  const audio = [noise(500, 0.002), tone(1000, 0.3), noise(1500, 0.002)]
  const found: Float32Array[] = []
  for (const a of audio) {
    for (let i = 0; i < a.length; i += 333) for (const s of seg.push(a.slice(i, i + 333))) found.push(s.samples)
  }
  assert.equal(found.length, 1)
})
