import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayHotkey, duplicateHotkeys, hotkeyFromKeyEvent, parseHotkey } from '../src/shared/hotkeys.ts'
import { DEFAULT_HOTKEYS } from '../src/shared/types.ts'

const ok = (s: string) => {
  const r = parseHotkey(s)
  assert.ok(r.ok, `${s}: ${!r.ok && r.error}`)
  return r.ok ? r.accelerator : ''
}
const bad = (s: string) => {
  const r = parseHotkey(s)
  assert.ok(!r.ok, `${s} should be rejected`)
  return r.ok ? '' : r.error
}

test('accepts and normalizes common shortcuts', () => {
  assert.equal(ok('ctrl+shift+space'), 'Control+Shift+Space')
  assert.equal(ok('CommandOrControl+Shift+A'), 'CommandOrControl+Shift+A')
  assert.equal(ok('Alt + q'), 'Alt+Q')
  assert.equal(ok('F9'), 'F9')
  assert.equal(ok('Ctrl+Alt+F12'), 'Control+Alt+F12')
  assert.equal(ok('Ctrl+/'), 'Control+/')
  assert.equal(ok('ctrl+pageup'), 'Control+PageUp')
})

test('rejects shortcuts that would hijack typing or are malformed', () => {
  assert.match(bad('A'), /Add Ctrl, Alt, or Shift/)
  assert.match(bad('Shift+A'), /Shift alone/)
  assert.match(bad('Ctrl+Shift'), /Add a key/)
  assert.match(bad('Ctrl+A+B'), /only one key/)
  assert.match(bad('Ctrl+Ctrl+A'), /twice/)
  assert.match(bad('Ctrl+Banana'), /isn't a key/)
  assert.match(bad(''), /Enter a shortcut/)
})

test('all default shortcuts are valid and distinct', () => {
  for (const acc of Object.values(DEFAULT_HOTKEYS)) ok(acc)
  assert.deepEqual(duplicateHotkeys(DEFAULT_HOTKEYS), [])
})

test('defaults avoid Microsoft Teams meeting shortcuts', () => {
  const teams = ['K', 'M', 'O', 'E', 'H', 'B', 'D', 'S'].map((k) => `commandorcontrol+shift+${k.toLowerCase()}`)
  for (const acc of Object.values(DEFAULT_HOTKEYS)) assert.ok(!teams.includes(acc.toLowerCase()), acc)
})

test('finds duplicates even when written differently', () => {
  assert.deepEqual(duplicateHotkeys({ a: 'Ctrl+Shift+A', b: 'control+shift+a', c: 'Alt+A' }), [['a', 'b']])
})

test('records key presses by physical key', () => {
  const ev = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods
  })
  assert.equal(hotkeyFromKeyEvent(ev('KeyQ', { ctrlKey: true, shiftKey: true })), 'CommandOrControl+Shift+Q')
  assert.equal(hotkeyFromKeyEvent(ev('Digit5', { altKey: true })), 'Alt+5')
  assert.equal(hotkeyFromKeyEvent(ev('Space', { ctrlKey: true })), 'CommandOrControl+Space')
  assert.equal(hotkeyFromKeyEvent(ev('F8')), 'F8')
  assert.equal(hotkeyFromKeyEvent(ev('Slash', { ctrlKey: true })), 'CommandOrControl+/')
  assert.equal(hotkeyFromKeyEvent(ev('Numpad7', { ctrlKey: true })), 'CommandOrControl+num7')
  assert.equal(hotkeyFromKeyEvent(ev('ShiftLeft', { shiftKey: true })), null)
  // Every recorded shortcut parses.
  ok(hotkeyFromKeyEvent(ev('KeyZ', { ctrlKey: true, altKey: true, metaKey: true })) ?? '')
})

test('display form is friendly', () => {
  assert.equal(displayHotkey('CommandOrControl+Shift+Space'), 'Ctrl + Shift + Space')
  assert.equal(displayHotkey('Super+Alt+K'), 'Win + Alt + K')
})
