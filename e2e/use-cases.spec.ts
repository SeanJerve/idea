import type { ElectronApplication, Page } from '@playwright/test'
import { ask, expect, sendHotkey, test } from './fixtures'

type Block = { type: string; text?: string; source?: { media_type: string; data: string } }
type Body = Record<string, unknown>
const userContent = (body: Body): Block[] => (body.messages as { content: Block[] }[])[0].content
const requestText = (body: Body): string => userContent(body).at(-1)?.text ?? ''
const streamed = (bodies: Body[]): Body[] => bodies.filter((b) => b.stream === true)

async function chooseMode(win: Page, name: string): Promise<void> {
  await win.selectOption('#mode-select', { label: name })
}

async function clickAction(win: Page, label: string): Promise<void> {
  await win.locator('#actions button', { hasText: label }).click()
}

/** Counts speechSynthesis.speak calls made by the page from now on. */
async function spyOnSpeech(win: Page): Promise<() => Promise<number>> {
  await win.evaluate(() => {
    const w = window as unknown as { __spoken: string[] }
    w.__spoken = []
    speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.__spoken.push(u.text)
  })
  return () => win.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)
}

/** Makes a small PNG in the page and hands it to the overlay as a paste or drop. */
async function giveImage(win: Page, how: 'paste' | 'drop'): Promise<void> {
  await win.evaluate(async (how) => {
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 80
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#3366ff'
    ctx.fillRect(0, 0, 120, 80)
    ctx.fillStyle = '#fff'
    ctx.fillText('chart', 40, 45)
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'chart.png', { type: 'image/png' }))
    if (how === 'paste') {
      document.getElementById('question')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    } else {
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }
  }, how)
}

async function snipWindow(app: ElectronApplication, trigger: () => Promise<void>): Promise<Page> {
  const [page] = await Promise.all([app.waitForEvent('window'), trigger()])
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('#shot')).toHaveAttribute('src', /^data:image\/png/)
  return page
}

// ---------- modes: one per use case ----------

