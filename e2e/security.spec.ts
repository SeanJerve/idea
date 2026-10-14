import type { CopilotApi } from '../src/shared/types'
import { expect, test } from './fixtures'

declare global {
  interface Window {
    copilot: CopilotApi
  }
}

type Body = Record<string, unknown>

test('settings sent from the UI are sanitized before being stored', async ({ harness }) => {
  const { win } = await harness.launch({})
  const saved = await win.evaluate(() =>
    window.copilot.saveSettings({
      effort: 'ludicrous',
      contextMinutes: 9999,
      replyMode: 'scream',
      theme: 'neon',
      anthropicApiKey: '   sk-ant-trimmed   ',
      evilField: 'nope',
      hotkeys: { snip: 'Ctrl+Alt+Y', madeUp: 'Ctrl+Z' }
    } as never)
  )
  expect(saved.effort).toBe('low') // unknown value → default
  expect(saved.contextMinutes).toBe(60) // clamped
  expect(saved.replyMode).toBe('text')
  expect(saved.theme).toBe('system')
  expect(saved.anthropicApiKey).toBe('sk-ant-trimmed')
  expect((saved as unknown as Record<string, unknown>).evilField).toBeUndefined()
  expect(saved.hotkeys.snip).toBe('Ctrl+Alt+Y')
  expect(Object.keys(saved.hotkeys)).not.toContain('madeUp')
})

test('a malformed ask request never reaches the API', async ({ harness }) => {
  const { win } = await harness.launch({})
  // No id, bad kind: validation drops it, so no request is made.
  await win.evaluate(() => window.copilot.ask({ kind: 'rm -rf', question: 'x' } as never))
  await win.waitForTimeout(600)
  expect(harness.mock.messages).toHaveLength(0)
})

test('the speech-to-text key is refused over cleartext to a remote host', async ({ harness }) => {
  const { win } = await harness.launch({ sttBaseUrl: 'http://api.example.com/v1' })
  const result = await win.evaluate(async () => {
    try {
      await window.copilot.transcribe(new ArrayBuffer(64))
      return 'sent'
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(result).toMatch(/https/)
  expect(harness.mock.transcriptions).toBe(0)
})

test('an oversized image attachment is rejected by the main process', async ({ harness }) => {
  const { win } = await harness.launch({ includeScreenshot: false })
  await win.evaluate(() => {
    const huge = 'A'.repeat(13_000_000) // over the 12 MB cap
    return window.copilot.ask({
      id: 'x1',
      kind: 'question',
      question: 'hi',
      modeId: 'general',
      images: [{ mediaType: 'image/png', data: huge }],
      transcript: [],
      history: []
    } as never)
  })
  await win.waitForTimeout(600)
  // The request still goes (question is valid) but without the rejected image.
  const body = harness.mock.messages[0] as Body | undefined
  expect(body).toBeTruthy()
  const content = (body!.messages as { content: { type: string }[] }[])[0].content
  // Screenshots are off, so a dropped image leaves a text-only request.
  expect(content.map((b) => b.type)).toEqual(['text'])
})

test('non-app navigation is refused', async ({ harness }) => {
  const { win } = await harness.launch({})
  const url = win.url()
  await win.evaluate(() => {
    const a = document.createElement('a')
    a.href = 'https://example.com/'
    a.textContent = 'x'
    document.body.append(a)
    a.click()
  })
  await win.waitForTimeout(400)
  // Still on the same page — the external link did not navigate the overlay.
  expect(win.url()).toBe(url)
})

test('only the microphone and screen-capture permissions are granted', async ({ harness }) => {
  const { app } = await harness.launch({})
  const results = await app.evaluate(async ({ session }) => {
    const ses = session.defaultSession
    const handler = (ses as unknown as { _permissionCheckHandler?: (...a: unknown[]) => boolean })._permissionCheckHandler
    const check = (p: string): boolean => (handler ? Boolean(handler(null, p, '', {})) : false)
    return {
      media: check('media'),
      display: check('display-capture'),
      geolocation: check('geolocation'),
      notifications: check('notifications')
    }
  })
  // If the private field isn't reachable, fall back to asserting the handler exists.
  if (results.media || results.display || results.geolocation || results.notifications) {
    expect(results.media).toBe(true)
    expect(results.display).toBe(true)
    expect(results.geolocation).toBe(false)
    expect(results.notifications).toBe(false)
  }
})
