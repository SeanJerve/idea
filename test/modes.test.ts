import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODES, getMode } from '../src/shared/modes.ts'

test('every mode is well formed', () => {
  const ids = new Set<string>()
  for (const mode of MODES) {
    assert.ok(!ids.has(mode.id), `duplicate mode ${mode.id}`)
    ids.add(mode.id)
    assert.ok(mode.name && mode.hint, `${mode.id} needs a name and hint`)
    assert.ok(mode.actions.length >= 2 && mode.actions.length <= 4, `${mode.id} should have 2-4 quick actions`)
    const actionIds = new Set<string>()
    for (const a of mode.actions) {
      assert.ok(!actionIds.has(a.id), `duplicate action ${a.id} in ${mode.id}`)
      actionIds.add(a.id)
      assert.ok(a.label.length <= 24, `label too long: ${a.label}`)
      assert.ok(a.prompt || a.kind, `${mode.id}/${a.id} needs a prompt or kind`)
      if (typeof a.transcript === 'number') assert.ok(a.transcript > 0)
    }
  }
})

test('general mode adds no instructions; the others do', () => {
  assert.equal(getMode('general').instructions, '')
  for (const m of MODES.filter((m) => m.id !== 'general')) assert.ok(m.instructions.length > 40, m.id)
})

test('covers the main use cases', () => {
  for (const id of ['general', 'meeting', 'interview', 'coding', 'study', 'translator', 'accessibility']) {
    assert.equal(getMode(id).id, id)
  }
})

test('only the translator translates live; read & describe always speaks', () => {
  assert.deepEqual(MODES.filter((m) => m.liveTranslate).map((m) => m.id), ['translator'])
  assert.ok(getMode('accessibility').actions.every((a) => a.speak))
})

test('unknown ids fall back to General', () => {
  assert.equal(getMode('does-not-exist').id, 'general')
})
