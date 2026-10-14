import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ask, expect, sendHotkey, test } from './fixtures'

type Block = { type: string; text?: string; source?: { media_type: string } }
const userContent = (body: Record<string, unknown>): Block[] =>
  (body.messages as { content: Block[] }[])[0].content

test('first launch asks for API keys', async ({ harness }) => {
  const { win } = await harness.launch()
  await expect(win.locator('#banner')).toContainText('add your API keys')
  await ask(win, 'Hello?')
  await expect(win.locator('.exchange .a').last()).toHaveText('Add your Anthropic API key in Settings.')
  expect(harness.mock.messages).toHaveLength(0)
})

test('a typed question streams a markdown answer, with a screenshot attached', async ({ harness }) => {
  const { win } = await harness.launch({})
  await ask(win, 'What is on my screen?')

  const answer = win.locator('.exchange .a').last()
  await expect(answer.locator('strong')).toHaveText('Mock answer')
  await expect(answer).toContainText('for: What is on my screen?')

  const body = harness.mock.messages[0]
  expect(body.model).toBe('claude-opus-5-5')
  expect(body.stream).toBe(true)
  expect(body.output_config).toEqual({ effort: 'low' })
  expect(body.fallbacks).toBe('default')
  expect(harness.mock.messageHeaders[0]['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
  expect(harness.mock.messageHeaders[0]['x-api-key']).toBe('test-key')

  const content = userContent(body)
  expect(content[0].type).toBe('image')
  expect(content[0].source?.media_type).toBe('image/jpeg')
  expect(content[1].text).toContain('<request>\nWhat is on my screen?\n</request>')
})

test('screenshots can be turned off', async ({ harness }) => {
  const { win } = await harness.launch({ includeScreenshot: false })
  await ask(win, 'Just text please')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  const content = userContent(harness.mock.messages[0])
  expect(content.map((b) => b.type)).toEqual(['text'])
})

test('follow-up questions carry earlier answers', async ({ harness }) => {
  const { win } = await harness.launch({})
  harness.mock.claudeReplies.push({ text: 'The capital is Manila.' })
  await ask(win, 'Capital of the Philippines?')
  await expect(win.locator('.exchange .a').last()).toHaveText('The capital is Manila.')

  await ask(win, 'And its population?')
  await expect(win.locator('.exchange')).toHaveCount(2)
  await expect(win.locator('.exchange .a').last()).toContainText('And its population?')
  const text = userContent(harness.mock.messages[1]).at(-1)?.text ?? ''
  expect(text).toContain('User: Capital of the Philippines?\nYou: The capital is Manila.')
})

test('asking again stops the answer in progress', async ({ harness }) => {
  const { win } = await harness.launch({})
  harness.mock.claudeReplies.push({ text: 'slow '.repeat(200), chunkDelayMs: 50 })
  await ask(win, 'Long one')
  await expect(win.locator('.exchange .a').first()).toContainText('slow')

  await ask(win, 'Short one')
  await expect(win.locator('.exchange .a').last()).toContainText('for: Short one')
  await expect.poll(() => harness.mock.aborted).toBe(1)
  // The first answer stopped growing.
  const first = await win.locator('.exchange .a').first().textContent()
  await win.waitForTimeout(400)
  expect(await win.locator('.exchange .a').first().textContent()).toBe(first)
})

test('API errors become readable messages', async ({ harness }) => {
  const { win } = await harness.launch({})
  harness.mock.claudeReplies.push({ status: 401, errorType: 'authentication_error' })
  await ask(win, 'Will this work?')
  await expect(win.locator('.exchange .a.error')).toHaveText(
    'Your Anthropic API key was rejected. Check it in Settings.'
  )
})

test('quick actions send their built-in requests', async ({ harness }) => {
  const { win } = await harness.launch({})
  await win.click('#btn-suggest')
  await expect(win.locator('.exchange .q').last()).toContainText('What should I say?')
  await expect(win.locator('.exchange .a strong')).toHaveCount(1)
  await win.click('#btn-summarize')
  await expect(win.locator('.exchange .a strong')).toHaveCount(2)

  expect(userContent(harness.mock.messages[0]).at(-1)?.text).toContain('Suggest what I could say next')
  expect(userContent(harness.mock.messages[1]).at(-1)?.text).toContain('Summarize the conversation')
})

test('listening transcribes the microphone into the live transcript', async ({ harness }) => {
  const { win } = await harness.launch({})
  harness.mock.transcriptTexts.push('Can you explain closures in JavaScript?')
  await win.click('#btn-listen')
  await expect(win.locator('#listen-dot')).toHaveClass(/on/)

  const line = win.locator('#transcript p.me').first()
  await expect(line).toContainText('Can you explain closures in JavaScript?', { timeout: 20_000 })
  await expect(line.locator('.who')).toHaveText('Me')

  // The transcript goes along with the next question.
  await ask(win, 'Answer that')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  expect(userContent(harness.mock.messages[0]).at(-1)?.text).toMatch(/Me: Can you explain closures in JavaScript\?/)

  await win.click('#btn-listen')
  await expect(win.locator('#listen-dot')).not.toHaveClass(/on/)
})

test('a spoken question is transcribed and answered', async ({ harness }) => {
  const { app, win } = await harness.launch({})
  harness.mock.transcriptTexts.push('What does this error mean?')
  await sendHotkey(app, 'voice-question')
  await expect(win.locator('#btn-voice')).toHaveClass(/active/)
  await expect(win.locator('#banner')).toContainText('Listening to your question')
  await win.waitForTimeout(1500)
  await sendHotkey(app, 'voice-question')

  await expect(win.locator('.exchange .q').last()).toContainText('What does this error mean?')
  await expect(win.locator('.exchange .a').last()).toContainText('for: What does this error mean?')
  await expect(win.locator('#btn-voice')).not.toHaveClass(/active/)
})

test('settings are saved and survive a restart', async ({ harness }) => {
  const first = await harness.launch({})
  const { win } = first
  await win.click('#btn-settings')
  await win.selectOption('select[name=model]', 'claude-haiku-5-5')
  await win.selectOption('select[name=effort]', 'high')
  await win.check('input[name=autoSuggest]')
  await win.fill('textarea[name=customInstructions]', 'Answer in Tagalog.')
  await win.click('#settings-form button[type=submit]')
  await expect(win.locator('#view-settings')).toBeHidden()

  await ask(win, 'Kumusta?')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  const body = harness.mock.messages[0]
  expect(body.model).toBe('claude-haiku-5-5')
  expect(body.output_config).toEqual({ effort: 'high' })
  expect(body.fallbacks).toBeUndefined()
  expect(userContent(body).at(-1)?.text).toContain('Answer in Tagalog.')

  await first.app.close()
  const second = await harness.launch()
  await second.win.click('#btn-settings')
  await expect(second.win.locator('select[name=model]')).toHaveValue('claude-haiku-5-5')
  await expect(second.win.locator('input[name=autoSuggest]')).toBeChecked()
  await expect(second.win.locator('input[name=anthropicApiKey]')).toHaveValue('test-key')
})

test('the reply-mode switch is saved', async ({ harness }) => {
  const { win } = await harness.launch({})
  await win.selectOption('#quick-reply-mode', 'both')
  await expect
    .poll(() => JSON.parse(readFileSync(join(harness.userData, 'settings.json'), 'utf8')).replyMode)
    .toBe('both')
})

test('answers can be copied', async ({ harness }) => {
  const { app, win } = await harness.launch({})
  harness.mock.claudeReplies.push({ text: 'Copy **me**' })
  await ask(win, 'Something to copy')
  await expect(win.locator('.exchange .a strong')).toHaveText('me')
  await win.locator('.exchange').hover()
  await win.click('.exchange .copy')
  await expect(win.locator('.exchange .copy')).toHaveText('Copied')
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Copy **me**')
})

test('the session can be saved as Markdown', async ({ harness }) => {
  const { app, win } = await harness.launch({})
  const target = join(harness.userData, 'session.md')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, target)

  await win.click('#btn-export')
  await expect(win.locator('#banner')).toHaveText('Nothing to save yet.')

  harness.mock.claudeReplies.push({ text: 'Saved answer.' })
  await ask(win, 'Save this')
  await expect(win.locator('.exchange .a')).toHaveText('Saved answer.')
  await win.click('#btn-export')
  await expect(win.locator('#banner')).toContainText('Saved to')
  const md = readFileSync(target, 'utf8')
  expect(md).toContain('### Save this')
  expect(md).toContain('Saved answer.')
})

test('clear removes answers and transcript', async ({ harness }) => {
  const { win } = await harness.launch({})
  await ask(win, 'Something')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  win.once('dialog', (d) => void d.accept())
  await win.click('#btn-clear')
  await expect(win.locator('.exchange')).toHaveCount(0)
  await expect(win.locator('#empty')).toBeVisible()
})

test('Escape hides the overlay', async ({ harness }) => {
  const { app, win } = await harness.launch({})
  await win.locator('#question').focus()
  await win.keyboard.press('Escape')
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false)
})

test('the overlay position is remembered', async ({ harness }) => {
  const first = await harness.launch({})
  await first.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 90, width: 500, height: 640 })
  )
  await expect
    .poll(() => JSON.parse(readFileSync(join(harness.userData, 'settings.json'), 'utf8')).windowBounds)
    .toMatchObject({ x: 120, y: 90, width: 500, height: 640 })
  await first.app.close()

  const second = await harness.launch()
  const bounds = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  expect(bounds).toMatchObject({ x: 120, y: 90, width: 500, height: 640 })
})
