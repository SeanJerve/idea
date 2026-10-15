# Screen Copilot

A Windows desktop assistant that watches your screen and listens to your microphone and computer audio, so you can ask about anything that's happening. Answers appear in a small always-on-top overlay, are spoken aloud, or both.

```
 Mic ───────────► speech-to-text, labeled "Me"   ─┐
 Computer audio ► speech-to-text, labeled "Them" ─┼─► recent transcript ─► Claude ─► overlay and/or voice
 Screen ────────► screenshot when you ask        ─┘
```

## Use cases

Pick a **mode** at the bottom of the overlay. Each one tunes the answers and gives you one-click buttons for that situation.

| Situation | Mode | What to do |
|---|---|---|
| Anything on screen ("what is this?", "how do I…?") | General | Type or say a question. Or click *What's this?* |
| Meetings and calls (Teams, Zoom, Meet) | Meeting | Start listening. Use *What did I miss?*, *Action items*, *Suggest reply*, *Summarize* |
| Practicing for interviews | Interview practice | *Help me answer* structures an answer; *Rate my answer* gives feedback; *Likely follow-ups* |
| Programming: errors, stack traces, code | Coding | *Explain this error*, *Find the bug*, *Explain this code*. Snip just the terminal or the function for precise answers |
| Lectures, videos, articles, homework | Study | *Explain simply*, *Key points*, *Quiz me* |
| Foreign-language calls, videos, or pages | Translator | Start listening: every line gets translated underneath. *Translate screen*, *Reply in their language*, *What did they say?* |
| Low vision, or away from the screen | Read & describe | *Describe screen*, *Read text aloud*, *What can I do here?* (always spoken) |
| A chart, photo, or part of the screen | Any | Snip an area (`Ctrl+Shift+G`), or paste / drop an image into the box, then ask |
| Answers in your own language | Any | Settings → *Answer language* (e.g. Tagalog) |
| Hands-free | Any | `Ctrl+Shift+A` to ask out loud; reply mode *Speak* |
| Long meetings | Meeting | *Summarize* and *Action items* use the whole session (the most recent part if it's very long) |
| Only typing, no audio | Any | Works without a speech-to-text key; only listening needs it |
| Shortcut clashes with another app | Any | Settings → Shortcuts: click and press new keys. Conflicts are flagged |
| Always ready | Any | Settings → *Start with Windows* (starts in the tray) |

## Features

- **Ask about your screen.** Type or speak a question. A screenshot of the monitor your mouse is on goes along with it.
- **Modes.** General, Meeting, Interview practice, Coding, Study, Translator, Read & describe; each with its own quick actions.
- **Snip, paste, or drop images.** Ask about just one area of the screen, or a picture you have. Attached images replace the full screenshot for that question.
- **Live translation.** In Translator mode each transcript line is translated into your answer language.
- **Live transcript.** Your mic is "Me" and everything your computer plays (a call, a video) is "Them". The last few minutes go with each question.
- **Quick actions.** *Suggest reply* writes what you could say next. *Summarize* recaps the conversation (last hour).
- **Auto-suggest (optional).** When the other side asks a question and pauses, a suggested reply appears on its own. Turn it on in Settings → Listening.
- **Echo removal.** Without headphones your mic also hears the other person; those duplicate lines are detected and dropped.
- **Click-through mode.** `Ctrl+Shift+X` keeps the overlay visible but lets clicks pass to the window behind it.
- **Copy, save, clear.** Copy any answer, save the whole session (transcript + answers) as a Markdown file, or wipe it.
- **Remembers its place.** The overlay reopens where you left it (and comes back on screen if that monitor is gone).
- **Replies your way.** Show them in the overlay, speak them with Windows' built-in voices, or both.
- **Clean, Claude-inspired design.** Warm paper and coral in light mode, a warm near-black in dark; follows Windows automatically, or pick a theme in Settings. The overlay floats on top and is draggable and resizable. It is left out of its own screenshots and, if you choose, out of screen shares.

## Hotkeys

| Keys | Action |
|---|---|
| `Ctrl+Shift+Space` | Show the overlay and type a question (press again to hide) |
| `Ctrl+Shift+A` | Ask out loud: press, speak, press again to send |
| `Ctrl+Shift+R` | Suggest what to say next |
| `Ctrl+Shift+L` | Start / stop listening |
| `Ctrl+Shift+X` | Click-through on / off |
| `Ctrl+Shift+G` | Snip an area of the screen to ask about |
| `Esc` | Stop speaking, or hide the overlay |

All shortcuts can be changed in Settings → Shortcuts. The defaults avoid Microsoft Teams' meeting shortcuts (`Ctrl+Shift+K/M/O/E/H/B/D/S`).

## Setup (Windows)

1. Install [Node.js 22+](https://nodejs.org).
2. Clone the repo and install:
   ```
   git clone https://github.com/seanjerve/idea.git
   cd idea
   npm install
   ```
3. Run it:
   ```
   npm run dev
   ```
4. Open Settings (the sliders icon at the top) and add:
   - an **Anthropic API key** (https://console.anthropic.com), for answers
   - a **speech-to-text key**, for transcription. OpenAI (https://platform.openai.com) is the default. Groq (https://console.groq.com) is cheaper and very fast; choose it under *Provider*.

   Keys are stored encrypted with Windows' credential protection. You can also set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` environment variables.

To build an installer: `npm run dist:win`. The `.exe` lands in `dist/`.

**Or download one:** every push to `main` builds a Windows installer on GitHub Actions. Open the repo's **Actions** tab → latest **CI** run → **Artifacts** → `screen-copilot-windows`. It isn't code-signed, so Windows SmartScreen will warn the first time; choose *More info → Run anyway*.

## Tips

- **Use headphones if you can.** Echo removal catches most duplicates, but headphones keep the transcript cleanest.
- **Speed vs. quality.** Settings → Effort: *Low* is fastest. Settings → Model: `claude-haiku-5-5` is the quickest and cheapest; `claude-opus-5-5` (default) is the smartest.
- **Translation speed.** Live translation makes one small request per line. Settings → *Live translation model* → `claude-haiku-5-5` makes it faster and much cheaper.
- **Cost.** Speech-to-text runs only while you're listening and only on speech, not silence (OpenAI is about $0.003 per minute of speech). Claude is called only when you ask, with one screenshot and a few minutes of transcript.

## Privacy and security

Audio and screenshots are sent only to the API providers you configure (Anthropic and your speech-to-text service); there's no server of ours in between. Nothing is stored on disk except your settings and any session you choose to save. The transcript lives in memory and is gone when you quit.

API keys are encrypted at rest with Windows' credential protection, and the speech-to-text key is refused over plain `http` to a remote host so it can't be sent in the clear. The window that renders answers is sandboxed, makes no network calls of its own, and can't navigate away from the app. See [SECURITY.md](SECURITY.md) for the full picture.

## Consent

Recording or transcribing other people can require their consent; in some places all parties must agree. Let people know when you're transcribing a call. Many employers and schools forbid AI help during interviews and exams.

## Development

```
npm run dev        # run with hot reload
npm run typecheck  # TypeScript checks
npm test           # unit tests
npm run test:e2e   # end-to-end tests: launches the real app (on Linux, wrap in xvfb-run)
npm run build      # production bundle in out/
```

**Unit tests** (`test/`) cover voice detection (including steady background noise), WAV encoding, transcript ordering and echo removal, auto-suggest timing, the transcription queue, speech-to-text retries against a local HTTP server, the Claude request shape, prompt building, and window placement.

**End-to-end tests** (`e2e/`) launch the built Electron app against a local fake of the Claude and speech-to-text APIs, with a fake microphone that plays generated speech-like audio. `app.spec.ts` checks the core flows (streaming answers, screenshots, follow-ups, cancelling, errors, live transcription, spoken questions, settings, copy, save, clear, hide, window memory). `use-cases.spec.ts` walks through every use case above: each mode, live translation, spoken replies, snipping, pasting and dropping images, working without a speech key, changing and conflicting shortcuts, and starting hidden at sign-in. CI runs everything on every push.

Layout:

- `src/main/`: Electron main process: overlay window, hotkeys, screenshots, Claude calls (`assistant.ts`), speech-to-text (`transcribe.ts`), settings
- `src/preload/`: the safe bridge between the UI and the main process
- `src/renderer/`: the overlay UI, audio capture and voice detection (`src/audio/`), text-to-speech
- `src/shared/`: types, the prompt and request builders, window placement

System audio uses Electron's Windows loopback capture. macOS and Linux would need a different capture path; everything else is cross-platform.
