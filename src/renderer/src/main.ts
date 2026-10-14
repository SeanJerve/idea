import './styles.css'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { displayHotkey } from '@shared/hotkeys'
import { MODES, getMode, type QuickAction } from '@shared/modes'
import {
  DEFAULT_SETTINGS,
  HOTKEY_LABELS,
  MODEL_OPTIONS,
  STT_PRESETS,
  type AskKind,
  type AssistantEvent,
  type HotkeyAction,
  type ImageAttachment,
  type Settings,
  type Speaker,
  type TranscriptEntry
} from '@shared/types'
import { MAX_ATTACHMENTS, dataUrl, imageToAttachment, imagesFrom } from './attachments.ts'
import { SAMPLE_RATE, StreamCapture, openMic, openSystemAudio } from './audio/capture.ts'
import { encodeWav } from './audio/wav.ts'
import { AutoSuggest } from './auto-suggest.ts'
import { HotkeyEditor } from './hotkey-editor.ts'
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
const translateQueue = new TaskQueue(2, 20)
const translations = new WeakMap<TranscriptEntry, string>()
const autoSuggest = new AutoSuggest()
let attachments: ImageAttachment[] = []
let hotkeyEditor: HotkeyEditor | null = null

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

let bannerTimer: ReturnType<typeof setTimeout> | undefined

/**
 * One quiet line above the input. Info fades out on its own after a few
 * seconds unless it's `sticky`; errors stay until dismissed or replaced.
 */
function showBanner(text: string, kind: 'info' | 'error' = 'info', sticky = false): void {
  const el = $('banner')
  $('banner-text').textContent = text
  el.className = kind === 'error' ? 'notice error' : 'notice'
  el.hidden = false
  clearTimeout(bannerTimer)
  if (kind === 'info' && !sticky) bannerTimer = setTimeout(hideBanner, 6000)
}

function hideBanner(): void {
  clearTimeout(bannerTimer)
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
  if (transcript.entries.length === 0) {
    box.innerHTML = listening
      ? '<p class="hint">Listening…</p>'
      : '<p class="hint">Not listening. Press the mic above to start.</p>'
    return
  }
  box.replaceChildren(
    ...transcript.entries.slice(-60).map((e) => {
      const p = document.createElement('p')
      p.className = e.speaker
      const who = document.createElement('span')
      who.className = 'who'
      who.textContent = e.speaker === 'me' ? 'Me' : 'Them'
      p.append(who, e.text)
      const tr = translations.get(e)
      if (tr) {
        const t = document.createElement('span')
        t.className = 'tr'
        t.textContent = tr
        p.append(t)
      }
      return p
    })
  )
  if (atBottom) box.scrollTop = box.scrollHeight
}

function translateEntry(entry: TranscriptEntry): void {
  if (!getMode(settings.mode).liveTranslate) return
  translateQueue
    .run(() => api.translate(entry.text))
    .then((t) => {
      if (!t) return
      translations.set(entry, t)
      renderTranscript()
    })
    .catch((err) => {
      if (!(err instanceof QueueOverflowError)) showBanner(`Translation: ${errorText(err)}`, 'error')
    })
}

