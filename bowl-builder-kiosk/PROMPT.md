# Build Prompt: Build-Your-Bowl Kiosk (v2)

This prompt builds a self-order touchscreen kiosk for a fast-casual bowl restaurant. Customers build their own bowl (base, protein, veggies, toppings, sauce) and see the price, calories and macros update with every tap. It also builds the kitchen screen, a pickup board and an admin panel.

v2 adds what we learned from studying Sweetgreen, CAVA, Chipotle, Toast, Square and kiosk research. See [`RESEARCH.md`](RESEARCH.md) for the findings and sources.

**How to use it:** fill in the "Make it yours" table (or keep the defaults), then paste everything from **START OF PROMPT** to the end into an AI coding tool (Claude Code, Cursor, Lovable, Bolt, v0, etc.) in an empty project folder. For big builds, run it in phases with [`PHASES.md`](PHASES.md).

**See it first:** [`prototype/index.html`](prototype/index.html) is a clickable prototype of the kiosk built from this spec (same menu, same math). If your tool accepts files, copy it into the project as `reference/prototype.html` so the builder can match its look.

---

## Make it yours

Change any value. The prompt works as is with the defaults.

| Setting | Default | Your value |
|---|---|---|
| Restaurant name | **Bowl Lab** | |
| Food style | Fresh build-your-own bowls: grains/greens, grilled proteins, veggies, sauces | |
| Brand feel | Fresh, warm, modern. Off-white background, deep green primary, warm orange accent | |
| Currency | USD ($) | |
| Sales tax | 8% (configurable) | |
| Languages | English and Spanish | |
| Kiosk hardware | 10–13" tablet in landscape, and a 22–32" portrait touchscreen | |
| Payment (v1) | "Pay at the counter" (card reader later) | |
| Tipping prompt | **Off** | |
| Local menu warnings | None (can turn on NYC-style sodium and added-sugar icons) | |
| Menu | The seed menu in section 8 | |

---

## START OF PROMPT

You are a senior full-stack engineer and product designer. Build a production-quality **self-order kiosk system for a fast-casual bowl restaurant** called **Bowl Lab**. Customers use a touchscreen next to the cashier to build a custom bowl step by step and see the **price, calories, protein, carbs, fat, fiber, sugar and sodium update live** as they add, remove or resize ingredients. Orders go to a kitchen display and a pickup board. Managers run everything from an admin panel.

Work autonomously. Don't stop to ask questions unless you are truly blocked. Make reasonable decisions and record each one in `ASSUMPTIONS.md`.

### 1. Product principles

1. **Fast for regulars, easy for first-timers.** A signature bowl can be ordered in **6 taps or fewer** from the attract screen. A first-time custom bowl takes **under 60 seconds** with no help. Ask for nothing that isn't needed to make the food. Dine-in or take-out and the name are asked at checkout, not before.
2. **Nutrition is always visible and always correct.** Every tap updates totals in under 100 ms, using the exact math in section 6. Calories appear next to **every** item, bowl and drink, as US menu-labeling rules require for kiosks.
3. **Neutral, never preachy.** Numbers are information, not judgement. No red "bad" colors on food, no words like "guilt", "cheat" or "junk". Going over a goal is shown in a neutral color.
4. **Trustworthy filters.** Customers with allergies or diets can filter the menu and rely on the result.
5. **Respectful selling.** At most **one** suggestion per order, relevant to the bowl and the customer's goal, skippable with one tap. **No tipping screen** by default. No pre-selected add-ons. No countdown pressure.
6. **Accessible to everyone,** including blind and low-vision customers and wheelchair users (section 12). Kiosk-only restaurants have been sued over this; build it in from day one.
7. **Staff stay in control.** Menu, prices, nutrition and sold-out items change without a developer. Kiosks keep working when the internet doesn't.

### 2. Surfaces (one codebase, one web app, separate routes)

| Surface | Route | Who | Device |
|---|---|---|---|
| **Kiosk** | `/` | Customers | Touchscreen tablet or monitor at the counter |
| **Kitchen Display (KDS)** | `/kitchen` | Line cooks | Screen above the assembly line; one per station |
| **Pickup board** | `/pickup` | Customers waiting | TV near the pickup shelf |
| **Admin** | `/admin` | Owner and managers | Laptop or phone |

Each route is code-split so the kiosk only downloads kiosk code.

### 3. Tech stack and architecture

Use this stack unless you have a strong reason to change it. If you change it, explain why in `ASSUMPTIONS.md`.

**3.1 Stack**
- **Frontend:** React + TypeScript (strict) + Vite, Tailwind CSS with design tokens (CSS variables) so branding is configurable, Zustand for builder and cart state, Framer Motion for small animations (respect `prefers-reduced-motion`), Zod for every data shape crossing a boundary.
- **App shell:** installable **PWA**. The service worker precaches the app, the published menu and all ingredient images.
- **Backend:** Supabase. Postgres for menu, orders, devices and events. Realtime for new orders, status changes, sold-out changes and menu publishes. Auth for staff. Storage for photos. Edge Functions for anything that must be trusted. Row Level Security on every table.
- **Tests:** Vitest (+ fast-check for property tests) for the core, Playwright for end-to-end at 1280×800 (landscape tablet) and 1080×1920 (portrait monitor), axe-core accessibility checks inside the Playwright tests.

