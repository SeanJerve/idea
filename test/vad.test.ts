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