test.describe('modes', () => {
  test('General is the default and offers its quick actions', async ({ harness }) => {
    const { win } = await harness.launch({})
    await expect(win.locator('#mode-select')).toHaveValue('general')
    await expect(win.locator('#actions button')).toHaveText(['Suggest reply', 'Summarize', "What's this?"])
    await clickAction(win, "What's this?")
    await expect(win.locator('.exchange .a strong')).toBeVisible()
    expect(requestText(harness.mock.messages[0])).toContain("Explain what I'm looking at")
    expect(requestText(harness.mock.messages[0])).not.toContain('<mode')
  })

  test('Meeting: catch up and action items', async ({ harness }) => {
    const { win } = await harness.launch({})
    await chooseMode(win, 'Meeting')
    await expect(win.locator('#mode-hint')).toContainText('Calls and meetings')
    await clickAction(win, 'What did I miss?')
    await expect(win.locator('.exchange .a strong')).toHaveCount(1)
    await clickAction(win, 'Action items')
    await expect(win.locator('.exchange .a strong')).toHaveCount(2)

    const [missed, items] = harness.mock.messages.map(requestText)
    expect(missed).toContain('<mode name="Meeting">')
    expect(missed).toContain('Catch me up on the last few minutes')
    expect(items).toContain('decisions and action items')
  })

  test('Interview practice: structured answers and feedback', async ({ harness }) => {
    const { win } = await harness.launch({})
    await chooseMode(win, 'Interview practice')
    await clickAction(win, 'Help me answer')
    await expect(win.locator('.exchange .a strong')).toHaveCount(1)
    await clickAction(win, 'Rate my answer')
    await expect(win.locator('.exchange .a strong')).toHaveCount(2)
    const [help, rate] = harness.mock.messages.map(requestText)
    expect(help).toContain('situation, task, action, result')
    expect(help).toContain('Suggest what I could say next')
    expect(rate).toContain('feedback on my most recent answer')
  })

  test('Coding: explain the error on screen', async ({ harness }) => {
    const { win } = await harness.launch({})
    await chooseMode(win, 'Coding')
    await expect(win.locator('#actions button')).toHaveText(['Explain this error', 'Find the bug', 'Explain this code'])
    harness.mock.claudeReplies.push({ text: 'Missing import:\n\n```ts\nimport fs from "node:fs"\n```' })
    await clickAction(win, 'Explain this error')
    await expect(win.locator('.exchange .a pre code')).toContainText('import fs')
    const body = harness.mock.messages[0]
    expect(userContent(body)[0].type).toBe('image')
    expect(requestText(body)).toContain('<mode name="Coding">')
  })

  test('Study: explain simply and quiz me', async ({ harness }) => {
    const { win } = await harness.launch({})
    await chooseMode(win, 'Study')
    await clickAction(win, 'Quiz me')
    await expect(win.locator('.exchange .a strong')).toBeVisible()
    expect(requestText(harness.mock.messages[0])).toContain('Ask me three short questions')
    expect(requestText(harness.mock.messages[0])).toContain('<mode name="Study">')
  })

  test('Translator: transcript lines are translated live into the answer language', async ({ harness }) => {
    const { win } = await harness.launch({ mode: 'translator', replyLanguage: 'English', translateModel: 'claude-haiku-5-5' })
    harness.mock.transcriptTexts.push('¿Cuál es tu experiencia con bases de datos?')
    harness.mock.translationReplies.push('What is your experience with databases?')
    await win.click('#btn-listen')
    const line = win.locator('#transcript p').first()
    await expect(line).toContainText('¿Cuál es tu experiencia', { timeout: 20_000 })
    await expect(line.locator('.tr')).toHaveText('What is your experience with databases?')

    const tr = harness.mock.messages.find((b) => b.stream !== true)!
    expect(tr.model).toBe('claude-haiku-5-5')
    expect(String((tr.messages as { content: string }[])[0].content)).toContain('Target language: English')

    await clickAction(win, 'Reply in their language')
    await expect(win.locator('.exchange .a strong')).toBeVisible()
    const reply = requestText(streamed(harness.mock.messages)[0])
    expect(reply).toContain('in the language the other side is speaking')
    expect(reply).toContain('Answer in English.')
  })

  test('Translator: lines already in the target language get no translation', async ({ harness }) => {
    const { win } = await harness.launch({ mode: 'translator', replyLanguage: 'English' })
    harness.mock.transcriptTexts.push('This is already English.')
    harness.mock.translationReplies.push('SAME')
    await win.click('#btn-listen')
    await expect(win.locator('#transcript p').first()).toContainText('already English', { timeout: 20_000 })
    await expect.poll(() => harness.mock.messages.filter((b) => b.stream !== true).length).toBeGreaterThan(0)
    await expect(win.locator('#transcript .tr')).toHaveCount(0)
  })

  test('Other modes never translate', async ({ harness }) => {
    const { win } = await harness.launch({ mode: 'meeting' })
    await win.click('#btn-listen')
    await expect(win.locator('#transcript p.me').first()).toBeVisible({ timeout: 20_000 })
    await win.waitForTimeout(500)
    expect(harness.mock.messages.filter((b) => b.stream !== true)).toHaveLength(0)
  })

  test('Read & describe: answers are read aloud even in text mode', async ({ harness }) => {
    const { win } = await harness.launch({ replyMode: 'text' })
    const spoken = await spyOnSpeech(win)
    await chooseMode(win, 'Read & describe')
    harness.mock.claudeReplies.push({ text: 'You are in a browser. The page shows your inbox. There are three new messages.' })
    await clickAction(win, 'Describe screen')
    await expect(win.locator('.exchange .a')).toContainText('three new messages')
    await expect.poll(spoken).toBeGreaterThanOrEqual(3)
    expect(requestText(harness.mock.messages[0])).toContain('spoken aloud')
  })

  test('the chosen mode is remembered', async ({ harness }) => {
    const first = await harness.launch({})
    await chooseMode(first.win, 'Coding')
    await first.app.close()
    const second = await harness.launch()
    await expect(second.win.locator('#mode-select')).toHaveValue('coding')
    await expect(second.win.locator('#actions button').first()).toHaveText('Explain this error')
  })
})

// ---------- replies ----------

test('answers come back in the chosen language', async ({ harness }) => {
  const { win } = await harness.launch({ replyLanguage: 'Tagalog' })
  await ask(win, 'What is this?')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  expect(requestText(harness.mock.messages[0])).toContain('Answer in Tagalog.')
})

test('voice mode speaks the answer and tucks the text away', async ({ harness }) => {
  const { win } = await harness.launch({ replyMode: 'voice' })
  const spoken = await spyOnSpeech(win)
  harness.mock.claudeReplies.push({ text: 'First sentence. Second sentence.' })
  await ask(win, 'Talk to me')
  await expect.poll(spoken).toBe(2)
  await expect(win.locator('.exchange details summary')).toHaveText('Spoken answer (show text)')
  expect(requestText(harness.mock.messages[0])).toContain('spoken aloud')
})

