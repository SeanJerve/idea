import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIMITS,
  isSafeSttBaseUrl,
  sanitizeSettingsPatch,
  validateAskRequest
} from '../src/shared/validate.ts'
import { DEFAULT_HOTKEYS } from '../src/shared/types.ts'

// ---------- isSafeSttBaseUrl ----------

test('accepts https anywhere and http only on the local machine', () => {
  assert.ok(isSafeSttBaseUrl('https://api.openai.com/v1'))
  assert.ok(isSafeSttBaseUrl('https://api.groq.com/openai/v1'))
  assert.ok(isSafeSttBaseUrl('http://localhost:11434/v1'))
  assert.ok(isSafeSttBaseUrl('http://127.0.0.1:8000/v1'))
  assert.ok(isSafeSttBaseUrl('http://whisper.localhost/v1'))

  assert.ok(!isSafeSttBaseUrl('http://api.openai.com/v1'), 'cleartext to a remote host')
  assert.ok(!isSafeSttBaseUrl('http://10.0.0.5/v1'))
  assert.ok(!isSafeSttBaseUrl('ftp://localhost/v1'))
  assert.ok(!isSafeSttBaseUrl('not a url'))
  assert.ok(!isSafeSttBaseUrl(''))
})

// ---------- sanitizeSettingsPatch ----------

