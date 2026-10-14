import type { Settings } from '@shared/types'

/** Sends one WAV clip to an OpenAI-compatible /audio/transcriptions endpoint. */
export async function transcribe(wav: ArrayBuffer, settings: Settings): Promise<string> {
  if (!settings.sttApiKey) throw new Error('Add a speech-to-text API key in Settings.')

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
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Speech-to-text failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}