// ---------- images: snip, paste, drop ----------

test.describe('asking about part of the screen or an image', () => {
  test('snip an area: drag to select, then ask about just that area', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    const snip = await snipWindow(app, () => win.click('#btn-snip'))
    await snip.mouse.move(100, 100)
    await snip.mouse.down()
    await snip.mouse.move(300, 220, { steps: 5 })
    await snip.mouse.up()

    await expect(win.locator('#attachments .chip')).toHaveCount(1)
    await expect(win.locator('#question')).toHaveAttribute('placeholder', 'Ask about the attached image…')
    await ask(win, 'What does this chart show?')
    await expect(win.locator('.exchange .q').last()).toContainText('(+1 image)')
    await expect(win.locator('.exchange .a strong')).toBeVisible()

    const content = userContent(harness.mock.messages[0])
    expect(content.map((b) => b.type)).toEqual(['image', 'text'])
    expect(content[0].source?.media_type).toBe('image/jpeg')
    expect(content[1].text).toContain('chose to show you')
    // The attachment is used once, then cleared.
    await expect(win.locator('#attachments .chip')).toHaveCount(0)
  })

  test('snip by hotkey; Esc cancels without attaching', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    const snip = await snipWindow(app, () => sendHotkey(app, 'snip'))
    // Esc closes the window on key-down, so don't wait for a key-up.
    await snip.keyboard.down('Escape')
    await expect.poll(() => app.windows().length).toBe(1)
    await expect(win.locator('#attachments .chip')).toHaveCount(0)
  })

  test('a stray click on the snip screen is ignored; right-click cancels', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    const snip = await snipWindow(app, () => win.click('#btn-snip'))
    await snip.mouse.click(200, 200)
    expect(app.windows().length).toBe(2)
    // The window may close on button-down (Linux) or button-up (Windows).
    await snip.mouse.down({ button: 'right' })
    await snip.mouse.up({ button: 'right' }).catch(() => {})
    await expect.poll(() => app.windows().length).toBe(1)
    await expect(win.locator('#attachments .chip')).toHaveCount(0)
  })

  test('paste an image into the question box', async ({ harness }) => {
    const { win } = await harness.launch({})
    await giveImage(win, 'paste')
    await expect(win.locator('#attachments .chip')).toHaveCount(1)
    // Sending with no text asks "What is this?"
    await win.press('#question', 'Enter')
    await expect(win.locator('.exchange .q').last()).toContainText('What is this? (+1 image)')
    await expect(win.locator('.exchange .a strong')).toBeVisible()
    const content = userContent(harness.mock.messages[0])
    expect(content.map((b) => b.type)).toEqual(['image', 'text'])
    expect(content[0].source?.media_type).toBe('image/jpeg')
  })

  test('drop images; remove one; at most four', async ({ harness }) => {
    const { win } = await harness.launch({})
    await giveImage(win, 'drop')
    await giveImage(win, 'drop')
    await expect(win.locator('#attachments .chip')).toHaveCount(2)
    await win.locator('#attachments .chip .remove').first().click()
    await expect(win.locator('#attachments .chip')).toHaveCount(1)
    for (let i = 0; i < 4; i++) await giveImage(win, 'drop')
    await expect(win.locator('#attachments .chip')).toHaveCount(4)
    await expect(win.locator('#banner')).toContainText('Up to 4 images')
    await ask(win, 'Compare these')
    await expect(win.locator('.exchange .a strong')).toBeVisible()
    expect(userContent(harness.mock.messages[0]).filter((b) => b.type === 'image')).toHaveLength(4)
  })
})

// ---------- working without everything set up ----------

test('without a speech-to-text key: typed questions work, listening explains what is missing', async ({ harness }) => {
  const { app, win } = await harness.launch({ sttApiKey: '' })
  await win.click('#btn-listen')
  await expect(win.locator('#banner')).toContainText('Listening needs a speech-to-text key')
  await expect(win.locator('#listen-dot')).not.toHaveClass(/on/)

  await sendHotkey(app, 'voice-question')
  await expect(win.locator('#btn-voice')).not.toHaveClass(/active/)

  await ask(win, 'Still works?')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  expect(harness.mock.transcriptions).toBe(0)
})

