import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { transcribe } from '../src/main/transcribe.ts'

interface Seen {
  path: string
  auth: string | undefined
  fields: Record<string, string>
  fileType: string
  fileSize: number
}

let server: Server
let baseUrl = ''
let seen: Seen[] = []
let responses: { status: number; body: string }[] = []

async function readForm(req: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const request = new Request('http://local', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body: Buffer.concat(chunks)
  })
  return request.formData()
}

before(async () => {
  server = createServer(async (req, res) => {
    const form = await readForm(req)
    const fields: Record<string, string> = {}
    let fileType = ''
    let fileSize = 0
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') fields[k] = v
      else {
        fileType = v.type
        fileSize = v.size
      }
    }
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, fields, fileType, fileSize })
    const next = responses.shift() ?? { status: 200, body: JSON.stringify({ text: '  hello world ' }) }
    res.writeHead(next.status, { 'content-type': 'application/json' })
    res.end(next.body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`
})

after(() => server.close())

const settings = () => ({ sttBaseUrl: baseUrl, sttApiKey: 'key-123', sttModel: 'whisper-test', sttLanguage: '' })
const wav = new Uint8Array(100).buffer
const fast = { retryDelayMs: 1 }

test('posts a multipart WAV with model and auth, and trims the text', async () => {
  seen = []
  responses = []
  const text = await transcribe(wav, settings(), fast)
  assert.equal(text, 'hello world')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].path, '/v1/audio/transcriptions')
  assert.equal(seen[0].auth, 'Bearer key-123')
  assert.equal(seen[0].fields.model, 'whisper-test')
  assert.equal(seen[0].fields.response_format, 'json')
  assert.equal(seen[0].fields.language, undefined)
  assert.equal(seen[0].fileType, 'audio/wav')
  assert.equal(seen[0].fileSize, 100)
})

test('sends the language when one is set', async () => {
  seen = []
  await transcribe(wav, { ...settings(), sttLanguage: 'tl' }, fast)
  assert.equal(seen[0].fields.language, 'tl')
})

test('retries rate limits and server errors, then succeeds', async () => {
  seen = []
  responses = [
    { status: 429, body: 'slow down' },
    { status: 503, body: 'busy' },
    { status: 200, body: JSON.stringify({ text: 'third time' }) }
  ]
  assert.equal(await transcribe(wav, settings(), fast), 'third time')
  assert.equal(seen.length, 3)
})

test('gives up after the retry budget', async () => {
  seen = []
  responses = [
    { status: 500, body: 'a' },
    { status: 500, body: 'b' }
  ]
  await assert.rejects(transcribe(wav, settings(), { retries: 1, retryDelayMs: 1 }), /\(500\)/)
  assert.equal(seen.length, 2)
})

test('does not retry a bad request', async () => {
  seen = []
  responses = [{ status: 400, body: 'bad audio' }]
  await assert.rejects(transcribe(wav, settings(), fast), /\(400\): bad audio/)
  assert.equal(seen.length, 1)
})

test('explains a rejected key', async () => {
  responses = [{ status: 401, body: 'nope' }]
  await assert.rejects(transcribe(wav, settings(), fast), /API key was rejected/)
})

test('requires a key before calling anything', async () => {
  seen = []
  await assert.rejects(transcribe(wav, { ...settings(), sttApiKey: '' }), /Add a speech-to-text API key/)
  assert.equal(seen.length, 0)
})

test('missing text field yields an empty string', async () => {
  responses = [{ status: 200, body: '{}' }]
  assert.equal(await transcribe(wav, settings(), fast), '')
})