async function handleSegment(speaker: Speaker, samples: Float32Array): Promise<void> {
  const at = Date.now()
  try {
    const text = await sttQueue.run(() => api.transcribe(encodeWav(samples, SAMPLE_RATE)))
    if (!text || isLikelyNoise(text)) return
    const entry = { speaker, text, at }
    if (!transcript.add(entry)) return
    renderTranscript()
    translateEntry(entry)
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
  send('suggest-reply', '', { auto: true })
}

// ---------- listening ----------

function needsSpeechKey(): boolean {
  if (settings.sttApiKey) return false
  showBanner('Listening needs a speech-to-text key. Add one in Settings → Speech to text. Typing works without it.', 'error')
  return true
}

async function startListening(): Promise<void> {
  if (listening || needsSpeechKey()) return
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
  renderTranscript()
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
  renderTranscript()
}

function toggleListening(): void {
  void (listening ? stopListening() : startListening())
}

function updateListeningUi(): void {
  $('listen-dot').classList.toggle('on', listening)
  $('listen-dot').title = listening ? 'Listening' : 'Not listening'
  $('btn-listen').classList.toggle('active', listening)
  $('btn-listen').title = `${listening ? 'Stop' : 'Start'} listening (${displayHotkey(settings.hotkeys['toggle-listening'])})`
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
    if (needsSpeechKey()) return
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
    showBanner(`Listening… press ${displayHotkey(settings.hotkeys['voice-question'])} or the mic again to send.`, 'info', true)
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
  showBanner('Transcribing…', 'info', true)
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

// ---------- attachments ----------

function renderAttachments(): void {
  const box = $('attachments')
  box.hidden = attachments.length === 0
  box.replaceChildren(
    ...attachments.map((a, i) => {
      const chip = document.createElement('span')
      chip.className = 'chip'
      const img = document.createElement('img')
      img.src = dataUrl(a)
      img.alt = `Attached image ${i + 1}`
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'remove'
      remove.title = 'Remove'
      remove.setAttribute('aria-label', `Remove image ${i + 1}`)
      remove.textContent = '×'
      remove.addEventListener('click', () => {
        attachments.splice(i, 1)
        renderAttachments()
      })
      chip.append(img, remove)
      return chip
    })
  )
  $<HTMLTextAreaElement>('question').placeholder = attachments.length
    ? 'Ask about the image'
    : 'Ask about your screen'
}

function attach(a: ImageAttachment): void {
  if (attachments.length >= MAX_ATTACHMENTS) {
    showBanner(`Up to ${MAX_ATTACHMENTS} images per question.`, 'error')
    return
  }
  attachments.push(a)
  renderAttachments()
}

async function attachFiles(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      attach(await imageToAttachment(file))
    } catch (err) {
      showBanner(errorText(err), 'error')
    }
  }
  $('question').focus()
}

async function snipArea(): Promise<void> {
  try {
    const area = await api.snip()
    if (area) attach(area)
    $('question').focus()
  } catch (err) {
    showBanner(errorText(err), 'error')
  }
}

// ---------- asking ----------

function renderMarkdown(el: HTMLElement, text: string): void {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }))
}