**3.2 Repository layout**
```
src/
  core/        pure TypeScript: nutrition, pricing, validation, filters, goals, rounding (no React, no I/O)
  schema/      Zod schemas + TypeScript types for menu, bowl, order (shared by app and server)
  data/        seed menu
  features/    kiosk/, kitchen/, pickup/, admin/
  ui/          shared components and design tokens
  i18n/        en.json, es.json
supabase/
  migrations/  SQL schema, RLS policies, seed
  functions/   place-order, publish-menu, pair-device (import src/core and src/schema)
```

**3.3 Rules that keep it correct**
- **One source of truth for math.** All nutrition, price, validation and goal logic lives in `src/core/` as pure functions. UI components never compute totals.
- **Never trust the device for money or nutrition.** Kiosks send only the bowl contents (`ingredientId`, `portion`, `onSide`) plus an **idempotency key**. The `place-order` Edge Function re-validates the bowl and recomputes price and nutrition with the same `src/core/` code, then writes the order. Kiosks have no direct insert access to the orders table.
- **Published menu versions.** Admin edits a draft. "Publish" freezes it into an immutable `menu_versions` row (one JSON document). Kiosks load the latest published version and switch to a new one **between customers, never mid-order**. Orders store the `menuVersionId` and a snapshot of every line, so menu changes never alter past orders.
- **Sold-out is separate from the menu.** A small `availability` table updates instantly over Realtime. If an item in a customer's current bowl sells out, show a friendly notice on Review and offer the closest swap.
- **Devices are registered.** Each kiosk pairs once with a 6-digit code from Admin and gets a device token that can only read the published menu and call `place-order`. Each device sends a heartbeat every 30 seconds (app version, menu version, online state, last order time).
- **Offline is a designed state, not an error.** If the network drops, the customer can still build and finish. The order is saved in IndexedDB with its idempotency key and a temporary number from the kiosk's own range (e.g. `K2-07`). The confirmation says "Show this screen at the counter to pay". Queued orders sync automatically when back online, without duplicates.
- **Payments behind an interface.** `PaymentProvider` with `payAtCounter` in v1. Design it so a card reader (e.g. Stripe Terminal's server-driven API with a smart reader, or Square Terminal) plugs in later. Card payments need the network, so offline always falls back to pay at counter.
- **Ready for automation.** Each order line stores grams (`servingGrams × multiplier`), so the same data could later drive portion scales or an automated make-line.

**3.4 Performance budget** (target a low-cost Android tablet)
- Kiosk route under 300 KB of JavaScript (gzipped). Ingredient images WebP/AVIF, under 80 KB each, precached.
- Interaction to visual update under 100 ms. Animations at 60 fps, none over 300 ms.
- Cold start to attract screen under 3 seconds from cache.

### 4. Customer flow (Kiosk)

**4.1 Attract screen** (when idle)
- Full-screen food imagery or a slow animated bowl, restaurant name, big "Tap to order", language toggle (EN / ES), and a visible **accessibility button**.

**4.2 Start screen** (one screen, three fast paths)
- **Build your own bowl** (largest card).
- **Signature bowls** row: photo, name, price, calories, protein, and badges ("High protein", "Vegan", "Most popular"). Tapping one goes straight to Review with a "Customize" button.
- **Have a bowl code?** Enter a 6-character code from an earlier receipt to load that exact bowl again (section 4.7). No account, no personal data.
- Optional **goal chips** and **dietary filter chips** (section 5.4, 5.5). Never required.

**4.3 Bowl builder** (section 5)

**4.4 Review**
- Bowl summary grouped by step, with "Edit" per step that jumps back into the builder.
- Optional bowl name ("Monday lunch") and an allergy note for the kitchen.
- **Nutrition breakdown:** a table with one row per ingredient (portion, calories, protein, carbs, fat, fiber, sugar, sodium) and a totals row, styled like a nutrition facts panel. Bowl diet tags and allergens.
- **One suggestion card** (principle 5), chosen by simple rules: if a goal is active, the item that helps it most (e.g. "+ Soft-boiled egg: +6 g protein, $1.50"); otherwise a drink. One tap to add, one tap to dismiss. Never a pop-up.
- "Add another bowl", "Add a drink", "Add a protein cup".
- Cart with all items, subtotal, tax, total.

**4.5 Checkout** (a single screen)
- Dine in / Take out: two big buttons.
- First name: **optional**, on a large custom on-screen keyboard (letters, space, backspace, 20 characters max). Never use the device keyboard.
- Payment: v1 "Pay at the counter".
- "Place order" button shows the total on it ("Place order · $11.95").

**4.6 Confirmation**
- Huge order number (e.g. **A-042**), name if given, "Pay at the counter" or "We're making it now", and an estimated wait from current kitchen load.
- A **QR code** to a web receipt that shows the order, full nutrition, and the **bowl code**.
- Returns to the attract screen after 15 seconds or on "Done".

**4.7 Bowl codes**
- Every placed bowl gets a short code (6 characters from `ACDEFHJKMNPRTUVWXY34679`, no look-alike characters).
- The code maps to the bowl's lines on the server. Loading a code rebuilds the bowl from the **current** menu: unavailable or changed items are flagged and the customer picks replacements.

### 5. The bowl builder

**5.1 Layout**
- **Landscape:** step bar across the top (Base → Protein → Veggies → Toppings → Sauce → Review). Ingredient grid on the left ~65%. Persistent **"Your Bowl" panel** on the right ~35%.
- **Portrait:** step bar on top, grid in the middle, the Your Bowl panel as a bottom sheet. Collapsed, it always shows calories, protein, price and Next.
- Back and Next always in the same place. Next is disabled with a short reason ("Pick a base to continue") until the step's rules are met. Optional steps show **Skip** instead of Next until something is chosen.
- **Auto-advance** after the single-choice Protein step: show the selection for 400 ms, then move on. Multi-choice steps never auto-advance.
- Once Base and Protein are chosen, a **"Review bowl"** shortcut is always visible.

**5.2 Ingredient cards**
- Photo, name, **calories**, protein, price badge (only if it costs extra), allergen icons, diet tags, optional badge ("High protein", "Popular").
- Tap to add (checkmark and highlighted border). A selected card shows a **portion control**: segmented buttons Light / Regular / Extra (and Double for proteins), each with its calorie and price difference, e.g. `Double +190 cal · +$3.50`. A clear "Remove" (×) button.
- When a step is full, the card shakes gently and a message explains ("Up to 4 veggies. Remove one to swap.").
- Sold-out items stay visible, greyed out, labeled "Sold out", not tappable. They sort to the end of the grid.

**5.3 The "Your Bowl" panel**
- **A top-down bowl illustration that fills up** as ingredients are added, each drawn with its `color` as a segment or scatter. Under 300 ms per change.
- **Nutrition view toggle:** **Simple** (calories and protein, the default) or **Full** (calories, protein, carbs, fat, fiber, sugar, sodium with bars). Remember the choice for the rest of the session only.
- Numbers animate briefly to the new value. A **macro ring** shows the share of calories from protein, carbs and fat (protein × 4, carbs × 4, fat × 9, normalized to 100%).
- Bowl price, and the list of chosen ingredients with portions. Tapping one jumps to its step.
- When a goal is set, a progress bar toward it.

**5.4 Goals** (optional; never block ordering)

| Preset | Target |
|---|---|
| High protein | Protein ≥ 40 g |
| Lighter | Calories ≤ 450 |
| Under 600 | Calories ≤ 600 |
| Low carb | Carbs ≤ 30 g |
| Balanced | No target. Show the macro ring prominently |
| Custom | Calories, protein, carbs and/or fat targets set with +/- steppers (no typing) |

- With a goal active, every card shows how it would change the goal metric ("+35 g protein", "+195 cal").
- Status in the panel: "On track" or "80 cal over goal" (neutral color).
- **Suggestions** (rule-based, not AI): if the bowl misses the goal, offer up to 2 one-tap swaps, e.g. "Swap white rice for cauliflower rice: −155 cal" or "Make chicken Double: +35 g protein". Pick the swaps that move the goal metric most per change, only from available items that match active filters.

**5.5 Dietary filters and allergens**
- Diet tags: `vegan`, `vegetarian`, `gluten_free`, `dairy_free`. Anything vegan also counts as vegetarian.
- Allergens (US major 9): milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame.
- Items that don't match an active filter are **dimmed, not hidden**, with the reason ("Contains milk"). Tapping one asks "This contains milk. Add anyway?"
- A bowl's tags are derived (vegan only if every ingredient is vegan). A bowl's allergens are the union of its ingredients' allergens. Show both on Review, with the allergen disclaimer (6.6).

**5.6 Step rules** (all configurable in Admin; these are the defaults)

| Step | Required | Min | Max | Included free | Notes |
|---|---|---|---|---|---|
| Base | Yes | 1 | 2 | 2 | Picking 2 makes it **half & half**: each becomes a Half portion (0.5×) and the portion control is hidden |
| Protein | Yes | 1 | 1 | — | Sets the bowl price. "No protein (veggie bowl)" is valid. Portions: Light, Regular, Double (paid) |
| Veggies | No | 0 | 4 | 4 | Light / Regular / Extra, all free |
| Toppings | No | 0 | 5 | 2 standard | Each standard topping after the 2nd costs $0.75. **Premium** toppings always cost their own price and don't use up the free ones |
| Sauce | No | 0 | 2 | 2 | Light / Regular / Extra. **"On the side"** toggle per sauce (same nutrition, flagged for the kitchen) |

**5.7 Protein cups** (side item for smaller appetites and protein seekers)
- A single Regular portion of any protein in a cup, priced by `cupPriceCents` (section 8.2). Shows calories and protein like every other item.

### 6. Nutrition, pricing and labeling (must be exact)

**6.1 Portions.** Each ingredient stores nutrition for **one Regular portion**. A portion multiplies every nutrient:

| Portion | Multiplier |
|---|---|
| Light | 0.5 |
| Half (half & half bases only) | 0.5 |
| Regular | 1 |
| Extra | 1.5 |
| Double | 2 |

**6.2 Totals.** Bowl total = sum of (ingredient nutrition × portion multiplier) over every line. **Keep full precision while summing and round only for display.** Never round per ingredient and then add.

**6.3 Display rounding** (based on US FDA labeling rules). Use round-half-up.
- Calories: under 5 → `0`; 5 to 50 → nearest 5; over 50 → nearest 10.
- Protein, carbs, fat, fiber, sugar: under 0.5 g → `0 g`; otherwise nearest 1 g.
- Sodium: under 5 mg → `0 mg`; 5 to 140 mg → nearest 5; over 140 mg → nearest 10.
- Same rules for per-ingredient numbers on cards and in the Review table.

**6.4 Money.** All money in **integer cents**.
- Bowl price = the protein's bowl price + portion price deltas + paid extras (premium toppings, toppings beyond the free ones).
- Tax = subtotal × tax rate, rounded half-up to the cent, once per order.

**6.5 Local warning icons** (off by default; turned on per location in Admin)
- **High sodium icon** on any bowl or item with ≥ 2,300 mg sodium.
- **High added sugar icon** on any item with ≥ 50 g added sugar.
- The icon artwork and the exact statement text come from Admin settings, so a location can use whatever its city or state requires (e.g. New York City).

**6.6 Required on-screen text** (on Start, Review and the receipt)
- "2,000 calories a day is used for general nutrition advice, but calorie needs vary."
- "Additional nutrition information available upon request."
- "Nutrition values are estimates. Bowls are made by hand, so portions may vary."
- "Our kitchen handles all major allergens. We can't guarantee any item is free of allergens."

**6.7 Admin sanity check.** On save, compare stored calories to `4×protein + 4×carbs + 9×fat`. If they differ by more than 15% *and* more than 10 kcal, show a warning (don't block saving).

### 7. Data model (Zod schemas in `src/schema/`; mirror them in Postgres)

```ts
type StepId = 'base' | 'protein' | 'veggies' | 'toppings' | 'sauces';
type PortionLevel = 'light' | 'half' | 'regular' | 'extra' | 'double';
type Allergen = 'milk' | 'egg' | 'fish' | 'shellfish' | 'tree_nuts' | 'peanuts' | 'wheat' | 'soy' | 'sesame';
type DietTag = 'vegan' | 'vegetarian' | 'gluten_free' | 'dairy_free';
type Locale = 'en' | 'es';

interface Nutrition {        // for ONE Regular portion
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  addedSugarG: number;
  sodiumMg: number;
}

interface PortionOption { level: PortionLevel; priceDeltaCents: number; }

interface Ingredient {
  id: string;                // stable slug, e.g. 'grilled-chicken'
  stepId: StepId;
  name: Record<Locale, string>;
  description?: Record<Locale, string>;
  imageUrl: string;
  servingGrams: number;      // grams in a Regular portion
  nutrition: Nutrition;
  allergens: Allergen[];
  dietTags: DietTag[];
  portions: PortionOption[]; // portion levels this item allows
  bowlPriceCents?: number;   // proteins only: sets the bowl price
  cupPriceCents?: number;    // proteins only: protein cup price
  priceCents: number;        // add-on price; 0 when included
  premium: boolean;          // premium toppings always charge priceCents
  badges: ('high_protein' | 'popular' | 'new' | 'spicy')[];
  sortOrder: number;
  color: string;             // used to draw it in the bowl illustration
}

interface Availability { ingredientId: string; locationId: string; available: boolean; updatedAt: string; }

interface StepConfig {
  id: StepId;
  title: Record<Locale, string>;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  includedSelections: number;
  extraSelectionPriceCents: number;
  halfAndHalf?: boolean;     // base step only
}

interface MenuVersion {      // immutable once published
  id: string;
  publishedAt: string;
  ingredients: Ingredient[];
  steps: StepConfig[];
  signatureBowls: SignatureBowl[];
  drinks: Drink[];
}

interface BowlLine { ingredientId: string; portion: PortionLevel; onSide?: boolean; }
interface Bowl { id: string; name?: string; lines: BowlLine[]; signatureId?: string; }

type OrderStatus = 'new' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled';

interface Order {
  id: string;
  idempotencyKey: string;    // generated on the kiosk; the server ignores repeats
  number: string;            // 'A-042' from the server; 'K2-07' if created offline
  createdAt: string;
  locationId: string;
  deviceId: string;
  channel: 'kiosk';          // later: 'phone', 'staff'
  menuVersionId: string;
  diningOption: 'dine_in' | 'take_out';
  customerName?: string;
  allergyNote?: string;
  bowls: OrderedBowl[];      // snapshots: name, portion, grams, price, nutrition per line, plus bowlCode
  sides: OrderedSide[];      // drinks and protein cups
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: OrderStatus;
  paymentStatus: 'pay_at_counter' | 'paid';
  createdOffline: boolean;
}
```

Other tables: `locations`, `devices` (pairing, token hash, heartbeat fields), `bowl_codes` (code → lines, created_at), `kiosk_events` (section 13), `settings` (per location).

Core functions in `src/core/` (pure, fully unit tested):
`bowlNutrition`, `bowlPrice`, `validateStep`, `validateBowl`, `bowlDietTags`, `bowlAllergens`, `goalStatus`, `goalSuggestions`, `reviewSuggestion`, `warningIcons`, `roundCalories`, `roundGrams`, `roundSodium`, `orderTotals`, `makeBowlCode`.

### 8. Seed menu

Put the seed data in `src/data/seed-menu.ts` and `supabase/migrations/seed.sql`. Values are for **one Regular portion**. They are realistic estimates for development. Add a comment at the top of the file saying the restaurant must replace them with its own recipe-calculated or lab-tested values before launch.

Columns: g = grams, Cal = calories, P = protein g, C = carbs g, F = fat g, Fib = fiber g, Sug = sugar g, Na = sodium mg. Added sugar is 0 g for every item except **teriyaki 8 g**, **pickled red onion 2 g** and **lemonade 30 g**. GF = gluten_free, DF = dairy_free. Write Spanish names for every item.

**8.1 Bases** (included; portions Light, Regular, Extra; half & half allowed)

| id | Name | g | Cal | P | C | F | Fib | Sug | Na | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| white-rice | Jasmine White Rice | 150 | 195 | 4 | 42 | 0.5 | 0.6 | 0 | 300 | vegan, GF, DF | — |
| brown-rice | Brown Rice | 150 | 170 | 4 | 35 | 1.5 | 2.7 | 0.5 | 300 | vegan, GF, DF | — |
| quinoa | Quinoa | 150 | 180 | 6.5 | 32 | 3 | 4 | 1 | 250 | vegan, GF, DF | — |
| greens | Mixed Greens | 75 | 15 | 1 | 3 | 0 | 1.5 | 1 | 25 | vegan, GF, DF | — |
| cauli-rice | Cauliflower Rice | 150 | 40 | 3 | 7 | 0.5 | 3 | 2 | 200 | vegan, GF, DF | — |

**8.2 Proteins** (portions Light, Regular, Double; the bowl price comes from here)

| id | Name | g | Cal | P | C | F | Fib | Sug | Na | Bowl | Double | Cup | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| grilled-chicken | Grilled Chicken | 113 | 190 | 35 | 0 | 4.5 | 0 | 0 | 380 | $11.95 | +$3.50 | $4.95 | GF, DF | — |
| grilled-steak | Grilled Steak | 113 | 230 | 32 | 0 | 11 | 0 | 0 | 400 | $13.95 | +$4.50 | $5.95 | GF, DF | — |
| roasted-salmon | Roasted Salmon | 113 | 235 | 25 | 0 | 15 | 0 | 0 | 300 | $14.45 | +$4.95 | $6.45 | GF, DF | fish |
| garlic-shrimp | Garlic Shrimp | 113 | 135 | 26 | 1 | 3 | 0 | 0 | 450 | $13.45 | +$4.25 | $5.95 | GF, DF | shellfish |
| baked-tofu | Baked Tofu | 113 | 170 | 18 | 4 | 10 | 1 | 1 | 350 | $10.95 | +$2.50 | $4.25 | vegan, GF, DF | soy |
| no-protein | No Protein (Veggie Bowl) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | $9.95 | — | — | vegan, GF, DF | — |

**8.3 Veggies** (included, up to 4; portions Light, Regular, Extra)

| id | Name | g | Cal | P | C | F | Fib | Sug | Na | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| roasted-broccoli | Roasted Broccoli | 60 | 40 | 2 | 4 | 2 | 1.5 | 1 | 120 | vegan, GF, DF | — |
| charred-corn | Charred Corn | 50 | 50 | 1.5 | 10 | 0.5 | 1 | 3 | 120 | vegan, GF, DF | — |
| black-beans | Black Beans | 60 | 80 | 5 | 14 | 0.5 | 5 | 0.5 | 200 | vegan, GF, DF | — |
| cucumber | Cucumber | 50 | 10 | 0.5 | 2 | 0 | 0.5 | 1 | 0 | vegan, GF, DF | — |
| edamame | Edamame | 50 | 60 | 5.5 | 4.5 | 2.5 | 2.5 | 1 | 150 | vegan, GF, DF | soy |
| pickled-onion | Pickled Red Onion | 20 | 10 | 0 | 2.5 | 0 | 0.3 | 2.5 | 120 | vegan, GF, DF | — |
| cherry-tomatoes | Cherry Tomatoes | 50 | 10 | 0.5 | 2 | 0 | 0.6 | 1.5 | 5 | vegan, GF, DF | — |

**8.4 Toppings** (up to 5; 2 standard free, then $0.75 each; premium always charged; portions Light, Regular, Extra)

| id | Name | g | Cal | P | C | F | Fib | Sug | Na | Price | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| avocado | Avocado | 50 | 80 | 1 | 4.5 | 7.5 | 3.5 | 0 | 5 | **Premium $2.25** | vegan, GF, DF | — |
| soft-egg | Soft-Boiled Egg | 50 | 75 | 6.5 | 0.5 | 5 | 0 | 0 | 70 | **Premium $1.50** | vegetarian, GF, DF | egg |
| feta | Feta | 28 | 75 | 4 | 1 | 6 | 0 | 1 | 320 | standard | vegetarian, GF | milk |
| sesame-seeds | Toasted Sesame Seeds | 9 | 50 | 1.5 | 2 | 4.5 | 1 | 0 | 0 | standard | vegan, GF, DF | sesame |
| crispy-shallots | Crispy Shallots | 15 | 80 | 1 | 6 | 6 | 0.5 | 2 | 150 | standard | vegan, DF | wheat |

**8.5 Sauces** (included, up to 2; 30 g Regular; portions Light, Regular, Extra; "on the side" toggle)

| id | Name | g | Cal | P | C | F | Fib | Sug | Na | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| lemon-tahini | Lemon Tahini | 30 | 90 | 2.5 | 3.5 | 8 | 1 | 1 | 150 | vegan, GF, DF | sesame |
| spicy-mayo | Spicy Mayo | 30 | 160 | 0 | 1 | 17 | 0 | 1 | 250 | vegetarian, GF, DF | egg |
| teriyaki | Teriyaki | 30 | 50 | 1 | 11 | 0 | 0 | 9 | 700 | vegan, DF | soy, wheat |
| salsa-verde | Salsa Verde | 30 | 10 | 0 | 2 | 0 | 0.5 | 1 | 250 | vegan, GF, DF | — |
| yogurt-herb | Greek Yogurt Herb | 30 | 35 | 2.5 | 1.5 | 2 | 0 | 1.5 | 120 | vegetarian, GF | milk |

**8.6 Signature bowls** (prices and nutrition are calculated by the core, never hard-coded)

| Name | Lines | Badges |
|---|---|---|
| Protein Power | quinoa, grilled-chicken (Double), roasted-broccoli, edamame, soft-egg, yogurt-herb | High protein |
| Green Machine | greens, baked-tofu, cucumber, edamame, avocado, lemon-tahini | Vegan |
| Steakhouse | brown-rice, grilled-steak, charred-corn, pickled-onion, feta, salsa-verde | Popular |
| Teriyaki Salmon | white-rice, roasted-salmon, edamame, cucumber, sesame-seeds, teriyaki | — |
| Lean & Light | cauli-rice, garlic-shrimp, cucumber, cherry-tomatoes, salsa-verde | — |

**8.7 Drinks**

| Name | Price | Cal | C | Sug | Na |
|---|---|---|---|---|---|
| Still Water | $2.00 | 0 | 0 | 0 | 0 |
| Sparkling Water | $2.50 | 0 | 0 | 0 | 0 |
| Iced Green Tea (unsweetened) | $3.25 | 0 | 0 | 0 | 0 |
| Lemonade | $3.50 | 120 | 31 | 30 | 10 |

### 9. Kitchen Display and Pickup board

**9.1 Kitchen Display (`/kitchen`)**
- New orders appear instantly (Realtime) as ticket cards in arrival order, with a soft chime.
- Each bowl is listed **in assembly-line order** (base → protein → veggies → toppings → sauces), with non-Regular portions in bold with grams (**DOUBLE** steak · 226 g, **LIGHT** rice · 75 g) and **ON THE SIDE** for sauces.
- A red **ALLERGY** banner on any ticket with an allergy note.
- A timer on each ticket: neutral under 5 minutes, amber at 5–8, red after 8 (thresholds in Admin).
- Tap to move a ticket: New → In progress → Ready. "Recall" brings back the last bumped ticket.
- **Station views** (chosen per screen in its settings): **Line** shows full tickets; **Grill** shows only proteins, plus an "all-day" count of each protein needed for open orders ("Chicken ×6, Steak ×2") so cooks can fire ahead.
- Big fonts readable from 2 meters, dark theme, works without a mouse or keyboard.

**9.2 Pickup board (`/pickup`)**
- Two columns: **Preparing** and **Ready**, showing order numbers and first names (if given). Ready orders get a gentle highlight and drop off 5 minutes after they're marked Picked up.
- Optional spoken announcement "Order A-042 is ready" (off by default).

### 10. Admin (`/admin`)

- Staff sign in (Supabase Auth) with roles: **owner** (everything) and **manager** (menu availability, orders, devices). Kiosks never get admin access.
- **Menu editor (draft):** create, edit, reorder, delete ingredients with every field from section 7, including photo upload and both languages. Live calorie sanity warning (6.7). A preview pane shows the item card exactly as the kiosk will.
- **Publish:** shows a diff of the draft against the live menu ("Price of steak bowl $13.95 → $14.45"), then publishes a new menu version. One-click rollback to any earlier version.
- **Sold-out toggle:** one tap per item. Kiosks update within 2 seconds.
- **Step rules**, **signature bowls** (with live price and nutrition preview), **drinks**.
- **Portion spec sheets:** a printable page per ingredient listing grams for each portion level and the scoop or ladle to use, so the line portions match the nutrition the kiosk shows.
- **Devices:** pair a new kiosk (6-digit code), see each device's status from its heartbeat (online, app version, menu version, last order), remotely reload or unpair.
- **Settings:** tax rate, restaurant name, logo, brand colors (design tokens), idle timeout, order number prefix, staff PIN for the hidden kiosk menu, KDS timer thresholds, warning icons (6.5), tipping (off; see 12.4).
- **Reports:** orders and revenue per day and hour, average ticket, top 10 ingredients, average calories and protein per bowl, goal and filter usage, and the **ordering funnel** (section 13).

### 11. Kiosk hardening

- **Idle reset:** after 60 seconds without a touch, show "Still there?" with a 15-second countdown and a big "I'm still here" button, then clear everything and return to the attract screen. Also reset after each completed order. Switch to a newly published menu at this moment.
- **Lockdown:** full screen; disable pinch zoom, double-tap zoom, text selection, long-press menus, pull-to-refresh and swipe-back.
- **Hidden staff menu:** 5 taps on the top-left corner within 3 seconds, then the staff PIN. It allows: reload, toggle sold-out items, view device ID and connection status, exit full screen.
- **Offline** as described in 3.3. Show a small offline badge for staff, not an error for customers.
- **Crash recovery:** an error boundary shows "Something went wrong, tap to start over" and reports the error. Never a blank screen. Reload automatically if the app has been open for 24 hours, at the next idle reset.
- Write `KIOSK_SETUP.md`: running full screen on an iPad (Guided Access, or Single App Mode via MDM), an Android tablet (a kiosk browser or the device's dedicated-device/lock-task mode, ideally managed by an MDM), and Windows (Chrome `--kiosk`); screen brightness and sleep settings; mounting height so every control sits **between 15 and 48 inches (38–122 cm) above the floor**; connecting a USB or Bluetooth keypad and headphones for accessibility (12.2).

### 12. Design and accessibility

**12.0 Visual design system** (if `reference/prototype.html` exists, match it; branding from Admin overrides these tokens)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#EEF2EA` | `#0E1611` | Page background (a green-tinted paper, not plain white or cream) |
| `surface` / `surface-2` | `#FFFFFF` / `#E1E8DB` | `#16211A` / `#1E2B23` | Cards, panels / chips, tracks, image wells |
| `ink` / `muted` / `line` | `#142019` / `#56665B` / `#CBD5C4` | `#E6EEE6` / `#9DB0A3` / `#2C3D32` | Text, secondary text, hairline borders |
| `primary` (basil) | `#1D5A3C` | `#63C08C` | Main buttons, selected state, progress |
| `accent` (chili) | `#E0662A` | `#F28A55` | Prices and badges only. Never for errors or "bad" food |
| `protein` / `carbs` / `fat` / `fiber` | `#2F66C9` / `#C98A12` / `#B9476F` / `#3A8B57` | `#7FA6F0` / `#E7B54A` / `#E07FA1` / `#6CC48D` | Macro colors. The same color for a macro everywhere (text, bars, ring) so customers learn them |

- **Type:** Bricolage Grotesque (headings and the big calorie number), Manrope (everything else), with a system sans-serif fallback. Tabular numbers on every figure so totals don't jitter.
- **Shape:** 18 px radius on cards, pill-shaped buttons and chips, 1 px hairline borders, shadow only on selected cards and floating panels.
- **Selected state:** 2 px primary border **plus** a checkmark badge (never color alone).
- **Ingredient art:** until real photos exist, draw each ingredient as a top-down cluster of shapes in its `color` inside a small dish. The bowl illustration uses the same art, so a card and its bowl contribution look the same.
- **Themes:** the kiosk defaults to light (bright dining rooms); the kitchen display defaults to dark.

**Landscape builder layout** (1280×800):
```
+--------------------------------------------------------------------------------+
| Bowl Lab   (v Base)(v Protein)(3 Veggies)(4 Toppings)(5 Sauce)(6 Review)  [Accessibility] |
+--------------------------------------------------+-----------------------------+
| Add veggies                       [HIGH PROTEIN] | Your bowl                   |
| Up to 4, all included.                           |      (top-down bowl art)    |
| +----------+ +----------+ +----------+ +-------+ | 390 cal      [Simple|Full]  |
| | dish art | | dish art | | dish art | | ...   | | 27 g protein                |
| | Broccoli | | Corn     | | Beans    | |       | | ring + protein/carbs/fat/   |
| | 40 cal   | | 50 cal   | | 80 cal   | |       | |   fiber bars (% Daily Value)|
| | [L][R][X]| | +2 g pro | | +5 g pro | |       | | Goal: 13 g to go            |
| +----------+ +----------+ +----------+ +-------+ |  [Make tofu Double +18 g]   |
|  (grid scrolls; page and panel never move)       | Bowl $10.95                 |
| [Back]                                           | [Review bowl]  [Next: Top.] |
+--------------------------------------------------+-----------------------------+
```

**12.1 Visual and touch**
- Touch targets at least **64 × 64 px** with at least 12 px between them. No hover-only interactions.
- Body text at least 20 px on the kiosk. Calorie and price numbers large and bold.
- WCAG 2.2 AA contrast. Never use color alone to show state (add icons or text).
- Language switch on every screen without losing the cart. All copy in `src/i18n/`.
- Illustrated placeholders per ingredient (colored shapes from `Ingredient.color`) so the app looks finished before real photos exist.
- Feel: fast, calm, friendly. Animations under 300 ms. No pop-ups except confirmations.

**12.2 Accessibility mode** (button on every screen)
- **Reach mode:** moves all controls into the lower half of the screen for wheelchair users.
- **Larger text** (+25%) and **high contrast**.
- **Audio mode:** the kiosk reads everything aloud with the browser's speech synthesis (Web Speech API): screen titles, the focused item, its price and calories, totals, errors. Turn it on from the accessibility button, or automatically when a key is pressed on a connected keypad.
- **Fully keyboard and keypad operable:** every action works with arrow keys, Tab, Enter and Escape (a standard USB or Bluetooth keypad sends these). Visible focus ring. Logical focus order. `aria-live` announcements for total changes.
- Every interactive element has an accessible label. The whole flow works with a screen reader.

**12.3 Content**
- Plain, short words. Buttons say what happens ("Add to bowl", "Place order · $11.95").
- Errors explain how to fix the problem.

**12.4 Tipping**
- Off by default. If an owner turns it on in Admin: one screen, "No tip" shown first and as prominent as the amounts, nothing pre-selected, and the price never changes based on the choice.

### 13. Analytics and privacy

- Log anonymous **kiosk events** to `kiosk_events`: session start, step viewed, item added or removed, goal or filter set, suggestion shown/accepted/dismissed, review reached, order placed, session abandoned (with the last step), idle reset. A session is a random ID that ends at reset.
- Admin funnel: start → each step → review → placed, with drop-off per step, median time to order, most-removed items, and suggestion acceptance rate.
- **No personal data on the kiosk:** no cameras, no face or voice capture, no phone numbers or emails. First names and allergy notes are deleted from orders after 30 days.

### 14. Out of scope for v1 (leave clean extension points)

Card payments (behind `PaymentProvider`), loyalty accounts, phone ordering by QR code (`channel: 'phone'`), staff-assisted ordering on a handheld (`channel: 'staff'`), delivery apps, receipt printers, multi-location management (but keep `locationId` everywhere), AI or voice ordering, a recipe nutrition calculator in Admin (e.g. using USDA FoodData Central).

### 15. Build order

Finish each milestone fully (running app, tests passing) before starting the next. After each one, update `README.md` with how to run it and what's done.

1. **Core and schema:** Zod schemas, seed menu, every `src/core/` function, unit and property tests (section 16).
2. **Kiosk on local data:** every screen in sections 4 and 5, both layouts, filters, goals, suggestions, bowl codes (local), idle reset. No backend yet.
3. **Backend, kitchen and pickup:** Supabase schema, RLS, seed, device pairing, `place-order` with server-side recomputation and idempotency, menu versions, availability over Realtime, KDS with stations, pickup board, offline queue.
4. **Admin:** everything in section 10.
5. **Accessibility and polish:** accessibility mode (12.2), Spanish, PWA precaching, lockdown, analytics (13), performance budget (3.4), `KIOSK_SETUP.md`, full Playwright and axe suites at both screen sizes.

### 16. Acceptance tests (must pass)

**Unit tests** using the seed menu:

**Bowl A:** quinoa, grilled-chicken, roasted-broccoli, cucumber, feta, yogurt-herb (all Regular).
- Raw: 530 cal, 50.5 g protein, 40.5 g carbs, 17.5 g fat, 6 g fiber, 5.5 g sugar, 1,190 mg sodium.
- Displayed: **530 cal, 51 g protein, 41 g carbs, 18 g fat, 6 g fiber, 6 g sugar, 1,190 mg sodium**.
- Price **$11.95** (feta is 1 of 2 free standard toppings). Not vegetarian, gluten-free, not dairy-free. Allergens: **milk**.

**Bowl B:** half & half white-rice + greens, grilled-steak (Double), black-beans (Extra), spicy-mayo (Light).
- Raw: 765 cal, 74 g protein, 44 g carbs, 31.5 g fat, 8.55 g fiber, 1.75 g sugar, 1,387.5 mg sodium.
- Displayed: **770 cal, 74 g protein, 44 g carbs, 32 g fat, 9 g fiber, 2 g sugar, 1,390 mg sodium**.
- Price **$18.45** ($13.95 + $4.50 double steak; extra beans and light mayo are free). Allergens: **egg**.

**Bowl C (pricing):** brown-rice, grilled-chicken, avocado, soft-egg, feta, sesame-seeds, crispy-shallots.
- Price **$16.45** ($11.95 + $2.25 avocado + $1.50 egg + $0.75 for the 3rd standard topping).

**Rounding:** `roundCalories(3) = 0`, `roundCalories(47) = 45`, `roundCalories(48) = 50`, `roundCalories(765) = 770`, `roundGrams(0.4) = 0`, `roundGrams(0.5) = 1`, `roundSodium(3) = 0`, `roundSodium(137) = 135`, `roundSodium(1387.5) = 1390`.

**Validation:** can't leave Base with 0 items; a 3rd base is refused; a 5th veggie is refused; a 6th topping is refused; Protein requires exactly 1 choice.

**Order totals:** at 8% tax, Bowl A + Bowl B = subtotal $30.40, tax $2.43, total $32.83.

**Warning icons:** with warnings on, white-rice + garlic-shrimp (Double) + feta (Extra) + teriyaki (Extra) = 2,730 mg sodium and gets the sodium icon; Bowl A and Bowl B don't; Lemonade doesn't get the added-sugar icon (30 g < 50 g).

**Property tests** (fast-check): totals don't depend on line order; adding any line never lowers calories; price is never negative; displayed values always follow 6.3.

**Server tests:** `place-order` rejects a bowl that breaks step rules, ignores a client-sent price, and returns the same order for a repeated idempotency key.

**End-to-end** (Playwright, both screen sizes, axe checks on every screen):
1. Build Bowl A, see 530 cal / 51 g protein / $11.95 in the panel, place the order, get an order number, see the ticket on `/kitchen` and the number under Preparing on `/pickup`.
2. Order the "Protein Power" signature bowl in 6 taps or fewer from the attract screen.
3. Pick "High protein", start from a low-protein bowl, accept a suggestion, see "On track".
4. Turn on Vegan: chicken, feta and egg are dimmed with a reason; Green Machine shows as vegan.
5. Mark avocado sold out in Admin: within 2 seconds it's greyed out on the kiosk.
6. Go offline, place an order, see a `K`-number and "Show this screen at the counter"; go online and see exactly one matching order on `/kitchen`.
7. Load a bowl code from test 1 and get the same bowl back.
8. Complete a whole order using only the keyboard (arrow keys, Tab, Enter), with audio mode on.
9. Leave the kiosk idle: "Still there?" at 60 s, cart cleared at 75 s.

### 17. What to hand back

- A working repo with `README.md` (setup, env vars, how to run each surface, how to seed and pair a device), `ASSUMPTIONS.md`, `KIOSK_SETUP.md`.
- All tests passing, with the commands to run them.
- A short summary of what's built, what's not, and suggested next steps.

## END OF PROMPT
