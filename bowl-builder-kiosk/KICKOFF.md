# One Prompt to Build Everything

Paste the prompt below into a new **Claude Code** session (or Cursor agent) opened in an **empty folder**. It sets itself up from this repo and works through all 8 milestones on its own, committing after each one. Unlike [`PHASES.md`](PHASES.md), you don't send messages one by one.

**What to expect:**
- **It's a big build.** Expect many hours of agent work. If the session stops or runs out of room, start a new one with the same prompt. It reads `PROGRESS.md` and picks up where it left off.
- **It runs fully on your machine.** It uses a local Supabase stack, so no cloud accounts or keys are needed. It does need **Docker** running (for Supabase), plus Node.js 20+ and Git.
- **Some things only you can do.** It lists these at the end instead of blocking on them: your restaurant details, a hosted Supabase project for going live, Stripe keys, testing on a real tablet, real nutrition data and a legal check.

---

```
You are building the Bowl Lab self-order kiosk system from a complete, tested spec. Work autonomously through all 8 milestones without stopping between them.

## Setup (first run only; skip anything already done)
1. If this folder isn't a git repository, run `git init`.
2. Get the spec kit:
   git clone --depth 1 --branch claude/bowl-kiosk-prompt https://github.com/SeanJerve/idea.git .spec-kit
3. From .spec-kit/bowl-builder-kiosk copy:
   - PROMPT.md → SPEC.md (keep the whole file: the "Make it yours" table and the spec between START OF PROMPT and END OF PROMPT)
   - data/, design/, database/ → same paths here
   - prototype/index.html → reference/prototype.html
   - PHASES.md → docs/PHASES.md
   Then delete .spec-kit and add it to .gitignore.
4. Check tools: node -v (20+), pnpm, git, docker, the Supabase CLI. Install pnpm and the Supabase CLI if missing. If Docker isn't running, say so once, finish milestones 1–3, write the code for 4–8 against the local Supabase stack, and list exactly what to run once Docker is available.
5. Read SPEC.md completely, then data/seed-menu.json, design/tokens.css, database/README.md and reference/prototype.html.

## How to work
- Build milestones 1–8 from SPEC.md §22 in order. docs/PHASES.md has the instruction and the check for each milestone: follow the instruction and run the check yourself.
- A milestone is finished only when the apps build, every test passes (including the database tests or their pgTAP port), and README.md explains how to run it. Then commit as "Milestone N: <name>" and go straight on to the next one.
- Keep PROGRESS.md up to date at every commit: status of each milestone, what's done, what's next, open issues. If this is a new or resumed session, read PROGRESS.md first and continue from the first unfinished milestone.
- Use the local Supabase stack (`supabase start`) for the backend. No hosted project or cloud accounts.
- Milestone 8: build the PaymentTerminal adapter with a simulator used in tests; the Stripe Terminal implementation reads keys from environment variables and its tests are skipped when keys are absent. Label printing: PDF preview plus a simulated printer.
- Never invent nutrition or allergen data. Never skip, disable, delete or weaken a failing test; fix the cause.
- Don't ask questions. Record assumptions in ASSUMPTIONS.md and decisions in docs/adr/. Stop only if truly blocked (for example a required tool can't be installed), and then say exactly what you need.

## Leave these for the owner (list them in the final report; don't block on them)
- Filling in "Make it yours" in SPEC.md (use the defaults until then)
- A hosted Supabase project and deployment; Stripe test or live keys
- Testing on real hardware: tablet, portrait screen, keypad, headphones, label printer
- Replacing estimated nutrition values with real ones; a legal check of accessibility and menu-labeling rules

## Final report
When all 8 milestones are done: a table of every SPEC.md §23 acceptance test with pass or fail, how to run each app, the owner's to-do list above with exact steps, and known risks.
```
