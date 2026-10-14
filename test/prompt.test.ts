import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUserText,
  formatTranscript,
  parseTranslation,
  taskText,
  translatePrompt,
  type PromptOptions
} from '../src/shared/prompt.ts'
import type { AskRequest, TranscriptEntry } from '../src/shared/types.ts'

const now = 10_000_000
const req = (over: Partial<AskRequest> = {}): AskRequest => ({
  id: '1',
  kind: 'question',
  question: 'What does this error mean?',
  modeId: 'general',
  images: [],
  transcript: [],
  history: [],
  ...over
})
const opts = (over: Partial<PromptOptions> = {}): PromptOptions => ({
  now,
  replyMode: 'text',
  customInstructions: '',
  visual: 'screenshot',
  ...over
})

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

test('older lines show minutes and hours', () => {
  const text = formatTranscript(
    [
      { speaker: 'them', text: 'a', at: now - 3 * 3600_000 - 5 * 60_000 },
      { speaker: 'them', text: 'b', at: now - 10 * 60_000 }
    ],
    now
  )
  assert.equal(text, '[3h5m ago] Them: a\n[10m ago] Them: b')
})

test('long sessions keep the most recent lines within the budget', () => {
  const entries: TranscriptEntry[] = Array.from({ length: 500 }, (_, i) => ({
    speaker: 'them',
    text: `line ${i} ` + 'x'.repeat(80),
    at: now - (500 - i) * 1000
  }))
  const text = formatTranscript(entries, now, 2000)
  assert.ok(text.length < 2300, `length ${text.length}`)
  assert.match(text, /^\(\d+ earlier lines omitted\)/)
  assert.match(text, /line 499 x+$/)
  assert.doesNotMatch(text, /line 0 /)
})

test('empty transcript is stated plainly; future timestamps never go negative', () => {
  assert.equal(formatTranscript([], now), '(nothing transcribed yet)')
  assert.match(formatTranscript([{ speaker: 'me', text: 'hi', at: now + 5000 }], now), /^\[0s ago\]/)
})

test('includes the request, history, and voice style when speaking', () => {
  const text = buildUserText(req({ history: [{ question: 'q1', answer: 'a1' }] }), opts({ replyMode: 'voice' }))
  assert.match(text, /<request>\nWhat does this error mean\?\n<\/request>$/)
  assert.match(text, /spoken aloud/)
  assert.match(text, /User: q1\nYou: a1/)
  assert.doesNotMatch(text, /No screenshot/)
})

test('a forced spoken answer gets the voice style even in text mode', () => {
  assert.match(buildUserText(req(), opts({ spoken: true })), /spoken aloud/)
  assert.doesNotMatch(buildUserText(req(), opts()), /spoken aloud/)
})

test('only the last four earlier exchanges are included', () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }))
  const text = buildUserText(req({ history }), opts())
  assert.doesNotMatch(text, /User: q1\n/)
  assert.match(text, /User: q2\n/)
  assert.match(text, /User: q5\n/)
})

test('describes what visual context came along', () => {
  assert.match(buildUserText(req(), opts({ visual: 'none' })), /No screenshot/)
  assert.match(buildUserText(req(), opts({ visual: 'attachments' })), /area of their screen or a picture/)
})

test('adds mode instructions, preferences, and reply language', () => {
  const text = buildUserText(
    req(),
    opts({ modeName: 'Coding', modeInstructions: 'Read errors carefully.', customInstructions: 'Be brief.', replyLanguage: 'Tagalog' })
  )
  assert.match(text, /<mode name="Coding">\nRead errors carefully\.\n<\/mode>/)
  assert.match(text, /<user_preferences>\nBe brief\.\n<\/user_preferences>/)
  assert.match(text, /Answer in Tagalog\./)
  // The request is always last.
  assert.match(text, /<\/request>$/)
})

test('no mode block or language line when not set', () => {
  const text = buildUserText(req(), opts())
  assert.doesNotMatch(text, /<mode/)
  assert.doesNotMatch(text, /Answer in/)
})

test('built-in tasks', () => {
  assert.equal(taskText({ kind: 'question', question: '  why?  ' }), 'why?')
  assert.match(taskText({ kind: 'suggest-reply', question: '' }), /^Suggest what I could say next/)
  assert.match(taskText({ kind: 'summarize', question: '' }), /^Summarize/)
})

test('translation prompt and reply parsing', () => {
  assert.equal(translatePrompt('Hola', 'English'), 'Target language: English\n\nLine:\nHola')
  assert.equal(parseTranslation(' Hello ', 'Hola'), 'Hello')
  assert.equal(parseTranslation('SAME', 'Hello'), null)
  assert.equal(parseTranslation('SAME.', 'Hello'), null)
  assert.equal(parseTranslation('hello', 'Hello'), null)
  assert.equal(parseTranslation('', 'Hello'), null)
})
