import Anthropic from '@anthropic-ai/sdk'
import { parseTranslation } from '@shared/prompt'
import { buildRequest, buildTranslateRequest } from '@shared/request'
import type { AskRequest, AssistantEvent, Settings } from '@shared/types'

const running = new Map<string, AbortController>()
/** Requests cancelled before they reached the API (e.g. while the screenshot was taken). */
const cancelledEarly = new Set<string>()

export function cancel(id: string): void {
  const controller = running.get(id)
  if (controller) controller.abort()
  else cancelledEarly.add(id)
}

export async function ask(
  req: AskRequest,
  settings: Settings,
  screenshot: string | null,
  emit: (e: AssistantEvent) => void
): Promise<void> {
  if (cancelledEarly.delete(req.id)) return
  if (!settings.anthropicApiKey) {
    emit({ id: req.id, type: 'error', message: 'Add your Anthropic API key in Settings.' })
    return
  }

  const client = new Anthropic({ apiKey: settings.anthropicApiKey })
  const controller = new AbortController()
  running.set(req.id, controller)

  try {
    const stream = client.beta.messages.stream(buildRequest(req, settings, screenshot, Date.now()), {
      signal: controller.signal
    })

    let text = ''
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        emit({ id: req.id, type: 'delta', text: event.delta.text })
      }
    }

    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      emit({ id: req.id, type: 'error', message: 'The model declined to answer this one.' })
      return
    }
    emit({ id: req.id, type: 'done', text })
  } catch (err) {
    if (controller.signal.aborted) {
      emit({ id: req.id, type: 'error', message: 'Cancelled.' })
    } else if (err instanceof Anthropic.AuthenticationError) {
      emit({ id: req.id, type: 'error', message: 'Your Anthropic API key was rejected. Check it in Settings.' })
    } else if (err instanceof Anthropic.RateLimitError) {
      emit({ id: req.id, type: 'error', message: 'Rate limited by the API. Try again in a moment.' })
    } else if (err instanceof Anthropic.APIError) {
      emit({ id: req.id, type: 'error', message: `API error ${err.status ?? ''}: ${err.message}` })
    } else {
      emit({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    running.delete(req.id)
  }
}

/** Translates one transcript line; null when it's already in the target language. */
export async function translate(text: string, settings: Settings): Promise<string | null> {
  if (!settings.anthropicApiKey) throw new Error('Add your Anthropic API key in Settings.')
  const language = settings.replyLanguage.trim() || 'English'
  const client = new Anthropic({ apiKey: settings.anthropicApiKey })
  const message = await client.beta.messages.create(buildTranslateRequest(text, language, settings.translateModel))
  if (message.stop_reason === 'refusal') return null
  const reply = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return parseTranslation(reply, text)
}
