import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitWithin, restoreBounds, selectionToCrop } from '../src/shared/window.ts'

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


test('selection maps to image pixels on a high-DPI screen', () => {
  // 1920x1080 window showing a 3840x2160 capture.
  const crop = selectionToCrop({ x: 100, y: 50, width: 200, height: 100 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 })
  assert.deepEqual(crop, { x: 200, y: 100, width: 400, height: 200 })
})

test('dragging up-left works the same as down-right', () => {
  const view = { width: 1000, height: 800 }
  const image = { width: 1000, height: 800 }
  assert.deepEqual(
    selectionToCrop({ x: 300, y: 300, width: -200, height: -100 }, view, image),
    selectionToCrop({ x: 100, y: 200, width: 200, height: 100 }, view, image)
  )
})

test('selections are clipped to the screen and tiny ones are ignored', () => {
  const view = { width: 1000, height: 800 }
  assert.deepEqual(selectionToCrop({ x: 900, y: 700, width: 300, height: 300 }, view, view), { x: 900, y: 700, width: 100, height: 100 })
  assert.equal(selectionToCrop({ x: 10, y: 10, width: 4, height: 50 }, view, view), null)
  assert.equal(selectionToCrop({ x: 1200, y: 10, width: 50, height: 50 }, view, view), null)
})

test('fitWithin only scales down', () => {
  assert.deepEqual(fitWithin({ width: 3840, height: 2160 }, 1920), { width: 1920, height: 1080 })
  assert.deepEqual(fitWithin({ width: 800, height: 600 }, 1920), { width: 800, height: 600 })
  assert.deepEqual(fitWithin({ width: 1080, height: 4000 }, 2000), { width: 540, height: 2000 })
})
