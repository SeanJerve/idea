import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUserText, formatTranscript, taskText } from '../src/shared/prompt.ts'

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

test('only the last four earlier exchanges are included', () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }))
  const text = buildUserText(
    { id: '1', kind: 'question', question: 'next', transcript: [], history },
    { now, replyMode: 'text', customInstructions: '', hasScreenshot: true }
  )
  assert.doesNotMatch(text, /User: q1\n/)
  assert.match(text, /User: q2\n/)
  assert.match(text, /User: q5\n/)
})

test('empty transcript is stated plainly', () => {
  assert.equal(formatTranscript([], now), '(nothing transcribed yet)')
})

test('future timestamps never show negative ages', () => {
  assert.match(formatTranscript([{ speaker: 'me', text: 'hi', at: now + 5000 }], now), /^\[0s ago\]/)
})

test('taskText trims typed questions and has built-in summaries', () => {
  assert.equal(taskText({ kind: 'question', question: '  why?  ' }), 'why?')
  assert.match(taskText({ kind: 'summarize', question: '' }), /^Summarize/)
})
