# Build It Unattended

Open Claude Code in a **new, empty folder** and paste this:

```
Build the Bowl Lab kiosk app from my spec kit, fully unattended. Do these steps yourself without asking me, and fix anything that fails:
1. Make sure Node.js 20+ and Git work in this terminal; install them if they're missing.
2. Get the kit: git clone --depth 1 --branch claude/bowl-kiosk-prompt https://github.com/SeanJerve/idea.git .spec-kit (if .spec-kit already exists, run git -C .spec-kit pull instead).
3. Start the autopilot: node .spec-kit/bowl-builder-kiosk/autopilot/start-build.mjs . --background
4. Wait about a minute, show me the last 10 lines of .autopilot/autopilot.log, and confirm it's running. Then you're done: it keeps building on its own in the background.
```

If Claude Code asks permission for a command, choose the option that allows it.

That's all. The autopilot then works by itself for many hours:
- It builds all 8 milestones and commits as it goes.
- After usage limits or crashes, it waits and restarts itself.
- Docker is used if it's running; otherwise an npm-installed database stands in.
- It stops when `FINAL_REPORT.md` is written.

**To check on it:** open `PROGRESS.md` in that folder.

**When it's finished:** `FINAL_REPORT.md` has the test results, how to run each app, and the few things only you can do (restaurant details, going live, card-payment keys, testing on a real tablet, real nutrition values).

**If it stops:** your computer slept or restarted, or `PROGRESS.md` says `BLOCKED`. Paste the same prompt again in the same folder and it resumes.

---

## Details (optional)

- **What the autopilot sets up:** the spec, menu data, design tokens, database and prototype; `CLAUDE.md` (standing orders); `PROGRESS.md`; and a Stop hook that keeps Claude working until the build is complete. Then it runs Claude Code in auto mode in a loop. Logs are in `.autopilot/`.
- **Limits:** it never pushes to GitHub, creates cloud accounts or edits its own rules. Its output goes to `.autopilot/autopilot.log`.
- **If your plan doesn't include auto mode:** run the start command yourself inside a container or VM as a normal user and add `--mode bypass`.
- **Prefer to go step by step?** Use [`PHASES.md`](PHASES.md).
