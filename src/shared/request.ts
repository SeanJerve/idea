import type Anthropic from '@anthropic-ai/sdk'
import { getMode } from './modes.ts'
import { SYSTEM_PROMPT, TRANSLATE_SYSTEM, buildUserText, translatePrompt } from './prompt.ts'
import type { AskRequest, Settings } from './types'

/** Models that accept the server-side refusal fallback ("default" routing). */
export const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

export type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming
export type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming

function fallbackFor(model: string): Pick<StreamParams, 'betas' | 'fallbacks'> {
  return FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}
}

/** Builds the Messages API request for one question. Each question is a fresh single-turn request. */
export function buildRequest(
  req: AskRequest,
  settings: Pick<Settings, 'model' | 'effort' | 'replyMode' | 'customInstructions' | 'replyLanguage'>,
  screenshot: string | null,
  now: number
): Omit<StreamParams, 'stream'> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  const attachments = req.images ?? []
  for (const img of attachments) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
  }
  if (attachments.length === 0 && screenshot) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } })
  }

  const mode = getMode(req.modeId)
  content.push({
    type: 'text',
    text: buildUserText(req, {
      now,
      replyMode: settings.replyMode,
      customInstructions: settings.customInstructions,
      visual: attachments.length > 0 ? 'attachments' : screenshot ? 'screenshot' : 'none',
      modeName: mode.name,
      modeInstructions: mode.instructions,
      replyLanguage: settings.replyLanguage,
      spoken: req.spoken
    })
  })

  return {
    model: settings.model,
    max_tokens: 16000,
    output_config: { effort: settings.effort },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    ...fallbackFor(settings.model)
  }
}

/** A short, fast request that translates one transcript line. */
export function buildTranslateRequest(text: string, language: string, model: string): CreateParams {
  return {
    model,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: TRANSLATE_SYSTEM,
    messages: [{ role: 'user', content: translatePrompt(text, language) }],
    ...fallbackFor(model)
  }
}
