import { displayHotkey, duplicateHotkeys, hotkeyFromKeyEvent, parseHotkey } from '@shared/hotkeys'
import { HOTKEY_LABELS, type HotkeyAction, type HotkeyStatus } from '@shared/types'

/**
 * Settings rows for the global shortcuts. Click a field and press the keys you
 * want; Backspace turns a shortcut off; Esc puts the old one back.
 */
export class HotkeyEditor {
  private values: Record<HotkeyAction, string> = {} as Record<HotkeyAction, string>
  private readonly inputs = new Map<HotkeyAction, HTMLInputElement>()
  private readonly notes = new Map<HotkeyAction, HTMLElement>()

  constructor(private readonly root: HTMLElement) {}

  render(hotkeys: Record<HotkeyAction, string>, status: HotkeyStatus[]): void {
    this.values = { ...hotkeys }
    this.root.replaceChildren()
    this.inputs.clear()
    this.notes.clear()
    for (const action of Object.keys(HOTKEY_LABELS) as HotkeyAction[]) {
      const row = document.createElement('label')
      row.className = 'hotkey'
      const name = document.createElement('span')
      name.textContent = HOTKEY_LABELS[action]
      const input = document.createElement('input')
      input.readOnly = true
      input.dataset.action = action
      input.placeholder = 'Off'
      input.value = this.values[action] ? displayHotkey(this.values[action]) : ''
      input.addEventListener('focus', () => (input.placeholder = 'Press keys…'))
      input.addEventListener('blur', () => (input.placeholder = 'Off'))
      input.addEventListener('keydown', (e) => this.onKey(action, input, e))
      const note = document.createElement('small')
      const problem = status.find((s) => s.action === action)?.error
      if (problem && problem !== 'Off') {
        note.textContent = problem
        note.className = 'warn'
      }
      row.append(name, input, note)
      this.root.append(row)
      this.inputs.set(action, input)
      this.notes.set(action, note)
    }
  }

  private onKey(action: HotkeyAction, input: HTMLInputElement, e: KeyboardEvent): void {
    if (e.key === 'Tab') return
    e.preventDefault()
    const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
    if (bare && e.key === 'Escape') {
      input.value = this.values[action] ? displayHotkey(this.values[action]) : ''
      input.blur()
      return
    }
    if (bare && (e.key === 'Backspace' || e.key === 'Delete')) {
      this.set(action, '')
      return
    }
    const acc = hotkeyFromKeyEvent(e)
    if (!acc) return
    const parsed = parseHotkey(acc)
    const note = this.notes.get(action)
    if (!parsed.ok) {
      if (note) {
        note.textContent = parsed.error
        note.className = 'warn'
      }
      return
    }
    this.set(action, acc)
  }

  private set(action: HotkeyAction, acc: string): void {
    this.values[action] = acc
    const input = this.inputs.get(action)
    if (input) input.value = acc ? displayHotkey(acc) : ''
    const note = this.notes.get(action)
    if (note) {
      note.textContent = ''
      note.className = ''
    }
  }

  /** The edited shortcuts, or an error message if two actions share one. */
  collect(): { hotkeys: Record<HotkeyAction, string> } | { error: string } {
    const active = Object.fromEntries(Object.entries(this.values).filter(([, v]) => v))
    const dupes = duplicateHotkeys(active)
    if (dupes.length) {
      const names = dupes[0].map((a) => `"${HOTKEY_LABELS[a as HotkeyAction]}"`).join(' and ')
      return { error: `${names} use the same shortcut.` }
    }
    return { hotkeys: { ...this.values } }
  }
}
