import type Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, buildUserText } from './prompt.ts'
import type { AskRequest, Settings } from './types'

/** Models that accept the server-side refusal fallback ("default" routing). */
export const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

export type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming

/** Builds the Messages API request for one question. Each question is a fresh single-turn request. */
export function buildRequest(
  req: AskRequest,
  settings: Pick<Settings, 'model' | 'effort' | 'replyMode' | 'customInstructions'>,
  screenshot: string | null,
  now: number
): Omit<StreamParams, 'stream'> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (screenshot) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } })
  }
  content.push({
    type: 'text',
    text: buildUserText(req, {
      now,
      replyMode: settings.replyMode,
      customInstructions: settings.customInstructions,
      hasScreenshot: screenshot !== null
    })
  })

  return {
    model: settings.model,
    max_tokens: 16000,
    output_config: { effort: settings.effort },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    ...(FALLBACK_MODELS.has(settings.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {})
  }
}
