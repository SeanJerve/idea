# Bowl Lab: standing instructions

You are building the Bowl Lab self-order kiosk system **unattended**. The owner is away and will only read the final report. Never wait for them.

## Sources of truth
- `SPEC.md`: the full spec. Milestones are in §22, acceptance tests in §23.
- `docs/PHASES.md`: for each milestone, the instruction to follow and the check to run.
- `data/seed-menu.json` (+ schema), `design/tokens.*`, `database/*.sql` and `database/tests/`, `reference/prototype.html`: use these as they are and don't retype their contents.

## The loop
1. Read `PROGRESS.md`. Work on the first milestone that isn't ticked.
2. Break it into small steps. Implement, then run the relevant tests after each step.
3. Commit working progress at least every hour (`WIP: milestone N: <what>`).
4. When the milestone's check in `docs/PHASES.md` passes and every test is green, tick it in `PROGRESS.md`, add a log line, commit `Milestone N: <name>`, and go straight on.
5. When all 8 are ticked:
   - Write `FINAL_REPORT.md`: a table of every §23 acceptance test with pass/fail, how to run each app, the owner to-do list with exact steps, and known risks.
   - Set `STATUS: COMPLETE` and commit.

## Rules for working alone
- **Never ask questions.** Decide, and record the decision in `ASSUMPTIONS.md` or `docs/adr/`.
- **Non-interactive commands only:** pass `--yes`/`-y`/`--no-input`/`--ci` style flags. Never open editors, pagers or prompts.
- **Nothing long-running in the foreground:** no dev servers or watch modes. Start servers in the background with a timeout and stop them afterwards; let Playwright's `webServer` start apps for e2e tests. Put a timeout on every command. If something hangs twice, change approach.
- **Tools:** install what you need yourself. If `pnpm` is missing, use `corepack pnpm` or `npx pnpm`; if the Supabase CLI is missing, use `npx supabase`. Create no cloud resources and use no paid APIs.
- **Database without Docker:**
  - If `docker info` works, use the local Supabase stack (`supabase start`).
  - If it doesn't, don't stop and don't ask. Run the same SQL on an npm-installed Postgres (for example the `embedded-postgres` package), with `database/tests/00_supabase_stubs.sql` standing in for Supabase-only parts.
  - Serve the Edge Function routes from a small local Node server that uses the same handlers (SPEC.md §10.7 keeps them portable).
  - Record the swap in an ADR. Add "run the backend on Supabase" to Owner to-do.
- **Stay in this folder:** never push to a remote, never touch files outside this folder (package caches excepted), never edit `.claude/` or this file.
- **Tests:**
  - Never skip, disable, delete or weaken a failing test; fix the cause.
  - A test that truly can't run here (needs real hardware or keys) must be skipped only behind a clearly named environment variable, and listed under Owner to-do.
- **Never invent nutrition or allergen data.**
- **When stuck:** after about 3 failed attempts at the same thing, write it under Open issues in `PROGRESS.md` (what you tried, the workaround), take the workaround or move to the next item, and come back later.
- **BLOCKED is a last resort.** Set `STATUS: BLOCKED` only if nothing at all can progress (for example Node.js or Claude Code itself can't run), and write exactly what the owner must do.
- **Keep context lean:** don't print whole large files or logs; use `head`, `tail`, `grep`. Keep `PROGRESS.md` current, because a fresh session may pick up from it at any time.
