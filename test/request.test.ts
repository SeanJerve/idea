import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequest, buildTranslateRequest } from '../src/shared/request.ts'
import type { AskRequest } from '../src/shared/types.ts'

const req: AskRequest = { id: 'x', kind: 'question', question: 'What is this?', modeId: 'general', images: [], transcript: [], history: [] }
const base = { model: 'claude-opus-5-5', effort: 'low' as const, replyMode: 'text' as const, customInstructions: '', replyLanguage: '' }
type Block = { type: string; text?: string; source?: { media_type: string; data: string } }
const blocks = (p: ReturnType<typeof buildRequest>): Block[] => p.messages[0].content as Block[]

test('sends the screenshot before the text, as JPEG', () => {
  const content = blocks(buildRequest(req, base, 'AAAA', 0))
  assert.deepEqual(content.map((b) => b.type), ['image', 'text'])
  assert.equal(content[0].source?.media_type, 'image/jpeg')
  assert.equal(content[0].source?.data, 'AAAA')
})

test('text only when there is no screenshot', () => {
  const content = blocks(buildRequest(req, base, null, 0))
  assert.deepEqual(content.map((b) => b.type), ['text'])
  assert.match(content[0].text ?? '', /No screenshot/)
})

test('attached images replace the full screenshot', () => {
  const withImages: AskRequest = {
    ...req,
    images: [
      { mediaType: 'image/png', data: 'PNG1' },
      { mediaType: 'image/jpeg', data: 'JPG2' }
    ]
  }
  const content = blocks(buildRequest(withImages, base, 'SCREEN', 0))
  assert.deepEqual(content.map((b) => b.source?.data ?? 'text'), ['PNG1', 'JPG2', 'text'])
  assert.equal(content[0].source?.media_type, 'image/png')
  assert.match(content[2].text ?? '', /chose to show you/)
})

test('mode instructions and reply language reach the prompt', () => {
  const content = blocks(buildRequest({ ...req, modeId: 'coding' }, { ...base, replyLanguage: 'Spanish' }, null, 0))
  assert.match(content[0].text ?? '', /<mode name="Coding">/)
  assert.match(content[0].text ?? '', /Answer in Spanish\./)
})

test('unknown modes fall back to General (no mode block)', () => {
  const content = blocks(buildRequest({ ...req, modeId: 'nope' }, base, null, 0))
  assert.doesNotMatch(content[0].text ?? '', /<mode/)
})

test('passes model and effort, single user turn, streaming-sized max_tokens', () => {
  const params = buildRequest(req, { ...base, effort: 'high' }, null, 0)
  assert.equal(params.model, 'claude-opus-5-5')
  assert.deepEqual(params.output_config, { effort: 'high' })
  assert.equal(params.messages.length, 1)
  assert.equal(params.messages[0].role, 'user')
  assert.equal(params.max_tokens, 16000)
  assert.ok(typeof params.system === 'string' && params.system.length > 0)
})

test('enables refusal fallback only on models that support it', () => {
  const opus = buildRequest(req, base, null, 0)
  assert.equal(opus.fallbacks, 'default')
  assert.deepEqual(opus.betas, ['server-side-fallback-2026-07-01'])

  const haiku = buildRequest(req, { ...base, model: 'claude-haiku-5-5' }, null, 0)
  assert.equal(haiku.fallbacks, undefined)
  assert.equal(haiku.betas, undefined)
})

test('translation requests are short, low effort, and name the language', () => {
  const p = buildTranslateRequest('Bonjour à tous', 'English', 'claude-haiku-5-5')
  assert.equal(p.model, 'claude-haiku-5-5')
  assert.deepEqual(p.output_config, { effort: 'low' })
  assert.ok(p.max_tokens <= 4000)
  assert.match(String(p.system), /SAME/)
  assert.equal(p.messages[0].content, 'Target language: English\n\nLine:\nBonjour à tous')
  assert.equal(p.fallbacks, undefined)
  assert.equal(buildTranslateRequest('x', 'English', 'claude-opus-5-5').fallbacks, 'default')
})
