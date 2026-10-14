import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLikelyNoise, takeSentences, toSpeakable } from '../src/renderer/src/speech-text.ts'

test('takeSentences keeps the unfinished tail', () => {
  const r = takeSentences('First one. Second one! Third is still go')
  assert.deepEqual(r.sentences, ['First one.', 'Second one!'])
  assert.equal(r.rest, ' Third is still go')
})

test('takeSentences waits for whitespace after a period (decimals, versions)', () => {
  const r = takeSentences('Version 3.5 is out')
  assert.deepEqual(r.sentences, [])
})

test('takeSentences splits on newlines', () => {
  assert.deepEqual(takeSentences('- item one\n- item two\n').sentences, ['- item one', '- item two'])
})

test('toSpeakable strips markdown', () => {
  assert.equal(toSpeakable('## Fix\n- Use **`npm ci`** [docs](http://x)'), 'Fix Use npm ci docs')
})

test('isLikelyNoise flags stock hallucinations only', () => {
  assert.ok(isLikelyNoise('Thanks for watching!'))
  assert.ok(isLikelyNoise('...'))
  assert.ok(!isLikelyNoise('Thank you, that makes sense.'))
})
