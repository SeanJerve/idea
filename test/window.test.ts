import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restoreBounds } from '../src/shared/window.ts'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }
const fallback = { x: 1456, y: 24, width: 440, height: 600 }

test('first launch uses the fallback', () => {
  assert.deepEqual(restoreBounds(null, [primary], fallback), fallback)
})

test('restores a window that is fully on screen', () => {
  const saved = { x: 100, y: 100, width: 500, height: 700 }
  assert.deepEqual(restoreBounds(saved, [primary], fallback), saved)
})

test('falls back when the saved monitor is gone', () => {
  const saved = { x: 2500, y: 200, width: 440, height: 600 }
  assert.deepEqual(restoreBounds(saved, [primary], fallback), fallback)
  assert.deepEqual(restoreBounds(saved, [primary, right], fallback), saved)
})

test('pulls a partly off-screen window back inside', () => {
  const saved = { x: 1700, y: -50, width: 440, height: 600 }
  assert.deepEqual(restoreBounds(saved, [primary], fallback), { x: 1480, y: 0, width: 440, height: 600 })
})

test('shrinks a window larger than the screen', () => {
  const saved = { x: 0, y: 0, width: 3000, height: 2000 }
  assert.deepEqual(restoreBounds(saved, [primary], fallback), { x: 0, y: 0, width: 1920, height: 1040 })
})
