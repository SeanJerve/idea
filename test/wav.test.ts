import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav } from '../src/renderer/src/audio/wav.ts'

test('writes a valid 16-bit mono WAV header and clamps samples', () => {
  const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000)
  const v = new DataView(buf)
  const str = (o: number, n: number): string => String.fromCharCode(...new Uint8Array(buf, o, n))
  assert.equal(buf.byteLength, 44 + 8)
  assert.equal(str(0, 4), 'RIFF')
  assert.equal(str(8, 4), 'WAVE')
  assert.equal(v.getUint16(22, true), 1)
  assert.equal(v.getUint32(24, true), 16_000)
  assert.equal(v.getUint32(40, true), 8)
  assert.equal(v.getInt16(44, true), 0)
  assert.equal(v.getInt16(46, true), 32767)
  assert.equal(v.getInt16(48, true), -32768)
  assert.equal(v.getInt16(50, true), 32767)
})