test('keeps only known keys', () => {
  const out = sanitizeSettingsPatch({ model: 'claude-haiku-5-5', evilField: 'x', __proto__: { polluted: true } })
  assert.deepEqual(Object.keys(out), ['model'])
  assert.equal(out.model, 'claude-haiku-5-5')
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('rejects wrong types instead of storing them', () => {
  const out = sanitizeSettingsPatch({ captureMic: 'yes', contextMinutes: 'ten', anthropicApiKey: 123 })
  assert.equal(out.captureMic, undefined)
  assert.equal(out.contextMinutes, undefined)
  assert.equal(out.anthropicApiKey, undefined)
})

test('clamps numbers to their ranges', () => {
  assert.equal(sanitizeSettingsPatch({ contextMinutes: 999 }).contextMinutes, 60)
  assert.equal(sanitizeSettingsPatch({ contextMinutes: 0 }).contextMinutes, 1)
  assert.equal(sanitizeSettingsPatch({ voiceRate: 9 }).voiceRate, 2)
  assert.equal(sanitizeSettingsPatch({ overlayOpacity: 0.1 }).overlayOpacity, 0.4)
  assert.equal(sanitizeSettingsPatch({ contextMinutes: 3.7 }).contextMinutes, 4)
})

test('coerces enums to a safe value', () => {
  assert.equal(sanitizeSettingsPatch({ effort: 'ludicrous' }).effort, 'low')
  assert.equal(sanitizeSettingsPatch({ replyMode: 'scream' }).replyMode, 'text')
  assert.equal(sanitizeSettingsPatch({ theme: 'neon' }).theme, 'system')
  assert.equal(sanitizeSettingsPatch({ mode: 'nope' }).mode, 'general')
  assert.equal(sanitizeSettingsPatch({ effort: 'low' }).effort, 'low')
})

test('trims strings and enforces length caps', () => {
  assert.equal(sanitizeSettingsPatch({ anthropicApiKey: '  sk-ant-x  ' }).anthropicApiKey, 'sk-ant-x')
  assert.equal(sanitizeSettingsPatch({ customInstructions: 'x'.repeat(LIMITS.customInstructions + 1) }).customInstructions, undefined)
})

test('hotkeys fall back per-action and never add unknown actions', () => {
  const out = sanitizeSettingsPatch({ hotkeys: { snip: 'Ctrl+Alt+Y', bogus: 'Ctrl+Z', 'focus-input': 42 } })
  assert.equal(out.hotkeys?.snip, 'Ctrl+Alt+Y')
  assert.equal(out.hotkeys?.['focus-input'], DEFAULT_HOTKEYS['focus-input'])
  assert.ok(!('bogus' in (out.hotkeys ?? {})))
  assert.deepEqual(Object.keys(out.hotkeys ?? {}).sort(), Object.keys(DEFAULT_HOTKEYS).sort())
})

test('windowBounds must be four finite numbers or null', () => {
  assert.deepEqual(sanitizeSettingsPatch({ windowBounds: { x: 1, y: 2, width: 3, height: 4 } }).windowBounds, {
    x: 1,
    y: 2,
    width: 3,
    height: 4
  })
  assert.equal(sanitizeSettingsPatch({ windowBounds: null }).windowBounds, null)
  assert.equal(sanitizeSettingsPatch({ windowBounds: { x: 'a' } }).windowBounds, undefined)
  assert.equal(sanitizeSettingsPatch({ windowBounds: { x: 1, y: 2, width: Infinity, height: 4 } }).windowBounds, undefined)
})

test('non-objects yield an empty patch', () => {
  assert.deepEqual(sanitizeSettingsPatch(null), {})
  assert.deepEqual(sanitizeSettingsPatch('hi'), {})
  assert.deepEqual(sanitizeSettingsPatch(undefined), {})
})

// ---------- validateAskRequest ----------

const base = {
  id: 'abc',
  kind: 'question',
  question: 'What is this?',
  modeId: 'coding',
  images: [],
  transcript: [],
  history: []
}

test('accepts a well-formed request', () => {
  const r = validateAskRequest(base)
  assert.ok(r)
  assert.equal(r?.modeId, 'coding')
  assert.equal(r?.spoken, false)
})

test('rejects missing id or unknown kind', () => {
  assert.equal(validateAskRequest({ ...base, id: '' }), null)
  assert.equal(validateAskRequest({ ...base, id: undefined }), null)
  assert.equal(validateAskRequest({ ...base, kind: 'delete-everything' }), null)
  assert.equal(validateAskRequest(null), null)
})

test('unknown modes fall back to general', () => {
  assert.equal(validateAskRequest({ ...base, modeId: 'evil' })?.modeId, 'general')
})

test('caps the number of images and drops malformed ones', () => {
  const good = { mediaType: 'image/png', data: 'QUJD' }
  const r = validateAskRequest({
    ...base,
    images: [good, good, good, good, good, good, { mediaType: 'image/svg+xml', data: 'QUJD' }, { data: 'x' }]
  })
  assert.equal(r?.images.length, LIMITS.images)
  assert.ok(r?.images.every((i) => i.mediaType === 'image/png'))
})

test('rejects images whose data is not clean base64', () => {
  assert.equal(validateAskRequest({ ...base, images: [{ mediaType: 'image/png', data: 'data:image/png;base64,QUJD' }] })?.images.length, 0)
  assert.equal(validateAskRequest({ ...base, images: [{ mediaType: 'image/png', data: '<svg/>' }] })?.images.length, 0)
})

test('keeps only the most recent transcript and history', () => {
  const entries = Array.from({ length: LIMITS.transcriptEntries + 50 }, (_, i) => ({ speaker: 'me', text: `t${i}`, at: i }))
  const r = validateAskRequest({ ...base, transcript: entries })
  assert.equal(r?.transcript.length, LIMITS.transcriptEntries)
  assert.equal(r?.transcript.at(-1)?.text, `t${entries.length - 1}`)
  assert.equal(r?.transcript[0]?.text, `t50`)

  const history = Array.from({ length: 30 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }))
  assert.equal(validateAskRequest({ ...base, history })?.history.length, LIMITS.historyEntries)
})

test('malformed transcript entries are dropped', () => {
  const r = validateAskRequest({
    ...base,
    transcript: [{ speaker: 'me', text: 'ok', at: 1 }, { speaker: 'alien', text: 'x', at: 2 }, { speaker: 'them', at: 3 }]
  })
  assert.equal(r?.transcript.length, 1)
  assert.equal(r?.transcript[0]?.text, 'ok')
})

test('over-long question is rejected; non-array fields become empty', () => {
  assert.equal(validateAskRequest({ ...base, question: 'x'.repeat(LIMITS.question + 1) }), null)
  const r = validateAskRequest({ ...base, images: 'nope', transcript: 5, history: {} })
  assert.deepEqual([r?.images, r?.transcript, r?.history], [[], [], []])
})

test('spoken is only true when exactly true', () => {
  assert.equal(validateAskRequest({ ...base, spoken: 'yes' })?.spoken, false)
  assert.equal(validateAskRequest({ ...base, spoken: true })?.spoken, true)
})
