import './styles.css'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { recentTranscript } from '@shared/prompt'
import {
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
  STT_PRESETS,
  type AskKind,
  type AssistantEvent,
  type HotkeyAction,
  type Settings,
  type Speaker,
  type TranscriptEntry
} from '@shared/types'
import { SAMPLE_RATE, StreamCapture, openMic, openSystemAudio } from './audio/capture.ts'
import { encodeWav } from './audio/wav.ts'
import { isLikelyNoise } from './speech-text.ts'
import { VoiceReply } from './tts.ts'

const api = window.copilot
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

let settings: Settings = { ...DEFAULT_SETTINGS }
const transcript: TranscriptEntry[] = []
const history: { question: string; answer: string }[] = []

let mic: StreamCapture | null = null
let system: StreamCapture | null = null
let listening = false

/** Mic opened only to record a spoken question while listening is off. */
let questionMic: StreamCapture | null = null
let recordingQuestion = false

interface Pending {
  id: string
  label: string
  el: HTMLElement
  text: string
  speak: boolean
}
let current: Pending | null = null

const voice = new VoiceReply(
  () => ({ name: settings.voiceName, rate: settings.voiceRate }),
  (speaking) => {
    // Don't transcribe our own voice coming back through the speakers or mic.
    if (speaking) {
      mic?.mute(true)
      system?.mute(true)
    } else {
      setTimeout(() => {
        mic?.mute(false)
        system?.mute(false)
      }, 300)
    }
  }
)

// ---------- banner ----------

function showBanner(text: string, kind: 'info' | 'error' = 'info'): void {
  const el = $('banner')
  el.textContent = text
  el.className = `banner ${kind === 'error' ? 'error' : ''}`
  el.hidden = false
}

function hideBanner(): void {
  $('banner').hidden = true
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // IPC errors arrive wrapped as "Error invoking remote method 'x': Error: ...".
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// ---------- transcript ----------

function addTranscript(entry: TranscriptEntry): void {
  // Clips finish transcribing out of order; keep the list in time order.
  let i = transcript.length
  while (i > 0 && transcript[i - 1].at > entry.at) i--
  transcript.splice(i, 0, entry)
  if (transcript.length > 2000) transcript.splice(0, transcript.length - 2000)
  renderTranscript()
}

function renderTranscript(): void {
  const box = $('transcript')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24
  box.replaceChildren(
    ...transcript.slice(-60).map((e) => {
      const p = document.createElement('p')
      p.className = e.speaker
      const who = document.createElement('span')
      who.className = 'who'
      who.textContent = e.speaker === 'me' ? 'Me' : 'Them'
      p.append(who, e.text)
      return p
    })
  )
  if (atBottom) box.scrollTop = box.scrollHeight
}

async function handleSegment(speaker: Speaker, samples: Float32Array): Promise<void> {
  const at = Date.now()
  try {
    const text = await api.transcribe(encodeWav(samples, SAMPLE_RATE))
    if (!text || isLikelyNoise(text)) return
    addTranscript({ speaker, text, at })
  } catch (err) {
    showBanner(errorText(err), 'error')
  }
}

// ---------- listening ----------

async function startListening(): Promise<void> {
  if (listening) return
  const problems: string[] = []

  if (settings.captureMic) {
    try {
      const cap = new StreamCapture(await openMic(), (seg) => void handleSegment('me', seg.samples))
      await cap.start()
      mic = cap
    } catch (err) {
      problems.push(`Microphone: ${errorText(err)}`)
    }
  }
  if (settings.captureSystem) {
    try {
      const cap = new StreamCapture(await openSystemAudio(), (seg) => void handleSegment('them', seg.samples))
      await cap.start()
      system = cap
    } catch (err) {
      problems.push(`Computer audio: ${errorText(err)}`)
    }
  }

  if (!mic && !system) {
    showBanner(problems.join(' ') || 'Turn on the microphone or computer audio in Settings.', 'error')
    return
  }
  if (problems.length) showBanner(problems.join(' '), 'error')
  else hideBanner()

  listening = true
  if (transcript.length === 0) $('transcript').innerHTML = '<p class="hint">Listening… speech will show up here.</p>'
  updateListeningUi()
  requestAnimationFrame(updateMeters)
}

async function stopListening(): Promise<void> {
  if (recordingQuestion && !questionMic) {
    // The spoken question was being recorded on the listening mic.
    recordingQuestion = false
    updateVoiceUi()
    hideBanner()
  }
  listening = false
  const caps = [mic, system]
  mic = null
  system = null
  await Promise.all(caps.map((c) => c?.stop()))
  updateListeningUi()
}

function toggleListening(): void {
  void (listening ? stopListening() : startListening())
}

function updateListeningUi(): void {
  $('listen-dot').classList.toggle('on', listening)
  $('listen-dot').title = listening ? 'Listening' : 'Not listening'
  $('btn-listen').classList.toggle('active', listening)
  $('btn-listen').title = `${listening ? 'Stop' : 'Start'} listening (Ctrl+Shift+L)`
}

function updateMeters(): void {
  const pct = (cap: StreamCapture | null): string => `${Math.min(100, Math.round((cap?.level ?? 0) * 500))}%`
  $('meter-me').style.setProperty('--level', pct(mic))
  $('meter-them').style.setProperty('--level', pct(system))
  if (listening) requestAnimationFrame(updateMeters)
}

// ---------- spoken questions ----------

async function toggleVoiceQuestion(): Promise<void> {
  if (!recordingQuestion) {
    voice.stop()
    let cap = mic
    if (!cap) {
      try {
        cap = new StreamCapture(await openMic(), () => {})
        await cap.start()
        questionMic = cap
      } catch (err) {
        showBanner(`Microphone: ${errorText(err)}`, 'error')
        return
      }
    }
    cap.startRecording()
    recordingQuestion = true
    updateVoiceUi()
    showBanner('Listening to your question… press Ctrl+Shift+A or the mic button again to send.')
    return
  }

  recordingQuestion = false
  updateVoiceUi()
  const cap = questionMic ?? mic
  const samples = cap?.stopRecording() ?? null
  if (questionMic) {
    await questionMic.stop()
    questionMic = null
  }
  if (!samples || samples.length < SAMPLE_RATE * 0.4) {
    showBanner("Didn't catch that. Try again.", 'error')
    return
  }
  showBanner('Transcribing your question…')
  try {
    const question = await api.transcribe(encodeWav(samples, SAMPLE_RATE))
    hideBanner()
    if (!question.trim()) {
      showBanner("Didn't catch that. Try again.", 'error')
      return
    }
    send('question', question)
  } catch (err) {
    showBanner(errorText(err), 'error')
  }
}

function updateVoiceUi(): void {
  $('btn-voice').classList.toggle('active', recordingQuestion)
}

// ---------- asking ----------

function renderMarkdown(el: HTMLElement, text: string): void {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }))
}