test('microphone only (computer audio off) and screenshots off still answer', async ({ harness }) => {
  const { win } = await harness.launch({ captureSystem: false, includeScreenshot: false })
  await win.click('#btn-listen')
  await expect(win.locator('#transcript p.me').first()).toBeVisible({ timeout: 20_000 })
  await ask(win, 'Summarize what I said')
  await expect(win.locator('.exchange .a strong')).toBeVisible()
  expect(userContent(harness.mock.messages[0]).map((b) => b.type)).toEqual(['text'])
})

// ---------- shortcuts ----------

test.describe('shortcuts', () => {
  const isRegistered = (app: ElectronApplication, acc: string) =>
    app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), acc)

  test('defaults are registered and listed in the empty state', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    await expect(win.locator('#shortcut-list li')).toHaveCount(6)
    await expect(win.locator('#shortcut-list')).toContainText('Ctrl + Shift + G')
    expect(await isRegistered(app, 'CommandOrControl+Shift+Space')).toBe(true)
    expect(await isRegistered(app, 'CommandOrControl+Shift+X')).toBe(true)
  })

  test('change a shortcut by pressing keys', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    await win.click('#btn-settings')
    const field = win.locator('#hotkey-rows input[data-action="snip"]')
    await field.click()
    await win.keyboard.press('Control+Alt+KeyY')
    await expect(field).toHaveValue('Ctrl + Alt + Y')
    await win.click('#settings-form button[type=submit]')
    await expect(win.locator('#view-settings')).toBeHidden()
    expect(await isRegistered(app, 'CommandOrControl+Alt+Y')).toBe(true)
    expect(await isRegistered(app, 'CommandOrControl+Shift+G')).toBe(false)
    await expect(win.locator('#shortcut-list')).toContainText('Ctrl + Alt + Y')
  })

  test('turn a shortcut off with Backspace', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    await win.click('#btn-settings')
    const field = win.locator('#hotkey-rows input[data-action="suggest-reply"]')
    await field.click()
    await win.keyboard.press('Backspace')
    await expect(field).toHaveValue('')
    await win.click('#settings-form button[type=submit]')
    await expect(win.locator('#view-settings')).toBeHidden()
    expect(await isRegistered(app, 'CommandOrControl+Shift+R')).toBe(false)
    await expect(win.locator('#shortcut-list li')).toHaveCount(5)
  })

  test('two actions on one shortcut is refused', async ({ harness }) => {
    const { win } = await harness.launch({})
    await win.click('#btn-settings')
    await win.locator('#hotkey-rows input[data-action="snip"]').click()
    await win.keyboard.press('Control+Shift+KeyA')
    await win.click('#settings-form button[type=submit]')
    await expect(win.locator('#settings-error')).toContainText('use the same shortcut')
    await expect(win.locator('#view-settings')).toBeVisible()
  })

  test('a shortcut taken by another app is reported', async ({ harness }) => {
    const { app, win } = await harness.launch({})
    // Pretend another app owns Ctrl+Alt+J.
    const taken = await app.evaluate(({ globalShortcut }) => {
      const original = globalShortcut.register.bind(globalShortcut)
      globalShortcut.register = ((acc: string, cb: () => void) =>
        acc === 'Control+Alt+J' || acc === 'CommandOrControl+Alt+J' ? false : original(acc, cb)) as typeof globalShortcut.register
      return true
    })
    expect(taken).toBe(true)
    await win.click('#btn-settings')
    await win.locator('#hotkey-rows input[data-action="snip"]').click()
    await win.keyboard.press('Control+Alt+KeyJ')
    await win.click('#settings-form button[type=submit]')
    await expect(win.locator('#settings-error')).toContainText('some shortcuts could not be set')
    await expect(win.locator('#hotkey-rows .warn')).toContainText('Another app is already using this shortcut')
  })
})

test('launched at sign-in, the app starts hidden in the tray', async ({ harness }) => {
  const { _electron } = await import('@playwright/test')
  // Write settings, then start with --hidden like Windows does at sign-in.
  const first = await harness.launch({ launchAtLogin: true })
  await first.app.close()
  const { join } = await import('node:path')
  const app = await _electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(__dirname, '..'), '--hidden'],
    env: { ...process.env, SCREEN_COPILOT_USER_DATA: harness.userData, ANTHROPIC_BASE_URL: harness.mock.url }
  })
  try {
    await app.firstWindow()
    await new Promise((r) => setTimeout(r, 1000))
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
  } finally {
    await app.close()
  }
})
