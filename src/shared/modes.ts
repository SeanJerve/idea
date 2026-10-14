/** A one-click request shown as a button under the question box. */
export interface QuickAction {
  id: string
  label: string
  /** What is asked. Empty means a built-in kind (see `kind`). */
  prompt: string
  kind?: 'suggest-reply' | 'summarize'
  /** How much transcript to include; 'all' means the whole session. Defaults to the user's setting. */
  transcript?: number | 'all'
  /** Always read this answer aloud, whatever the reply mode. */
  speak?: boolean
}

export interface Mode {
  id: string
  name: string
  /** Shown under the mode picker. */
  hint: string
  /** Added to every request made in this mode. */
  instructions: string
  actions: QuickAction[]
  /** Translate each transcript line into the reply language. */
  liveTranslate?: boolean
}

const SUGGEST: QuickAction = { id: 'suggest', label: 'Suggest reply', prompt: '', kind: 'suggest-reply' }
const SUMMARIZE: QuickAction = { id: 'summarize', label: 'Summarize', prompt: '', kind: 'summarize', transcript: 'all' }

export const MODES: Mode[] = [
  {
    id: 'general',
    name: 'General',
    hint: 'Ask about anything on your screen or in the conversation.',
    instructions: '',
    actions: [
      SUGGEST,
      SUMMARIZE,
      { id: 'explain-screen', label: "What's this?", prompt: "Explain what I'm looking at on the screen and anything I should notice." }
    ]
  },
  {
    id: 'meeting',
    name: 'Meeting',
    hint: 'Calls and meetings: catch up, track decisions, answer on the spot.',
    instructions:
      'The user is in a meeting or call. Keep track of who said what, decisions, owners, and deadlines. When suggesting what to say, keep it natural and short enough to say out loud.',
    actions: [
      { id: 'missed', label: 'What did I miss?', prompt: 'Catch me up on the last few minutes of the conversation in a few bullets.', transcript: 5 },
      { id: 'actions', label: 'Action items', prompt: 'List the decisions and action items so far, with owners and deadlines where mentioned.', transcript: 'all' },
      SUGGEST,
      SUMMARIZE
    ]
  },
  {
    id: 'interview',
    name: 'Interview practice',
    hint: 'Mock interviews and prep: structure answers and get feedback.',
    instructions:
      'The user is practicing for interviews. Help them structure answers (for behavioral questions, use situation, task, action, result) using details from their own words where possible. Be honest and specific in feedback.',
    actions: [
      { id: 'answer', label: 'Help me answer', prompt: '', kind: 'suggest-reply' },
      { id: 'feedback', label: 'Rate my answer', prompt: 'Give feedback on my most recent answer: what worked, what to tighten, and a stronger version in two or three sentences.' },
      { id: 'followups', label: 'Likely follow-ups', prompt: 'What follow-up questions are they likely to ask next, and a one-line angle for each?' }
    ]
  },
  {
    id: 'coding',
    name: 'Coding',
    hint: 'Errors, stack traces, code on screen, docs.',
    instructions:
      'The user is programming. Read code, terminals, and error messages on the screen carefully. Point to exact lines, names, and messages. Prefer the smallest fix that works, shown as a short code block.',
    actions: [
      { id: 'error', label: 'Explain this error', prompt: 'Explain the error on my screen: the likely cause and how to fix it.' },
      { id: 'bug', label: 'Find the bug', prompt: 'Look at the code on my screen and point out bugs or risky spots, most important first.' },
      { id: 'code', label: 'Explain this code', prompt: 'Explain what the code on my screen does, step by step, briefly.' }
    ]
  },
  {
    id: 'study',
    name: 'Study',
    hint: 'Lectures, videos, articles, homework you want to understand.',
    instructions:
      'The user is learning. Explain clearly with simple words and a concrete example. Help them understand rather than just giving final answers, and point out common misconceptions.',
    actions: [
      { id: 'simple', label: 'Explain simply', prompt: 'Explain what is on my screen (or what was just said) in simple terms with one example.' },
      { id: 'points', label: 'Key points', prompt: 'List the key points from the lecture or material so far.', transcript: 'all' },
      { id: 'quiz', label: 'Quiz me', prompt: 'Ask me three short questions to check that I understood this material. Do not give the answers yet.' }
    ]
  },
  {
    id: 'translator',
    name: 'Translator',
    hint: 'Foreign-language calls, videos, and pages. Lines are translated live.',
    instructions:
      'The user needs help across languages. Translate faithfully and keep the tone. When suggesting what to say, write it in the language the other side is speaking, followed by its meaning in the reply language.',
    liveTranslate: true,
    actions: [
      { id: 'translate-screen', label: 'Translate screen', prompt: 'Translate the main text on my screen into my reply language.' },
      { id: 'reply-their-language', label: 'Reply in their language', prompt: '', kind: 'suggest-reply' },
      { id: 'what-said', label: 'What did they say?', prompt: 'Translate and explain what the other side said in the last minute, including any idioms.', transcript: 1 }
    ]
  },
  {
    id: 'accessibility',
    name: 'Read & describe',
    hint: 'Hands-free and low-vision help: describe and read the screen aloud.',
    instructions:
      'The user may have low vision or be away from the screen. Describe things in a logical reading order, mention where things are, and spell out important numbers. Never rely on colors alone.',
    actions: [
      { id: 'describe', label: 'Describe screen', prompt: "Describe what's on my screen: the app, the main content, and anything that needs my attention.", speak: true },
      { id: 'read', label: 'Read text aloud', prompt: 'Read the main text on my screen word for word, skipping menus and buttons.', speak: true },
      { id: 'next', label: 'What can I do here?', prompt: 'What are the main things I can do on this screen, and where are they?', speak: true }
    ]
  }
]

export function getMode(id: string): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}