function createExchange(label: string, speak: boolean): HTMLElement {
  $('empty')?.remove()
  const wrap = document.createElement('article')
  wrap.className = 'exchange'
  const q = document.createElement('div')
  q.className = 'q'
  q.textContent = label
  const a = document.createElement('div')
  a.className = 'a status'
  a.textContent = 'Starting…'
  if (speak && settings.replyMode === 'voice') {
    // Voice-only mode: the answer is spoken; the text stays tucked away.
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Spoken answer (show text)'
    details.append(summary, a)
    wrap.append(q, details)
  } else {
    wrap.append(q, a)
  }
  $('answers').append(wrap)
  scrollAnswers(true)
  return a
}

function scrollAnswers(force = false): void {
  const box = $('answers')
  if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight
}

function send(kind: AskKind, question = ''): void {
  if (kind === 'question' && !question.trim()) return
  if (current) void api.cancel(current.id)
  voice.stop()

  const label =
    kind === 'suggest-reply' ? 'What should I say?' : kind === 'summarize' ? 'Summarize the conversation' : question.trim()
  const speak = settings.replyMode !== 'text'
  const id = crypto.randomUUID()
  current = { id, label, el: createExchange(label, speak), text: '', speak }

  api
    .ask({
      id,
      kind,
      question,
      transcript: recentTranscript(transcript, settings.contextMinutes, Date.now()),
      history: history.slice(-4)
    })
    .catch((err) => onAssistantEvent({ id, type: 'error', message: errorText(err) }))
}

function onAssistantEvent(e: AssistantEvent): void {
  if (!current || e.id !== current.id) return
  const c = current
  switch (e.type) {
    case 'status':
      if (!c.text) c.el.textContent = e.text
      break
    case 'delta':
      c.text += e.text
      c.el.className = 'a'
      renderMarkdown(c.el, c.text)
      if (c.speak) voice.feed(e.text)
      scrollAnswers()
      break
    case 'done':
      if (c.speak) voice.finish()
      history.push({ question: c.label, answer: c.text })
      current = null
      break
    case 'error':
      if (c.text) {
        const note = document.createElement('p')
        note.className = 'error'
        note.textContent = e.message
        c.el.append(note)
      } else {
        c.el.className = 'a error'
        c.el.textContent = e.message
      }
      current = null
      break
  }
}

// ---------- settings ----------

function settingsForm(): HTMLFormElement {
  return $<HTMLFormElement>('settings-form')
}

function fillVoices(): void {
  const select = $<HTMLSelectElement>('voice-select')
  const voices = speechSynthesis.getVoices()
  select.replaceChildren(
    new Option('System default', ''),
    ...voices.map((v) => new Option(`${v.name} (${v.lang})`, v.name))
  )
  select.value = settings.voiceName
}

