import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUserText, formatTranscript, recentTranscript } from '../src/shared/prompt.ts'

const now = 1_000_000

test('formats transcript with speakers and age', () => {
  const text = formatTranscript(
    [
      { speaker: 'them', text: 'Tell me about yourself.', at: now - 30_000 },
      { speaker: 'me', text: 'Sure.', at: now - 5_000 }
    ],
    now
  )
  assert.equal(text, '[30s ago] Them: Tell me about yourself.\n[5s ago] Me: Sure.')
})

test('recentTranscript drops old entries', () => {
  const entries = [
    { speaker: 'me' as const, text: 'old', at: now - 10 * 60_000 },
    { speaker: 'me' as const, text: 'new', at: now - 60_000 }
  ]
  assert.deepEqual(
    recentTranscript(entries, 3, now).map((e) => e.text),
    ['new']
  )
})

test('buildUserText includes the request, voice style, and history', () => {
  const text = buildUserText(
    { id: '1', kind: 'question', question: 'What does this error mean?', transcript: [], history: [{ question: 'q1', answer: 'a1' }] },
    { now, replyMode: 'voice', customInstructions: '', hasScreenshot: true }
  )
  assert.match(text, /<request>\nWhat does this error mean\?\n<\/request>$/)
  assert.match(text, /spoken aloud/)
  assert.match(text, /User: q1\nYou: a1/)
  assert.doesNotMatch(text, /No screenshot/)
})

test('suggest-reply uses a built-in task', () => {
  const text = buildUserText(
    { id: '1', kind: 'suggest-reply', question: '', transcript: [], history: [] },
    { now, replyMode: 'text', customInstructions: 'Be brief.', hasScreenshot: false }
  )
  assert.match(text, /Suggest what I could say next/)
  assert.match(text, /No screenshot/)
  assert.match(text, /Be brief\./)
  assert.doesNotMatch(text, /spoken aloud/)
})
