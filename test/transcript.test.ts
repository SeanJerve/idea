import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transcript, isEcho, overlap, sessionMarkdown } from '../src/renderer/src/transcript.ts'

const T0 = 1_700_000_000_000

test('keeps entries in time order when clips finish out of order', () => {
  const t = new Transcript()
  t.add({ speaker: 'me', text: 'second', at: T0 + 2000 })
  t.add({ speaker: 'them', text: 'first', at: T0 + 1000 })
  t.add({ speaker: 'me', text: 'third', at: T0 + 3000 })
  assert.deepEqual(t.entries.map((e) => e.text), ['first', 'second', 'third'])
})

test('caps the number of entries, dropping the oldest', () => {
  const t = new Transcript(3)
  for (let i = 0; i < 5; i++) t.add({ speaker: 'me', text: `line ${i}`, at: T0 + i * 20_000 })
  assert.deepEqual(t.entries.map((e) => e.text), ['line 2', 'line 3', 'line 4'])
})

test('drops a mic line that echoes what the computer just played', () => {
  const t = new Transcript()
  t.add({ speaker: 'them', text: 'Can you walk me through your last project?', at: T0 })
  const kept = t.add({ speaker: 'me', text: 'can you walk me through your last project', at: T0 + 400 })
  assert.equal(kept, false)
  assert.equal(t.entries.length, 1)
})

test('replaces an earlier mic echo when the clean computer-audio line arrives', () => {
  const t = new Transcript()
  t.add({ speaker: 'me', text: 'tell me about a time you failed', at: T0 })
  assert.equal(t.add({ speaker: 'them', text: 'Tell me about a time you failed.', at: T0 + 300 }), true)
  assert.deepEqual(t.entries.map((e) => e.speaker), ['them'])
})

test('short replies and distant lines are never treated as echo', () => {
  assert.equal(isEcho({ speaker: 'them', text: 'Okay.', at: T0 }, { speaker: 'me', text: 'okay', at: T0 + 100 }), false)
  assert.equal(
    isEcho({ speaker: 'them', text: 'what is your biggest strength', at: T0 }, { speaker: 'me', text: 'what is your biggest strength', at: T0 + 60_000 }),
    false
  )
  assert.equal(
    isEcho({ speaker: 'me', text: 'what is your biggest strength', at: T0 }, { speaker: 'me', text: 'what is your biggest strength', at: T0 }),
    false
  )
})

test('different sentences on the same topic are kept', () => {
  const t = new Transcript()
  t.add({ speaker: 'them', text: 'What did you build with React last year?', at: T0 })
  assert.equal(t.add({ speaker: 'me', text: 'I built a dashboard for a logistics company.', at: T0 + 3000 }), true)
})

test('overlap counts repeated words once per occurrence', () => {
  assert.equal(overlap('a a a b', 'a b c d'), 0.5)
  assert.equal(overlap('', 'anything'), 0)
})

test('recent() and clear()', () => {
  const t = new Transcript()
  t.add({ speaker: 'me', text: 'old', at: T0 })
  t.add({ speaker: 'me', text: 'new', at: T0 + 5 * 60_000 })
  assert.deepEqual(t.recent(3, T0 + 6 * 60_000).map((e) => e.text), ['new'])
  t.clear()
  assert.equal(t.entries.length, 0)
})

test('sessionMarkdown lists the transcript and the answers', () => {
  const md = sessionMarkdown(
    [
      { speaker: 'them', text: 'Hello there.', at: T0 },
      { speaker: 'me', text: 'Hi!', at: T0 + 1000 }
    ],
    [{ question: 'What should I say?', answer: 'Say thanks.' }],
    T0
  )
  assert.match(md, /^# Screen Copilot session/)
  assert.match(md, /\*\*\d\d:\d\d:\d\d Them:\*\* Hello there\./)
  assert.match(md, /\*\*\d\d:\d\d:\d\d Me:\*\* Hi!/)
  assert.match(md, /### What should I say\?\n\nSay thanks\./)
  assert.ok(md.endsWith('\n'))
})

test('sessionMarkdown handles an empty session', () => {
  const md = sessionMarkdown([], [], T0)
  assert.match(md, /_No transcript._/)
  assert.match(md, /_None._/)
})
