# Build-Your-Bowl Kiosk (idea)

An idea for a self-order touchscreen kiosk at a restaurant counter. Customers build their own bowl (base, protein, veggies, toppings, sauce) and see the price, calories, protein, carbs, fat, fiber, sugar and sodium update with every tap. Orders go to a kitchen screen, and staff manage the menu from an admin page.

There's no production app here yet. This folder holds the **prompt** that builds it, the research behind it, and a clickable prototype.

## Files

- [`PROMPT.md`](PROMPT.md): the full build prompt (v2). Fill in the "Make it yours" table, then paste everything from **START OF PROMPT** to the end into an AI coding tool (Claude Code, Cursor, Lovable, Bolt, v0) in an empty folder.
- [`PHASES.md`](PHASES.md): the same build split into 5 messages, one per milestone, with what to check after each and which AI tools fit each phase.
- [`prototype/index.html`](prototype/index.html): a clickable prototype of the kiosk (one HTML file, no install). Open it in a browser. It uses the prompt's seed menu and math, so its numbers match the acceptance tests.
- [`RESEARCH.md`](RESEARCH.md): what Sweetgreen, CAVA, Chipotle, Toast, Square and others already do, kiosk design and accessibility findings, labeling laws, trends, what changed in v2 and why, ideas for later, risks, and sources.

## What the prompt asks for

- **Kiosk** (customer touchscreen): signature bowls in 6 taps or fewer, a step-by-step builder with Light / Regular / Extra / Double portions and half & half bases, a "Your Bowl" panel with a bowl that fills up and live nutrition (simple or full view), goals (High protein, Lighter, Under 600, Low carb, Custom) with one-tap swaps, diet and allergen filters, protein cups, bowl codes to reorder, single-screen checkout, no tipping prompt.
- **Accessibility mode**: reach mode, larger text, high contrast, audio mode that reads everything aloud, full keypad/keyboard control.
- **Kitchen display**: realtime tickets in assembly-line order with grams, allergy banners, timers, grill and line station views.
- **Pickup board**: Preparing and Ready columns.
- **Admin**: menu editor with publish, diff and rollback, sold-out toggle, portion spec sheets, device pairing and status, settings, reports and an ordering funnel.
- **Architecture**: the server recalculates every price and nutrition total, orders can't duplicate, the kiosk keeps working offline, menu versions switch only between customers.
- **A seed menu** of 28 ingredients and 4 drinks with calories, protein, carbs, fat, fiber, sugar and sodium, plus exact math, rounding rules and acceptance tests with expected numbers.

Suggested stack in the prompt: React + TypeScript + Vite + Tailwind, a PWA for the kiosk, and Supabase for the menu, orders and realtime kitchen updates. The prompt allows another stack if the builder explains why.

> The seed nutrition values are realistic estimates for development. Replace them with your own recipe-calculated or lab-tested values before using this with real customers.
