import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, buildUserText } from '@shared/prompt'
import type { AskRequest, AssistantEvent, Settings } from '@shared/types'

/** Models that accept the server-side refusal fallback ("default" routing). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

const running = new Map<string, AbortController>()

export function cancel(id: string): void {
  running.get(id)?.abort()
}

export async function ask(
  req: AskRequest,
  settings: Settings,
  screenshot: string | null,
  emit: (e: AssistantEvent) => void
): Promise<void> {
  if (!settings.anthropicApiKey) {
    emit({ id: req.id, type: 'error', message: 'Add your Anthropic API key in Settings.' })
    return
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (screenshot) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } })
  }
  content.push({
    type: 'text',
    text: buildUserText(req, {
      now: Date.now(),
      replyMode: settings.replyMode,
      customInstructions: settings.customInstructions,
      hasScreenshot: screenshot !== null
    })
  })

  const client = new Anthropic({ apiKey: settings.anthropicApiKey })
  const controller = new AbortController()
  running.set(req.id, controller)
  const useFallback = FALLBACK_MODELS.has(settings.model)

  try {
    const stream = client.beta.messages.stream(
      {
        model: settings.model,
        max_tokens: 16000,
        output_config: { effort: settings.effort },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
      },
      { signal: controller.signal }
    )

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
