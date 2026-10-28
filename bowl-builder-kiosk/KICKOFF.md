# Build It Unattended

Start the build with one command, walk away, and come back to a finished build (or a short list of things only you can do).

## Autopilot (recommended)

```bash
git clone --depth 1 --branch claude/bowl-kiosk-prompt https://github.com/SeanJerve/idea.git bowl-kit
node bowl-kit/bowl-builder-kiosk/autopilot/start-build.mjs bowl-lab
```

That's it. It creates the project in `bowl-lab/` and runs Claude Code on its own through all 8 milestones. The terminal shows what it's doing; you don't need to watch it.

**What it does for you**
- **Sets up the project:** spec, menu data, design tokens, database and prototype, committed to a new git repo.
- **Runs Claude Code in auto mode:** it doesn't stop to ask permission, and a built-in safety check reviews each action before it runs.
- **Doesn't stop early.** A Stop hook prevents Claude from ending its session until all 8 milestones are ticked and `FINAL_REPORT.md` is written, or it's truly blocked.
- **Survives restarts.** If Claude crashes, loses its network, or hits your plan's usage limit, the autopilot waits (15 minutes, doubling up to an hour) and starts a fresh session. It picks up where it left off using `PROGRESS.md` and the standing orders in `CLAUDE.md`.
- **Keeps it safe:** it never pushes to GitHub, never creates cloud accounts or resources, and never edits its own rules.

**Before you run it**
1. **Claude Code installed and signed in.** Run `claude` once and log in. Auto mode needs a plan and model that include it. If it's refused, see "If auto mode isn't available" below.
2. **Docker Desktop running.** The backend runs Supabase locally in Docker.
3. **Node.js 20+ and Git.**
4. **Keep the computer awake and plugged in.** On a Mac: `caffeinate -i node bowl-kit/bowl-builder-kiosk/autopilot/start-build.mjs bowl-lab`. On Windows, set sleep to "Never" while it runs.
5. **Windows: run it inside WSL** (Ubuntu), with Docker Desktop's WSL integration turned on.

**While it runs**
- **To see progress:** `bowl-lab/PROGRESS.md`, `git -C bowl-lab log --oneline`, or the terminal output. Full logs are in `bowl-lab/.autopilot/logs/`.
- **To stop:** Ctrl+C. **To resume:** run the same command again.
- **How long it takes:** expect many hours, possibly more than a day with usage-limit pauses. It uses your Claude plan's usage.

**When it finishes**
- **Finished:** it prints "Build complete". Read `bowl-lab/FINAL_REPORT.md`: the acceptance-test table, how to run each app, and your to-do list.
- **Blocked:** it prints "The build needs you" and points to `PROGRESS.md` → Open issues. Fix what it says, then run the same command to continue.

**What it can't do without you** (the final report lists these with steps)
- Your restaurant details in "Make it yours" (it uses the defaults).
- A hosted Supabase project and going live.
- Stripe keys for card payments.
- Testing on a real tablet, portrait screen, keypad, headphones and label printer.
- Real nutrition values.
- A legal check of accessibility and labeling rules for your location.

**If auto mode isn't available**
Run it in an isolated container or VM as a normal (non-root) user and add `--mode bypass`, which skips all permission checks. Only do this in an isolated environment.

**Options:** `--setup-only` (create the project without starting Claude), `--max-runs N`, `--retry-wait MINUTES`.

---

## Without the autopilot: one prompt

If you'd rather paste a prompt into Claude Code (opened in an empty folder), use this. It does the same setup and work, but it can stop when a session ends or hits a limit. If it does, send the same prompt again to continue.

```
You are building the Bowl Lab self-order kiosk system from a complete, tested spec. Work autonomously through all 8 milestones without stopping between them.

## Setup (first run only; skip anything already done)
1. If this folder isn't a git repository, run `git init`.
2. Get the spec kit:
   git clone --depth 1 --branch claude/bowl-kiosk-prompt https://github.com/SeanJerve/idea.git .spec-kit
3. From .spec-kit/bowl-builder-kiosk copy:
   - PROMPT.md → SPEC.md
   - data/, design/, database/ → same paths here
   - prototype/index.html → reference/prototype.html
   - PHASES.md → docs/PHASES.md
   - autopilot/template/CLAUDE.md → CLAUDE.md and autopilot/template/PROGRESS.md → PROGRESS.md
   Then delete .spec-kit and add it to .gitignore.
4. Read CLAUDE.md and follow it from now on. Then read SPEC.md completely.

## Then
Follow CLAUDE.md: work through PROGRESS.md milestone by milestone, commit after each one, and don't stop until all 8 are done and FINAL_REPORT.md is written, or nothing can progress without me.
```
