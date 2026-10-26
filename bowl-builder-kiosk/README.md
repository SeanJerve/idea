# Build-Your-Bowl Kiosk (idea)

An idea for a self-order touchscreen kiosk at a restaurant counter. Customers build their own bowl (base, protein, veggies, toppings, sauce) and see the price, calories, protein, carbs, fat, fiber, sugar and sodium update with every tap. Orders go to a kitchen screen and a pickup board, and owners run everything from an admin back office.

This folder holds a complete, research-backed build spec (v3) plus the parts a senior team would hand an engineer on day one: tested database, design tokens, canonical data and a clickable prototype.

## Files

| Path | What it is |
|---|---|
| [`PROMPT.md`](PROMPT.md) | The build spec (v3). Fill in "Make it yours", then give it to an AI coding tool |
| [`PHASES.md`](PHASES.md) | The build as 8 messages, one per milestone, with checks after each |
| [`RESEARCH.md`](RESEARCH.md) | Competitors, kiosk UX, accessibility law, labeling rules, trends, modern design and engineering findings, with sources |
| [`prototype/index.html`](prototype/index.html) | Clickable kiosk prototype (one HTML file). Same menu and math as the spec |
| [`data/seed-menu.json`](data/seed-menu.json) | Canonical seed menu (28 ingredients, protein cups, drinks, signature bowls), validated by [`seed-menu.schema.json`](data/seed-menu.schema.json) |
| [`design/`](design/) | Design tokens in W3C format (OKLCH, light and dark) and generated `tokens.css`. `generate-tokens.mjs` rebuilds them and checks WCAG contrast |
| [`database/`](database/) | PostgreSQL / Supabase schema with Row Level Security, RPCs, seed generator and 60 passing tests. See [`database/README.md`](database/README.md) |

## What the spec covers

- **Kiosk:**
  - Fast paths: a signature bowl in 6 taps or fewer, bowl codes to reorder.
  - Step-by-step builder with portions, half & half, on-the-side, and a bowl illustration that fills up.
  - Live nutrition, simple or full.
  - Goals with explainable swap suggestions, diet and allergen filters.
  - Group orders with name labels, undo, single-screen checkout, no tipping prompt.
- **Accessibility:** reach mode, larger text, high contrast, read-aloud, keypad control, extra time. Built to WCAG 2.2 AA, ADA reach ranges and the EU Accessibility Act.
- **Kitchen and pickup:**
  - Kitchen screens by station with bump-bar keys and live counts of proteins needed.
  - A pickup board that shows only first name and initial.
  - Label printing, designed in for later.
- **Admin:**
  - Menu editor with live preview, publishing with validation, diff, staged rollout and rollback.
  - Sold-out toggles and countdown stock, device fleet, orders, roles, audit log.
  - Reports: ordering funnel and a menu engineering matrix.
- **Design system:** OKLCH tokens, type scale, motion rules, a component inventory with states, layouts for each screen size, content and localization rules.
- **Architecture:**
  - Monorepo with a shared core (React 19, TanStack, XState, React Aria, Tailwind v4).
  - Supabase with a versioned API.
  - Every price and nutrition total recalculated on the server; orders can't be duplicated; offline outbox; realtime updates for each location.
- **Regions:** US, Canada, EU, UK and Philippines presets (currency, tax added or included, kJ, allergen lists, languages).
- **Operations:** threat model, privacy rules, service targets, alerts, runbooks, load/soak/chaos tests, CI gates, roadmap for card payments, phone ordering, POS, AI ordering and an AI-agent-ready API.

> The seed nutrition values are realistic estimates for development. Replace them with your own recipe-calculated or lab-tested values before using this with real customers.

## Check it yourself

```bash
node design/generate-tokens.mjs        # regenerates tokens, fails if any color pair misses WCAG AA
node database/generate-seed.mjs        # rebuilds database/seed.sql from data/seed-menu.json
database/tests/run-local.sh            # 60 database tests (needs PostgreSQL 15+)
```
