import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockServer, type MockServer } from './mock-server'

const ROOT = join(__dirname, '..')

/** A few seconds of speech-like bursts between silences, looped by Chromium as the fake mic. */
function speechWav(path: string): void {
  const rate = 48_000
  const seconds = 6
  const samples = new Int16Array(rate * seconds)
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate
    const inSpeech = t >= 1 && t < 3
    // Syllables: 180 ms on, 60 ms off, with a few harmonics like a voice.
    const syllable = (t - 1) % 0.24 < 0.18
    if (inSpeech && syllable) {
      const v = 0.25 * Math.sin(2 * Math.PI * 180 * t) + 0.15 * Math.sin(2 * Math.PI * 360 * t) + 0.08 * Math.sin(2 * Math.PI * 900 * t)
      samples[i] = Math.round(v * 32767)
    }
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples.byteLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(samples.byteLength, 40)
  writeFileSync(path, Buffer.concat([header, Buffer.from(samples.buffer)]))
}

export interface Harness {
  mock: MockServer
  userData: string
  launch(settings?: Record<string, unknown>): Promise<{ app: ElectronApplication; win: Page }>
}

export const test = base.extend<{ harness: Harness }>({
  harness: async ({}, use) => {
    const mock = await startMockServer()
    const userData = mkdtempSync(join(tmpdir(), 'screen-copilot-e2e-'))
    const wav = join(userData, 'speech.wav')
    speechWav(wav)
    const apps: ElectronApplication[] = []

    const harness: Harness = {
      mock,
      userData,
      async launch(settings) {
        if (settings) {
          writeFileSync(
            join(userData, 'settings.json'),
            JSON.stringify({
              anthropicApiKey: 'test-key',
              sttApiKey: 'stt-key',
              sttBaseUrl: `${mock.url}/v1`,
              // Loopback capture is Windows-only; tests use the fake mic.
              captureSystem: false,
              ...settings
            })
          )
        }
        const app = await _electron.launch({
          args: [
            ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${wav}`,
            '--use-fake-ui-for-media-stream',
            ROOT
          ],
          env: {
            ...process.env,
            SCREEN_COPILOT_USER_DATA: userData,
            ANTHROPIC_BASE_URL: mock.url,
            ANTHROPIC_API_KEY: '',
            OPENAI_API_KEY: ''
          }
        })
        apps.push(app)
        const win = await app.firstWindow()
        await win.waitForLoadState('domcontentloaded')
        await win.locator('#question').waitFor()
        return { app, win }
      }
    }

    await use(harness)
    for (const app of apps) await app.close().catch(() => {})
    await mock.close()
  }
})

export { expect } from '@playwright/test'

export async function ask(win: Page, question: string): Promise<void> {
  await win.fill('#question', question)
  await win.press('#question', 'Enter')
}

export async function sendHotkey(app: ElectronApplication, action: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('hotkey', a), action)
}
