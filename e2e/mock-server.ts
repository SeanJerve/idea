import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** What the fake Claude endpoint should do for the next request. */
export interface ClaudeReply {
  text?: string
  /** Delay between streamed chunks. */
  chunkDelayMs?: number
  status?: number
  errorType?: string
}

export interface MockServer {
  url: string
  /** JSON bodies sent to /v1/messages, in order. */
  messages: Record<string, unknown>[]
  /** Headers of those requests. */
  messageHeaders: IncomingMessage['headers'][]
  transcriptions: number
  /** Requests whose client hung up before the reply finished. */
  aborted: number
  claudeReplies: ClaudeReply[]
  /** Replies for non-streaming (translation) requests. Default: "EN: <line>". */
  translationReplies: string[]
  transcriptTexts: string[]
  close(): Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Splits text into small pieces so the UI sees a real stream. */
function chunks(text: string): string[] {
  return text.match(/.{1,12}/gs) ?? []
}

export async function startMockServer(): Promise<MockServer> {
  const state: MockServer = {
    url: '',
    messages: [],
    messageHeaders: [],
    transcriptions: 0,
    aborted: 0,
    claudeReplies: [],
    translationReplies: [],
    transcriptTexts: [],
    close: async () => {}
  }

  async function handleMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = JSON.parse((await body(req)).toString('utf8'))
    state.messages.push(json)
    state.messageHeaders.push(req.headers)
    if (!json.stream) {
      // Live translation: a short, non-streaming request.
      const line = String(json.messages[0].content).split('Line:\n')[1] ?? ''
      const text = state.translationReplies.shift() ?? `EN: ${line}`
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: `msg_${state.messages.length}`,
          type: 'message',
          role: 'assistant',
          model: json.model,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 }
        })
      )
      return
    }

    const reply = state.claudeReplies.shift() ?? {}

    if (reply.status && reply.status !== 200) {
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: reply.errorType ?? 'api_error', message: 'mock error' } }))
      return
    }

    const content = json.messages[0].content as { type: string; text?: string }[]
    const question = (content.find((b) => b.type === 'text')?.text ?? '').match(/<request>\n([\s\S]*?)\n<\/request>/)?.[1]
    const text = reply.text ?? `**Mock answer** for: ${question}`

    let closed = false
    res.on('close', () => {
      if (!res.writableFinished) {
        closed = true
        state.aborted++
      }
    })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: `msg_${state.messages.length}`,
        type: 'message',
        role: 'assistant',
        model: json.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 }
      }
    })
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    for (const piece of chunks(text)) {
      if (closed) return
      sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } })
      await sleep(reply.chunkDelayMs ?? 5)
    }
    if (closed) return
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 20 }
    })
    sse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  }

  async function handleTranscription(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await body(req)
    state.transcriptions++
    const text = state.transcriptTexts.shift() ?? 'Hello from the fake microphone.'
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ text }))
  }

  const server: Server = createServer((req, res) => {
    const route = req.url?.split('?')[0]
    const handler =
      route === '/v1/messages' ? handleMessages : route === '/v1/audio/transcriptions' ? handleTranscription : null
    if (!handler) {
      res.writeHead(404).end()
      return
    }
    handler(req, res).catch((err) => {
      res.writeHead(500).end(String(err))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  state.close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections()
      server.close(() => r())
    })
  return state
}