function createExchange(label: string, speakOnly: boolean, images: number): HTMLElement {
  $('empty')?.remove()
  const wrap = document.createElement('article')
  wrap.className = 'exchange'
  const q = document.createElement('div')
  q.className = 'q'
  const qText = document.createElement('span')
  qText.textContent = images ? `${label} (+${images} image${images > 1 ? 's' : ''})` : label
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
  a.textContent = 'Thinking…'
  if (speakOnly) {
    // Voice-only: the answer is spoken; the text stays tucked away.
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Spoken · show text'
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

function stopCurrent(): void {
  if (!current) return
  void api.cancel(current.id)
  if (!current.text) {
    current.el.className = 'a status'
    current.el.textContent = 'Stopped.'
  }
  current = null
}

interface SendOptions {
  auto?: boolean
  label?: string
  /** Transcript window in minutes, or the whole session. */
  transcript?: number | 'all'
  /** Read this answer aloud even in text mode. */
  speak?: boolean
}

function defaultLabel(kind: AskKind, question: string, auto: boolean): string {
  if (kind === 'suggest-reply') return auto ? 'Suggested reply' : 'What should I say?'
  if (kind === 'summarize') return 'Summarize the conversation'
  return question.trim()
}

function send(kind: AskKind, question = '', opts: SendOptions = {}): void {
  if (kind === 'question' && !question.trim()) return
  stopCurrent()
  voice.stop()
  if (!opts.auto) autoSuggest.cancel()

  const label = opts.label ?? defaultLabel(kind, question, Boolean(opts.auto))
  const speak = settings.replyMode !== 'text' || Boolean(opts.speak)
  const speakOnly = settings.replyMode === 'voice'
  const images = opts.auto ? [] : attachments
  if (!opts.auto) {
    attachments = []
    renderAttachments()
  }
  const id = crypto.randomUUID()
  current = { id, label, el: createExchange(label, speakOnly, images.length), text: '', speak, auto: Boolean(opts.auto) }
  const span = opts.transcript ?? settings.contextMinutes
  const entries = span === 'all' ? [...transcript.entries] : transcript.recent(span, Date.now())

  api
    .ask({
      id,
      kind,
      question,
      modeId: settings.mode,
      images,
      spoken: speak,
      transcript: entries,
      history: history.slice(-4)
    })
    .catch((err) => onAssistantEvent({ id, type: 'error', message: errorText(err) }))
}

function runAction(action: QuickAction): void {
  send(action.kind ?? 'question', action.prompt, {
    label: action.label,
    transcript: action.transcript,
    speak: action.speak
  })
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

// ---------- modes ----------

function renderMode(): void {
  const mode = getMode(settings.mode)
  const select = $<HTMLSelectElement>('mode-select')
  select.value = mode.id
  select.title = mode.hint
  $('mode-label').textContent = mode.name
  const hint = document.getElementById('mode-hint')
  if (hint) hint.textContent = mode.hint
  $('actions').replaceChildren(
    ...mode.actions.map((action) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = action.label
      b.dataset.action = action.id
      if (action.speak) b.title = 'Answer is read aloud'
      b.addEventListener('click', () => runAction(action))
      return b
    })
  )
}

function renderShortcutHelp(): void {
  const list = $('shortcut-list')
  if (!list) return
  list.replaceChildren(
    ...(Object.keys(HOTKEY_LABELS) as HotkeyAction[])
      .filter((a) => settings.hotkeys[a])
      .map((a) => {
        const li = document.createElement('li')
        const kbd = document.createElement('kbd')
        kbd.textContent = displayHotkey(settings.hotkeys[a])
        const what = document.createElement('span')
        what.textContent = HOTKEY_LABELS[a]
        li.append(kbd, what)
        return li
      })
  )
}

// ---------- settings ----------

function applyTheme(): void {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = settings.theme
}

function renderReplyMode(): void {
  const input = document.querySelector<HTMLInputElement>(`#reply-mode input[value="${settings.replyMode}"]`)
  if (input) input.checked = true
}

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

async function openSettings(): Promise<void> {
  const form = settingsForm()
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(key) as HTMLInputElement | null
    if (!field || typeof value === 'object') continue
    if (field.type === 'checkbox') field.checked = Boolean(value)
    else field.value = String(value)
  }
  const preset = Object.entries(STT_PRESETS).find(
    ([, p]) => p.sttBaseUrl === settings.sttBaseUrl && p.sttModel === settings.sttModel
  )
  $<HTMLSelectElement>('stt-preset').value = preset ? preset[0] : 'Custom'
  fillVoices()
  $('settings-error').hidden = true
  hotkeyEditor?.render(settings.hotkeys, await api.hotkeyStatus())
  $('view-main').hidden = true
  $('view-settings').hidden = false
  $('btn-settings').classList.add('active')
}

function closeSettings(): void {
  $('view-settings').hidden = true
  $('view-main').hidden = false
  $('btn-settings').classList.remove('active')
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
  const keys = hotkeyEditor?.collect()
  if (keys && 'error' in keys) {
    $('settings-error').textContent = keys.error
    $('settings-error').hidden = false
    return
  }
  if (keys) patch.hotkeys = keys.hotkeys

  const before = settings
  settings = await api.saveSettings(patch as Partial<Settings>)
  renderReplyMode()
  applyTheme()
  renderMode()
  renderShortcutHelp()
  updateListeningUi()

  const failed = (await api.hotkeyStatus()).filter((s) => s.error && s.error !== 'Off')
  if (failed.length) {
    // Stay in settings so the warnings next to each shortcut are visible.
    hotkeyEditor?.render(settings.hotkeys, await api.hotkeyStatus())
    $('settings-error').textContent = 'Saved, but some shortcuts could not be set. See the notes below.'
    $('settings-error').hidden = false
  } else {
    closeSettings()
  }

  if (listening && (before.captureMic !== settings.captureMic || before.captureSystem !== settings.captureSystem)) {
    await stopListening()
    await startListening()
  }
  if (!settings.anthropicApiKey) showBanner('Add your Anthropic API key to ask questions.', 'error')
  else if (!failed.length) hideBanner()
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
    case 'snip':
      void snipArea()
      break
    case 'click-through':
      // Handled in the main process, which reports the new state via onClickThrough.
      break
  }
}

function onClickThrough(on: boolean): void {
  document.body.classList.toggle('click-through', on)
  if (on) {
    showBanner(`Click-through on. ${displayHotkey(settings.hotkeys['click-through'])} to turn off.`, 'info', true)
  } else hideBanner()
}

let emptyState: Node | null = null

