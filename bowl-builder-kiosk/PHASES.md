# Running the Prompt in Phases

`PROMPT.md` describes the whole system. AI coding tools do their best work one milestone at a time, checking each before moving on. This page gives you the 8 messages to send, in order, and what to check after each.

## Before you start

1. Create an empty project folder or repository.
2. Copy these into it:

| From this folder | To the project as |
|---|---|
| `PROMPT.md` (the text between START and END) | `SPEC.md` |
| `data/` | `data/` |
| `design/` | `design/` |
| `database/` | `database/` |
| `prototype/index.html` | `reference/prototype.html` |

3. For milestone 4 you need a Supabase project (free tier is fine): its URL, **publishable key** and **secret key**. The secret key goes only into Edge Function secrets, never into app code.

Send each message, wait for it to finish, try the result yourself, then send the next.

---

## 1. Foundations

```
Read SPEC.md completely, then look at data/, design/, database/ and reference/.
Do milestone 1 only (SPEC.md §22): the monorepo and tooling from §9.2, CI gates from §18, packages/schema (Zod, matching data/seed-menu.schema.json), and packages/core with every function the spec needs, plus the §23 core unit and property tests. Wire design/tokens.css into Tailwind v4 with @theme.
No UI yet. Finish by showing the test output and listing your ADRs.
```
**Check:** tests pass. Bowl A = 530 cal / 51 g / $11.95, the promo and inclusive-tax tests pass.

## 2. Design system

```
Do milestone 2: packages/ui with every component in SPEC.md §7.8, using only the semantic tokens. Add Storybook stories for every state, in both themes and in RTL, with the accessibility addon. Match reference/prototype.html where it applies.
Finish by listing any component whose stories have axe violations (there should be none).
```
**Check:** open Storybook and look at IngredientCard, PortionSelector and BowlCanvas in light and dark.

## 3. Kiosk on local data

```
Do milestone 3: the full kiosk (SPEC.md §4–§6 and §8) running from data/seed-menu.json with no backend. Use the XState session machine from §9.3, bag persistence, bowl codes stored locally, accessibility mode, EN + ES, both orientations (1280x800 and 1080x1920).
Add the e2e tests from §23 that don't need a backend. Give me a 10-step manual test script for a tablet.
```
**Check:**
- Order Protein Power in 6 taps or fewer.
- Build Bowl A and compare its numbers.
- Turn on read-aloud and do an order with only a keyboard.

## 4. Backend

```
Do milestone 4: create the Supabase project from database/schema.sql and database/supabase.sql as migrations, seed it with database/seed.sql, and port database/tests to pgTAP. Build the Edge Functions in §10.3 with contract tests (orders recompute everything in packages/core and call place_order; idempotency; error codes). Add device pairing, menu caching with ETag, realtime topics and the offline outbox from §9.5.
My Supabase project URL and publishable key: <paste>. Put the secret key only into Edge Function secrets.
Explain how to pair a kiosk and how to test offline mode.
```
**Check:**
- Pair a tablet and place an order.
- Turn Wi-Fi off, place another order, then turn Wi-Fi back on. It arrives exactly once.

## 5. Kitchen and pickup

```
Do milestone 5: the KDS (Line, Grill with the all-day bar, Expo), bump-bar keys, timers, recall, the load-based wait estimate, the pickup board, and the label PDF preview (SPEC.md §12).
```
**Check:**
- An order appears on the KDS within 2 seconds.
- The pickup board shows "Sam R.", never the full name or the allergy note.

## 6. Admin

```
Do milestone 6: everything in SPEC.md §13: the menu editor with live preview, publish validation, diff, staged rollout and rollback, availability board, devices, orders, reports with the funnel and menu engineering matrix, settings with the contrast checker, and staff roles.
Walk me through changing a price, publishing it to one location, then rolling it back.
```
**Check:**
- Mark avocado sold out: it greys out on the kiosk within 2 seconds.
- Try to publish an ingredient with a missing allergen: publishing is blocked.

## 7. Hardening

```
Do milestone 7 (SPEC.md §7.10, §9.6–9.8, §14–§16): region presets, performance budgets measured on a low-cost tablet, chaos tests, Sentry and OpenTelemetry, alerts, runbooks, KIOSK_SETUP.md and the security checklist.
Run every test and give me a table of each §23 acceptance test with pass or fail.
```
**Check:** every row says pass. INP is 100 ms or less on the tablet.

## 8. Launch readiness

```
Do milestone 8: the k6 load test and 12-hour soak test from §18, a pilot checklist for one store, then the first extensions: card payments through the PaymentTerminal adapter (Stripe Terminal server-driven) and label printing through the print bridge.
```
**Check:** the load test shows `POST /v1/orders` p95 under 400 ms with zero errors.

---

## If something goes wrong

- **Numbers don't match:** "Bowl A shows X but SPEC.md §23 says 530 cal / 51 g protein. Find the bug in packages/core, fix it, and add a test that would have caught it."
- **It drifts from the spec:** "Re-read SPEC.md sections N–M, list every difference from the current code, then fix them."
- **It looks generic:** "Use only the semantic tokens from design/tokens.css and the components in §7.8. Compare against reference/prototype.html."
- **The database tests fail after a change:** "Run database/tests/run-local.sh, show me the failing check, and fix the schema or the test with a one-line explanation."

## Which tool for which phase

| Tool | Good for | Notes |
|---|---|---|
| Claude Code, Cursor | All 8 milestones | Runs tests, Supabase CLI and Postgres itself |
| Lovable, Bolt | Milestones 1–6 in a single app | Built-in Supabase connection; tell it to keep `core` and `schema` as plain TypeScript folders; check tests really run |
| v0 | Milestones 2–3 (components and screens) | Frontend only; move the result into a full project for milestone 4 |
