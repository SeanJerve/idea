# Screen Copilot

A Windows desktop assistant that watches your screen and listens to your microphone and computer audio, so you can ask about anything that's happening. Answers appear in a small always-on-top overlay, are spoken aloud, or both.

```
 Mic ───────────► speech-to-text, labeled "Me"   ─┐
 Computer audio ► speech-to-text, labeled "Them" ─┼─► recent transcript ─► Claude ─► overlay and/or voice
 Screen ────────► screenshot when you ask        ─┘
```

## Features

- **Ask about your screen.** Type or speak a question. A screenshot of the monitor your mouse is on goes along with it.
- **Live transcript.** Your mic is "Me" and everything your computer plays (a call, a video) is "Them". The last few minutes go with each question.
- **Quick actions.** *Suggest reply* writes what you could say next. *Summarize* recaps the conversation.
- **Replies your way.** Show them in the overlay, speak them with Windows' built-in voices, or both.
- **Stays out of the way.** The overlay floats on top and is draggable and resizable. It is left out of its own screenshots and, if you choose, out of screen shares.

## Hotkeys

| Keys | Action |
|---|---|
| `Ctrl+Shift+Space` | Show the overlay and type a question (press again to hide) |
| `Ctrl+Shift+A` | Ask out loud: press, speak, press again to send |
| `Ctrl+Shift+R` | Suggest what to say next |
| `Ctrl+Shift+L` | Start / stop listening |
| `Esc` | Stop speaking, or hide the overlay |

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
4. Click the gear icon and add:
   - an **Anthropic API key** (https://console.anthropic.com), for answers
   - a **speech-to-text key**, for transcription. OpenAI (https://platform.openai.com) is the default. Groq (https://console.groq.com) is cheaper and very fast; choose it under *Provider*.

   Keys are stored encrypted with Windows' credential protection. You can also set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` environment variables.

To build an installer: `npm run dist:win`. The `.exe` lands in `dist/`.

## Tips

- **Use headphones.** Without them your mic also picks up the other person through your speakers, and their words show up twice.
- **Speed vs. quality.** Settings → Effort: *Low* is fastest. Settings → Model: `claude-haiku-5-5` is the quickest and cheapest; `claude-opus-5-5` (default) is the smartest.
- **Cost.** Speech-to-text runs only while you're listening and only on speech, not silence (OpenAI is about $0.003 per minute of speech). Claude is called only when you ask, with one screenshot and a few minutes of transcript.

## Privacy and consent

Audio and screenshots are sent to the API providers you configure. Nothing is stored on disk except your settings. The transcript lives in memory and is gone when you quit.

Recording or transcribing other people can require their consent; in some places all parties must agree. Let people know when you're transcribing a call. Many employers and schools forbid AI help during interviews and exams.

## Development

```
npm run dev        # run with hot reload
npm run typecheck  # TypeScript checks
npm test           # unit tests (voice detection, WAV encoding, prompt building)
npm run build      # production bundle in out/
```

Layout:

- `src/main/`: Electron main process: overlay window, hotkeys, screenshots, Claude calls (`assistant.ts`), speech-to-text (`transcribe.ts`), settings
- `src/preload/`: the safe bridge between the UI and the main process
- `src/renderer/`: the overlay UI, audio capture and voice detection (`src/audio/`), text-to-speech
- `src/shared/`: types and the prompt builder

System audio uses Electron's Windows loopback capture. macOS and Linux would need a different capture path; everything else is cross-platform.
