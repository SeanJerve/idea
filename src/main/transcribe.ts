import type { Settings } from '@shared/types'

export interface TranscribeOptions {
  /** Extra attempts after a rate limit, server error, or network failure. */
  retries?: number
  retryDelayMs?: number
  timeoutMs?: number
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, body: string) {
    super(`Speech-to-text failed (${status}): ${body.slice(0, 200)}`)
    this.status = status
  }
}

function retryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500
  // fetch() network errors and timeouts.
  return err instanceof TypeError || (err instanceof DOMException && err.name === 'TimeoutError')
}

async function attempt(
  wav: ArrayBuffer,
  settings: Pick<Settings, 'sttBaseUrl' | 'sttApiKey' | 'sttModel' | 'sttLanguage'>,
  timeoutMs: number
): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')
  form.append('model', settings.sttModel)
  form.append('response_format', 'json')
  if (settings.sttLanguage) form.append('language', settings.sttLanguage)

  const url = settings.sttBaseUrl.replace(/\/+$/, '') + '/audio/transcriptions'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.sttApiKey}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''))
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

/** Sends one WAV clip to an OpenAI-compatible /audio/transcriptions endpoint. */
export async function transcribe(
  wav: ArrayBuffer,
  settings: Pick<Settings, 'sttBaseUrl' | 'sttApiKey' | 'sttModel' | 'sttLanguage'>,
  opts: TranscribeOptions = {}
): Promise<string> {
  if (!settings.sttApiKey) throw new Error('Add a speech-to-text API key in Settings.')
  const retries = opts.retries ?? 2
  const delay = opts.retryDelayMs ?? 600

  for (let i = 0; ; i++) {
    try {
      return await attempt(wav, settings, opts.timeoutMs ?? 30_000)
    } catch (err) {
      if (i >= retries || !retryable(err)) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          throw new Error('Your speech-to-text API key was rejected. Check it in Settings.')
        }
        throw err
      }
      await new Promise((r) => setTimeout(r, delay * 2 ** i))
    }
  }
}
