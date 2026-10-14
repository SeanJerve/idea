# Security

Screen Copilot runs on your own machine and talks to two services you configure:
Anthropic (for answers) and an OpenAI-compatible speech-to-text endpoint (for the
transcript). There is no server of ours in between.

## What the app does to stay safe

**Your keys**
- API keys are encrypted at rest with Windows' credential protection (Electron
  `safeStorage`) and only decrypted in the app's own process.
- The speech-to-text key is refused if the endpoint URL isn't `https://` (or a
  server on your own machine), so the key is never sent in the clear.

**The window that renders answers**
- Runs sandboxed, with Node integration off and context isolation on; the page
  can only reach the main process through a small, fixed set of channels.
- A strict Content-Security-Policy; the renderer makes no outbound network
  requests of its own — all API calls happen in the main process.
- Navigation away from the app's own pages is refused, child windows are denied,
  and links in answers open in your real browser.
- Only the microphone and screen-capture permissions are granted; everything
  else (geolocation, notifications, USB, …) is denied.

**Input handling**
- Every message the window sends to the main process is validated and size-capped:
  unknown settings are dropped, values are coerced to their expected type and
  range, and malformed requests are ignored.
- Claude's answers are rendered as Markdown through DOMPurify, so a crafted answer
  can't inject active content into the window.

**Data**
- Nothing is stored on disk except your settings and any session you explicitly
  save. The transcript lives in memory and is gone when you quit.

## Dependencies

`npm audit --omit=dev` reports no known vulnerabilities in what the app ships. CI
runs this on every push. (The `electron-builder` tool used only to produce the
installer has its own advisories; that code never runs inside the app.)

## Reporting

Found something? Open a private security advisory on the GitHub repository, or an
issue if it's low risk.
