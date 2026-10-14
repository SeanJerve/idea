import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRequest } from '../src/shared/request.ts'
import type { AskRequest } from '../src/shared/types.ts'

const req: AskRequest = { id: 'x', kind: 'question', question: 'What is this?', transcript: [], history: [] }
const base = { model: 'claude-opus-5-5', effort: 'low' as const, replyMode: 'text' as const, customInstructions: '' }

test('sends the screenshot before the text, as JPEG', () => {
  const params = buildRequest(req, base, 'AAAA', 0)
  const content = params.messages[0].content as { type: string; source?: { media_type: string; data: string } }[]
  assert.equal(content.length, 2)
  assert.equal(content[0].type, 'image')
  assert.equal(content[0].source?.media_type, 'image/jpeg')
  assert.equal(content[0].source?.data, 'AAAA')
  assert.equal(content[1].type, 'text')
})

test('text only when there is no screenshot', () => {
  const params = buildRequest(req, base, null, 0)
  const content = params.messages[0].content as { type: string; text?: string }[]
  assert.equal(content.length, 1)
  assert.match(content[0].text ?? '', /No screenshot/)
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
