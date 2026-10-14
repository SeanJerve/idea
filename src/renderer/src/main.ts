import './styles.css'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
  STT_PRESETS,
  type AskKind,
  type AssistantEvent,
  type HotkeyAction,
  type Settings,
  type Speaker
} from '@shared/types'
import { SAMPLE_RATE, StreamCapture, openMic, openSystemAudio } from './audio/capture.ts'
import { encodeWav } from './audio/wav.ts'
import { AutoSuggest } from './auto-suggest.ts'
import { isLikelyNoise } from './speech-text.ts'
import { QueueOverflowError, TaskQueue } from './task-queue.ts'
import { Transcript, sessionMarkdown } from './transcript.ts'
import { VoiceReply } from './tts.ts'

const api = window.copilot
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

let settings: Settings = { ...DEFAULT_SETTINGS }
const transcript = new Transcript()
const history: { question: string; answer: string }[] = []
const sttQueue = new TaskQueue(3, 12)
const autoSuggest = new AutoSuggest()
/** Summaries look at a longer stretch of the conversation than questions do. */
const SUMMARY_MINUTES = 60

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
  auto: boolean
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

function renderTranscript(): void {
  const box = $('transcript')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24
  box.replaceChildren(
    ...transcript.entries.slice(-60).map((e) => {
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
    const text = await sttQueue.run(() => api.transcribe(encodeWav(samples, SAMPLE_RATE)))
    if (!text || isLikelyNoise(text)) return
    const entry = { speaker, text, at }
    if (!transcript.add(entry)) return
    renderTranscript()
    if (settings.autoSuggest) autoSuggest.onEntry(entry, Date.now())
  } catch (err) {
    // A dropped backlog clip isn't worth interrupting the user over.
    if (!(err instanceof QueueOverflowError)) showBanner(errorText(err), 'error')
  }
}

/** Fires an automatic "what should I say" once the other side has asked something and paused. */
function pollAutoSuggest(): void {
  if (!settings.autoSuggest || !listening) return
  const theyAreTalking = system?.speaking ?? false
  if (!autoSuggest.poll(Date.now(), theyAreTalking)) return
  // Never replace something the user asked for themselves.
  if (current && !current.auto) return
  send('suggest-reply', '', true)
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
  if (transcript.entries.length === 0) $('transcript').innerHTML = '<p class="hint">Listening… speech will show up here.</p>'
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
  autoSuggest.cancel()
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
  const qText = document.createElement('span')
  qText.textContent = label
  const copy = document.createElement('button')
  copy.className = 'copy'
  copy.type = 'button'
  copy.textContent = 'Copy'
  copy.title = 'Copy answer'
  copy.addEventListener('click', () => {
    const text = wrap.dataset.answer ?? ''
    if (!text) return
    void api.copyText(text).then(() => {
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
    })
  })
  q.append(qText, copy)
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

function labelFor(kind: AskKind, question: string, auto: boolean): string {
  if (kind === 'suggest-reply') return auto ? 'They asked something. You could say:' : 'What should I say?'
  if (kind === 'summarize') return 'Summarize the conversation'
  return question.trim()
}

function stopCurrent(): void {
  if (!current) return
  void api.cancel(current.id)
  if (!current.text) {
    current.el.className = 'a status'
    current.el.textContent = 'Stopped.'
  }
  current = null
}

function send(kind: AskKind, question = '', auto = false): void {
  if (kind === 'question' && !question.trim()) return
  stopCurrent()
  voice.stop()
  if (!auto) autoSuggest.cancel()

  const label = labelFor(kind, question, auto)
  const speak = settings.replyMode !== 'text'
  const id = crypto.randomUUID()
  current = { id, label, el: createExchange(label, speak), text: '', speak, auto }
  const minutes = kind === 'summarize' ? Math.max(SUMMARY_MINUTES, settings.contextMinutes) : settings.contextMinutes

  api
    .ask({
      id,
      kind,
      question,
      transcript: transcript.recent(minutes, Date.now()),
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
      ;(c.el.closest('.exchange') as HTMLElement).dataset.answer = c.text
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
    case 'click-through':
      // Handled in the main process, which reports the new state via onClickThrough.
      break
  }
}

function onClickThrough(on: boolean): void {
  document.body.classList.toggle('click-through', on)
  if (on) showBanner('Click-through is on: clicks pass to the window behind. Ctrl+Shift+K turns it off.')
  else hideBanner()
}

let emptyState: Node | null = null

function clearSession(): void {
  stopCurrent()
  voice.stop()
  autoSuggest.cancel()
  transcript.clear()
  history.length = 0
  renderTranscript()
  if (emptyState) $('answers').replaceChildren(emptyState.cloneNode(true))
  hideBanner()
}

async function exportSession(): Promise<void> {
  if (transcript.entries.length === 0 && history.length === 0) {
    showBanner('Nothing to save yet.')
    return
  }
  try {
    const path = await api.exportSession(sessionMarkdown(transcript.entries, history, Date.now()))
    if (path) showBanner(`Saved to ${path}`)
  } catch (err) {
    showBanner(errorText(err), 'error')
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
  $('btn-export').addEventListener('click', () => void exportSession())
  $('btn-clear').addEventListener('click', () => {
    if (transcript.entries.length === 0 && history.length === 0) return
    if (confirm('Clear the transcript and answers?')) clearSession()
  })
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
  api.onClickThrough(onClickThrough)
  setInterval(pollAutoSuggest, 250)
}

async function init(): Promise<void> {
  emptyState = $('empty').cloneNode(true)
  wire()
  settings = await api.getSettings()
  $<HTMLSelectElement>('quick-reply-mode').value = settings.replyMode
  if (!settings.anthropicApiKey || !settings.sttApiKey) {
    showBanner('Welcome! Open Settings (gear icon) to add your API keys.')
  }
}

void init()
