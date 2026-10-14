const MODIFIERS = new Map<string, string>([
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['command', 'Command'],
  ['cmd', 'Command'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['altgr', 'AltGr'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Super']
])

const NAMED_KEYS = [
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Enter', 'Return', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'PrintScreen', 'Plus',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'
]
const KEY_LOOKUP = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]))
const PUNCTUATION = new Set([...'`-=[]\;\',./'])

function normalizeKey(raw: string): string | null {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase()
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase()
  if (PUNCTUATION.has(raw)) return raw
  return KEY_LOOKUP.get(raw.toLowerCase()) ?? null
}

export type ParsedHotkey = { ok: true; accelerator: string } | { ok: false; error: string }

/**
 * Checks and normalizes an Electron accelerator such as "Ctrl+Shift+Space".
 * Requires a modifier (except for function keys), so typing in other apps is never hijacked.
 */
export function parseHotkey(input: string): ParsedHotkey {
  const parts = input
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return { ok: false, error: 'Enter a shortcut.' }

  const mods: string[] = []
  let key: string | null = null
  for (const part of parts) {
    const mod = MODIFIERS.get(part.toLowerCase())
    if (mod) {
      if (mods.includes(mod)) return { ok: false, error: `${mod} appears twice.` }
      mods.push(mod)
      continue
    }
    if (key) return { ok: false, error: 'Use only one key besides the modifiers.' }
    key = normalizeKey(part)
    if (!key) return { ok: false, error: `"${part}" isn't a key that can be used.` }
  }
  if (!key) return { ok: false, error: 'Add a key after the modifiers.' }
  const isFunctionKey = /^F\d+$/.test(key)
  if (mods.length === 0 && !isFunctionKey) {
    return { ok: false, error: 'Add Ctrl, Alt, or Shift so normal typing isn\'t captured.' }
  }
  if (mods.length === 1 && mods[0] === 'Shift' && !isFunctionKey) {
    return { ok: false, error: 'Shift alone would capture normal typing; add Ctrl or Alt.' }
  }
  return { ok: true, accelerator: [...mods, key].join('+') }
}

/** Human-friendly form for the UI on Windows: CommandOrControl → Ctrl. */
export function displayHotkey(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl|Control/g, 'Ctrl')
    .replace(/Super/g, 'Win')
    .replace(/\+/g, ' + ')
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/'
}

export interface KeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * Turns a key press into an accelerator, using the physical key (event.code) so
 * it works the same on any keyboard layout. Returns null for a bare modifier press.
 */
export function hotkeyFromKeyEvent(e: KeyLike): string | null {
  let key: string | undefined
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^Numpad[0-9]$/.test(e.code)) key = `num${e.code.slice(6)}`
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code
  else key = CODE_KEYS[e.code]
  if (!key) return null
  const mods = [
    e.ctrlKey ? 'CommandOrControl' : '',
    e.altKey ? 'Alt' : '',
    e.shiftKey ? 'Shift' : '',
    e.metaKey ? 'Super' : ''
  ].filter(Boolean)
  return [...mods, key].join('+')
}

/** Finds actions that share a shortcut. */
export function duplicateHotkeys(map: Record<string, string>): string[][] {
  const byKey = new Map<string, string[]>()
  for (const [action, acc] of Object.entries(map)) {
    const parsed = parseHotkey(acc)
    const norm = (parsed.ok ? parsed.accelerator : acc).toLowerCase()
    byKey.set(norm, [...(byKey.get(norm) ?? []), action])
  }
  return [...byKey.values()].filter((actions) => actions.length > 1)
}
