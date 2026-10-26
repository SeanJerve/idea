# Build-Your-Bowl Kiosk (idea)

An idea for a self-order touchscreen kiosk at a restaurant counter. Customers build their own bowl (base, protein, veggies, toppings, sauce) and see the price, calories, protein, carbs, fat and fiber update with every tap. Orders go to a kitchen screen, and staff manage the menu from an admin page.

There's no app code here yet. This folder holds the **prompt** that builds it.

## Files

- [`PROMPT.md`](PROMPT.md): the full build prompt. Fill in the "Make it yours" table, then paste everything from **START OF PROMPT** to the end into an AI coding tool (Claude Code, Cursor, Lovable, Bolt, v0) in an empty folder.

## What the prompt asks for

- **Kiosk** (customer touchscreen): attract screen, dine in / take out, signature bowls, a step-by-step builder with Light / Regular / Extra / Double portions, half & half bases, a "Your Bowl" panel with a bowl that fills up and live macro totals, goals (High protein, Under 600, Low carb, Custom) with one-tap swap suggestions, diet and allergen filters, review, checkout, order number.
- **Kitchen display**: realtime tickets in assembly-line order, allergy banners, timers, bump buttons.
- **Admin**: menu and nutrition editor, sold-out toggle, step rules, signature bowls, settings, simple reports.
- **Kiosk hardening**: idle reset, lockdown, hidden staff menu, works offline.
- **A seed menu** of 28 ingredients and 4 drinks, with nutrition per portion, plus exact nutrition math, rounding rules and acceptance tests with expected numbers, so the built app can be checked.

Suggested stack in the prompt: React + TypeScript + Vite + Tailwind, a PWA for the kiosk, and Supabase for the menu, orders and realtime kitchen updates. The prompt allows another stack if the builder explains why.

> The seed nutrition values are realistic estimates for development. Replace them with your own recipe-calculated or lab-tested values before using this with real customers.
