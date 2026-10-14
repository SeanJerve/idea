import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AutoSuggest, looksLikeQuestion } from '../src/renderer/src/auto-suggest.ts'

test('looksLikeQuestion', () => {
  const yes = [
    'What are your salary expectations?',
    'Tell me about yourself',
    'so how would you design a rate limiter',
    'Can you walk me through the code',
    'Why did you leave your last job?"'
  ]
  const no = ['Thanks for joining today.', 'We use React and Go.', 'What?!'.slice(0, 4), 'How', 'okay so']
  for (const q of yes) assert.ok(looksLikeQuestion(q), q)
  for (const q of no) assert.ok(!looksLikeQuestion(q), q)
})

const them = (text: string) => ({ speaker: 'them' as const, text, at: 0 })
const me = (text: string) => ({ speaker: 'me' as const, text, at: 0 })

test('fires once after the question and a pause', () => {
  const a = new AutoSuggest({ delayMs: 1000, cooldownMs: 10_000 })
  a.onEntry(them('How do you handle conflict on a team?'), 0)
  assert.equal(a.poll(500, false), false)
  assert.equal(a.poll(1000, false), true)
  assert.equal(a.poll(1500, false), false)
})

test('statements alone never fire', () => {
  const a = new AutoSuggest({ delayMs: 1000 })
  a.onEntry(them('We are a team of twelve engineers.'), 0)
  assert.equal(a.pending, false)
  assert.equal(a.poll(5000, false), false)
})

test('waits while they keep talking', () => {
  const a = new AutoSuggest({ delayMs: 1000 })
  a.onEntry(them('What is your experience with Kubernetes?'), 0)
  assert.equal(a.poll(1200, true), false)
  assert.equal(a.poll(1800, false), false)
  // Follow-up statement after the question pushes it back again.
  a.onEntry(them('We run everything on EKS.'), 2000)
  assert.equal(a.poll(2500, false), false)
  assert.equal(a.poll(3000, false), true)
})

test('the user answering cancels the suggestion', () => {
  const a = new AutoSuggest({ delayMs: 1000 })
  a.onEntry(them('Any questions for us?'), 0)
  a.onEntry(me('Yes, what does a typical day look like?'), 500)
  assert.equal(a.poll(2000, false), false)
})

test('cooldown limits how often it fires', () => {
  const a = new AutoSuggest({ delayMs: 100, cooldownMs: 10_000 })
  a.onEntry(them('First question?'), 0)
  assert.equal(a.poll(100, false), true)
  a.onEntry(them('Second question?'), 1000)
  assert.equal(a.poll(1100, false), false)
  assert.equal(a.pending, false)
  a.onEntry(them('Third question?'), 20_000)
  assert.equal(a.poll(20_100, false), true)
})

test('cancel() clears a pending suggestion', () => {
  const a = new AutoSuggest({ delayMs: 100 })
  a.onEntry(them('Ready to start?'), 0)
  a.cancel()
  assert.equal(a.poll(1000, false), false)
})
