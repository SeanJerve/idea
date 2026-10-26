# Running the Prompt in Phases

`PROMPT.md` describes the whole system. That's a lot for one message, and AI coding tools do better work when they build one milestone at a time and check it before moving on. This page gives you the messages to send, in order.

## Before you start

1. Create an empty project folder (or a new project in your tool).
2. Save the text between **START OF PROMPT** and **END OF PROMPT** as `SPEC.md` in the project root. Keep your "Make it yours" values in it.
3. Optional: copy `prototype/index.html` into the project as `reference/prototype.html` so the builder can match the look.
4. For milestone 3 you need a free Supabase project. Have its URL and keys ready.

Send each message below, wait for it to finish, try the result yourself, then send the next one.

---

## Message 1: core engine

```
Read SPEC.md completely before writing any code. We'll build it one milestone at a time (section 15).

Do milestone 1 only: project setup, Zod schemas in src/schema, the seed menu in src/data, every function in src/core, and the unit and property tests from section 16 (Bowl A, Bowl B, Bowl C, rounding, validation, order totals, warning icons, property tests).

Don't build any UI yet. When all tests pass, show me the test output and list any decisions you made in ASSUMPTIONS.md.
```

**Check:** the tests pass and Bowl A shows 530 cal, 51 g protein, $11.95.

## Message 2: kiosk screens

```
Do milestone 2: the full kiosk (sections 4, 5 and 12.0–12.3) running on the local seed data, no backend yet. Use the design tokens in 12.0. If reference/prototype.html exists, match its look and layout.

Both layouts must work: 1280x800 landscape and 1080x1920 portrait. Include goals, suggestions, diet filters, bowl codes (stored locally for now), the review screen with the nutrition table, single-screen checkout, confirmation, and the idle reset.

When done, tell me how to run it and give me a 10-step manual test script I can follow on a tablet.
```

**Check:** open it on a tablet or in a browser at tablet size. Order "Protein Power" in 6 taps or fewer. Build Bowl A by hand and compare the numbers.

## Message 3: backend, kitchen and pickup

```
Do milestone 3 (sections 3.3, 9 and 11): Supabase schema and RLS, seed SQL, device pairing, the place-order Edge Function that recomputes price and nutrition with src/core and honors idempotency keys, published menu versions, live sold-out updates, the kitchen display with Line and Grill stations, the pickup board, and the offline order queue.

Here are my Supabase details: <paste project URL and publishable (anon) key; put the secret (service role) key only in the Edge Function's secrets, never in the frontend>.

Add the server tests from section 16. When done, explain how to pair a kiosk and how to test offline mode.
```

**Check:** place an order on the kiosk and watch it appear on `/kitchen` and `/pickup`. Turn Wi-Fi off, place an order, turn it back on, and confirm it shows up exactly once.

## Message 4: admin

```
Do milestone 4: everything in section 10. Include the publish diff and rollback, sold-out toggles, portion spec sheets, device list with heartbeat status, settings (including warning icons and tipping off by default), and reports with the ordering funnel.

When done, walk me through changing a price, publishing it, and seeing it on the kiosk.
```

**Check:** mark avocado sold out and see it grey out on the kiosk within 2 seconds. Change a price, publish, then roll back.

## Message 5: accessibility and polish

```
Do milestone 5: the accessibility mode in 12.2 (reach mode, larger text, high contrast, read-aloud audio mode, full keypad and keyboard control), Spanish translations, PWA precaching, kiosk lockdown, anonymous analytics (section 13), the performance budget (3.4), KIOSK_SETUP.md, and the full Playwright + axe suites at both screen sizes.

Finish by running every test and checking every item in section 16. Give me a table of each acceptance test with pass or fail.
```

**Check:** complete an order using only a keyboard with read-aloud on. Every row in the final table says pass.

---

## If something goes wrong

- **Numbers don't match section 16:** "Bowl A shows X but SPEC.md section 16 says 530 cal / 51 g protein. Find the bug in src/core, fix it, and add a test that would have caught it."
- **The builder starts drifting from the spec:** "Re-read SPEC.md sections N–M and list every place the current code differs. Then fix them."
- **It looks generic:** "Apply the tokens, fonts and layout in SPEC.md section 12.0 exactly. Compare against reference/prototype.html."

## Which tool for which phase

| Tool | Good for | Notes |
|---|---|---|
| Claude Code, Cursor | All 5 phases | Can run the tests and Supabase CLI itself |
| Lovable, Bolt | Phases 1–4 | Built-in Supabase connection; check that tests actually run |
| v0 | Phase 2 (screens) | Frontend only; bring the result into a full project for phase 3 |