function openSettings(): void {
  const form = settingsForm()
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(key) as HTMLInputElement | null
    if (!field) continue
    if (field.type === 'checkbox') field.checked = Boolean(value)
    else field.value = String(value)
  }
  const preset = Object.entries(STT_PRESETS).find(
    ([, p]) => p.sttBaseUrl === settings.sttBaseUrl && p.sttModel === settings.sttModel
  )
  $<HTMLSelectElement>('stt-preset').value = preset ? preset[0] : 'Custom'
  fillVoices()
  $('view-main').hidden = true
  $('view-settings').hidden = false
}

function closeSettings(): void {
  $('view-settings').hidden = true
  $('view-main').hidden = false
}

async function saveSettingsForm(): Promise<void> {
  const form = settingsForm()
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const field = form.elements.namedItem(key) as HTMLInputElement | null
    if (!field) continue
    if (field.type === 'checkbox') patch[key] = field.checked
    else if (typeof DEFAULT_SETTINGS[key] === 'number') patch[key] = Number(field.value) || DEFAULT_SETTINGS[key]
    else patch[key] = field.value.trim()
  }
  const before = settings
  settings = await api.saveSettings(patch as Partial<Settings>)
  $<HTMLSelectElement>('quick-reply-mode').value = settings.replyMode
  closeSettings()

  if (listening && (before.captureMic !== settings.captureMic || before.captureSystem !== settings.captureSystem)) {
    await stopListening()
    await startListening()
  }
  if (!settings.anthropicApiKey) showBanner('Add your Anthropic API key to ask questions.', 'error')
  else hideBanner()
}

// ---------- wiring ----------

function onHotkey(action: HotkeyAction): void {
  switch (action) {
    case 'focus-input':
      closeSettings()
      $('question').focus()
      break
    case 'voice-question':
      void toggleVoiceQuestion()
      break
    case 'suggest-reply':
      send('suggest-reply')
      break
    case 'toggle-listening':
      toggleListening()
      break
  }
}

function wire(): void {
  const question = $<HTMLTextAreaElement>('question')
  const autosize = (): void => {
    question.style.height = 'auto'
    question.style.height = `${question.scrollHeight}px`
    question.style.overflowY = question.scrollHeight > 120 ? 'auto' : 'hidden'
  }
  question.addEventListener('input', autosize)
  question.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      $<HTMLFormElement>('ask-form').requestSubmit()
    }
  })
  $<HTMLFormElement>('ask-form').addEventListener('submit', (e) => {
    e.preventDefault()
    send('question', question.value)
    question.value = ''
    autosize()
  })

  $('btn-listen').addEventListener('click', toggleListening)
  $('btn-voice').addEventListener('click', () => void toggleVoiceQuestion())
  $('btn-suggest').addEventListener('click', () => send('suggest-reply'))
  $('btn-summarize').addEventListener('click', () => send('summarize'))
  $('btn-hide').addEventListener('click', () => void api.hideWindow())
  $('btn-settings').addEventListener('click', () => ($('view-settings').hidden ? openSettings() : closeSettings()))
  $('btn-settings-cancel').addEventListener('click', closeSettings)
  $('btn-quit').addEventListener('click', () => void api.quit())
  settingsForm().addEventListener('submit', (e) => {
    e.preventDefault()
    void saveSettingsForm()
  })

  const presetSelect = $<HTMLSelectElement>('stt-preset')
  presetSelect.replaceChildren(...Object.keys(STT_PRESETS).map((n) => new Option(n, n)), new Option('Custom', 'Custom'))
  presetSelect.addEventListener('change', () => {
    const preset = STT_PRESETS[presetSelect.value]
    if (!preset) return
    const form = settingsForm()
    ;(form.elements.namedItem('sttBaseUrl') as HTMLInputElement).value = preset.sttBaseUrl
    ;(form.elements.namedItem('sttModel') as HTMLInputElement).value = preset.sttModel
  })
  $<HTMLSelectElement>('model-select').replaceChildren(...MODEL_OPTIONS.map((m) => new Option(m, m)))

  const quickMode = $<HTMLSelectElement>('quick-reply-mode')
  quickMode.addEventListener('change', async () => {
    settings = await api.saveSettings({ replyMode: quickMode.value as Settings['replyMode'] })
    if (settings.replyMode === 'text') voice.stop()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (speechSynthesis.speaking) voice.stop()
    else if (!$('view-settings').hidden) closeSettings()
    else void api.hideWindow()
  })

  speechSynthesis.addEventListener('voiceschanged', () => {
    if (!$('view-settings').hidden) fillVoices()
  })

  api.onAssistantEvent(onAssistantEvent)
  api.onHotkey(onHotkey)
}

async function init(): Promise<void> {
  wire()
  settings = await api.getSettings()
  $<HTMLSelectElement>('quick-reply-mode').value = settings.replyMode
  if (!settings.anthropicApiKey || !settings.sttApiKey) {
    showBanner('Welcome! Open Settings (gear icon) to add your API keys.')
  }
}

void init()