function clearSession(): void {
  stopCurrent()
  voice.stop()
  autoSuggest.cancel()
  transcript.clear()
  history.length = 0
  attachments = []
  renderAttachments()
  renderTranscript()
  if (emptyState) $('answers').replaceChildren(emptyState.cloneNode(true))
  renderShortcutHelp()
  renderMode()
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
  question.addEventListener('paste', (e) => {
    const files = imagesFrom(e.clipboardData?.items)
    if (files.length === 0) return
    e.preventDefault()
    void attachFiles(files)
  })
  $<HTMLFormElement>('ask-form').addEventListener('submit', (e) => {
    e.preventDefault()
    if (!question.value.trim() && attachments.length) question.value = 'What is this?'
    send('question', question.value)
    question.value = ''
    autosize()
  })

  // Drop image files anywhere on the overlay.
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      document.body.classList.add('dropping')
    }
  })
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dropping')
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    document.body.classList.remove('dropping')
    const files = imagesFrom(e.dataTransfer?.files)
    if (files.length) void attachFiles(files)
  })

  $('btn-listen').addEventListener('click', toggleListening)
  $('btn-voice').addEventListener('click', () => void toggleVoiceQuestion())
  $('btn-snip').addEventListener('click', () => void snipArea())
  $('btn-hide').addEventListener('click', () => void api.hideWindow())
  $('banner-close').addEventListener('click', hideBanner)

  const menu = $('menu')
  const more = $('btn-more')
  const setMenu = (open: boolean): void => {
    menu.hidden = !open
    more.setAttribute('aria-expanded', String(open))
    more.classList.toggle('active', open)
  }
  more.addEventListener('click', (e) => {
    e.stopPropagation()
    setMenu(menu.hidden)
  })
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) setMenu(false)
  })
  menu.addEventListener('click', () => setMenu(false))
  $('btn-export').addEventListener('click', () => void exportSession())
  $('btn-clear').addEventListener('click', () => {
    if (transcript.entries.length === 0 && history.length === 0) return
    if (confirm('Clear the transcript and answers?')) clearSession()
  })
  $('btn-settings').addEventListener('click', () => void ($('view-settings').hidden ? openSettings() : closeSettings()))
  $('btn-settings-cancel').addEventListener('click', closeSettings)
  $('btn-quit').addEventListener('click', () => void api.quit())
  settingsForm().addEventListener('submit', (e) => {
    e.preventDefault()
    void saveSettingsForm()
  })
  hotkeyEditor = new HotkeyEditor($('hotkey-rows'))

  const presetSelect = $<HTMLSelectElement>('stt-preset')
  presetSelect.replaceChildren(...Object.keys(STT_PRESETS).map((n) => new Option(n, n)), new Option('Custom', 'Custom'))
  presetSelect.addEventListener('change', () => {
    const preset = STT_PRESETS[presetSelect.value]
    if (!preset) return
    const form = settingsForm()
    ;(form.elements.namedItem('sttBaseUrl') as HTMLInputElement).value = preset.sttBaseUrl
    ;(form.elements.namedItem('sttModel') as HTMLInputElement).value = preset.sttModel
  })
  for (const id of ['model-select', 'translate-model-select']) {
    $<HTMLSelectElement>(id).replaceChildren(...MODEL_OPTIONS.map((m) => new Option(m, m)))
  }

  const modeSelect = $<HTMLSelectElement>('mode-select')
  modeSelect.replaceChildren(...MODES.map((m) => new Option(m.name, m.id)))
  modeSelect.addEventListener('change', async () => {
    settings = await api.saveSettings({ mode: modeSelect.value })
    renderMode()
  })

  $('reply-mode').addEventListener('change', async (e) => {
    const value = (e.target as HTMLInputElement).value as Settings['replyMode']
    settings = await api.saveSettings({ replyMode: value })
    if (settings.replyMode === 'text') voice.stop()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || (e.target as HTMLElement).closest('.hotkey')) return
    if (!menu.hidden) setMenu(false)
    else if (speechSynthesis.speaking) voice.stop()
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
  wire()
  settings = await api.getSettings()
  applyTheme()
  renderReplyMode()
  renderMode()
  renderShortcutHelp()
  emptyState = $('empty').cloneNode(true)
  updateListeningUi()
  if (!settings.anthropicApiKey || !settings.sttApiKey) {
    showBanner('Add your API keys in Settings to get started.', 'info', true)
    return
  }
  const failed = (await api.hotkeyStatus()).filter((s) => s.error && s.error !== 'Off')
  if (failed.length) {
    showBanner(
      `Some shortcuts are taken by other apps: ${failed.map((f) => displayHotkey(f.accelerator)).join(', ')}. Change them in Settings.`,
      'error'
    )
  }
}

void init()
