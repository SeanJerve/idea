# Build Prompt: Build-Your-Bowl Kiosk

This prompt builds a self-order touchscreen kiosk for a fast-casual bowl restaurant. Customers build their own bowl (base, protein, veggies, toppings, sauce) and see calories, protein, carbs, fat and fiber update with every tap.

**How to use it:** fill in the "Make it yours" table (or keep the defaults), then paste everything from **START OF PROMPT** to the end into an AI coding tool (Claude Code, Cursor, Lovable, Bolt, v0, etc.) in an empty project folder.

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
| Payment (v1) | "Pay at the counter" (no card processing yet) | |
| Menu | The seed menu in section 8 | |

---

## START OF PROMPT

You are a senior full-stack engineer and product designer. Build a production-quality **self-order kiosk app for a fast-casual bowl restaurant** called **Bowl Lab**. It runs on a touchscreen tablet or monitor next to the cashier. Customers build a custom bowl step by step and see the **price, calories and macros (protein, carbs, fat, fiber) update live** as they add, remove or resize ingredients. Finished orders go to a kitchen screen.

Work autonomously. Don't stop to ask questions unless you are truly blocked. Make reasonable decisions and record each one in `ASSUMPTIONS.md`.

### 1. Product goals

1. A first-time customer can build and place a custom bowl in **under 60 seconds** with no help.
2. Nutrition is **always visible and always correct**: every tap updates the totals immediately (under 100 ms), using the exact math in section 6.
3. Customers with dietary needs or allergies can **filter** the menu and trust the result.
4. Staff can change the menu, prices, nutrition and sold-out items **without a developer**.
5. It works as a locked-down kiosk: no way to leave the app, it resets itself between customers, and it survives a flaky network.

### 2. The three apps (one codebase)

| App | Route | Who | Device |
|---|---|---|---|
| **Kiosk** | `/` | Customers | Touchscreen tablet or monitor at the counter |
| **Kitchen Display (KDS)** | `/kitchen` | Line cooks | A screen above the assembly line |
| **Admin** | `/admin` | Owner and managers | Any laptop or phone, PIN or password protected |

### 3. Tech stack

Use this stack unless you have a strong reason to change it. If you change it, explain why in `ASSUMPTIONS.md`.

- **Frontend:** React + TypeScript (strict) + Vite, Tailwind CSS, Zustand for the cart and builder state, Framer Motion for small animations (respect `prefers-reduced-motion`).
- **App shell:** installable **PWA** with a service worker that caches the app and the menu, so the kiosk keeps working if Wi-Fi drops.
- **Backend (from milestone 3):** Supabase: Postgres for menu and orders, Realtime for pushing new orders to the kitchen and sold-out changes to kiosks, Auth for admin, Storage for ingredient photos, Row Level Security on every table. Kiosks can only read the menu and insert orders. Only authenticated staff can change the menu or order status.
- **Tests:** Vitest for the core engine, Playwright for end-to-end flows at 1280×800 (landscape tablet) and 1080×1920 (portrait monitor).
- **Architecture rule:** all business logic (nutrition math, pricing, validation, filters) lives in a framework-free `src/core/` module made of pure functions. UI components never compute totals themselves; they call the core.

### 4. Customer flow (Kiosk)

**4.1 Attract screen** (shown when idle)
- Full-screen looping food imagery or a slow animated bowl, restaurant name, big "Tap anywhere to start", language toggle (EN / ES).

**4.2 Dine in or take out**
- Two huge buttons. Saved on the order.

**4.3 Menu home**
- One big card: **Build your own bowl**.
- A row of **Signature bowls** (section 8.6). Each card shows a photo, name, price, calories and protein. Tapping one opens the builder pre-filled, so the customer can still change anything.
- **Goal chips** (optional, can skip): High protein, Under 600 calories, Low carb, Balanced, Custom (section 5.4).
- **Dietary filter chips**: Vegan, Vegetarian, Gluten-free, Dairy-free, plus an "Allergies" button that opens a sheet with the 9 major allergens (section 5.5).

**4.4 Bowl builder** (the core screen; see section 5)

**4.5 Review**
- Bowl summary grouped by step, with an "Edit" link per step that jumps back into the builder.
- An optional bowl name ("Sean's lunch bowl") and an allergy note for the kitchen.
- Full nutrition breakdown: a table with one row per ingredient (portion, calories, protein, carbs, fat, fiber) and a totals row, styled like a nutrition facts panel.
- "Add another bowl" and "Add a drink" (simple drinks list with price and calories).
- Cart with every bowl and drink, subtotal, tax, total.

**4.6 Checkout**
- First name for the order, entered on a large custom on-screen keyboard (letters, space, backspace; 20 characters max). Don't rely on the device keyboard.
- Payment: v1 shows "Pay at the counter" only. Design the payment step as a pluggable interface so Stripe Terminal or Square Terminal can be added later without UI rewrites.
- Optional: show a QR code that opens a web receipt with the order and its nutrition.

**4.7 Confirmation**
- Huge order number (e.g. **A-042**), customer name, "Pay at the counter" or "We're making it now", estimated wait.
- Returns to the attract screen after 15 seconds, or on tap of "Done".

### 5. The bowl builder

**5.1 Layout**
- **Landscape:** a step progress bar across the top (Base → Protein → Veggies → Toppings → Sauce → Review). The ingredient grid takes the left ~65%. A persistent **"Your Bowl" panel** sits on the right ~35%.
- **Portrait:** the progress bar on top, the grid in the middle, and the Your Bowl panel as a bottom sheet. Collapsed, it always shows calories, protein, price and the Next button; swipe or tap to expand.
- Back and Next buttons are always in the same place. Next is disabled, with a short reason ("Pick a base to continue"), until the step's rules are met.

**5.2 Ingredient cards**
- Photo, name, calories and protein for a Regular portion, price badge (only if it costs extra), small allergen icons, diet tags.
- Tap to add (card gets a checkmark and highlighted border). A selected card shows a **portion control**: segmented buttons Light / Regular / Extra (and Double for proteins), each with its calorie difference and price difference, e.g. `Double +190 cal · +$3.50`. A clear "Remove" (×) button.
- When an ingredient can't be added because the step is full, the card shakes gently and a message says why ("Up to 4 veggies. Remove one to swap.").
- Sold-out items stay visible but greyed out with a "Sold out" label. They can't be tapped.

**5.3 The "Your Bowl" panel**
- **A top-down bowl illustration that fills up** as ingredients are added: each ingredient appears as a colored segment or scatter in the bowl. Make it delightful but quick: under 300 ms per change.
- **Live totals:** big calorie number, then protein, carbs, fat, fiber in grams with horizontal bars. Numbers animate briefly to the new value.
- A **macro ring** showing the share of calories from protein, carbs and fat (protein × 4, carbs × 4, fat × 9 kcal/g, normalized to 100%).
- Bowl price, and the list of selected ingredients with their portions. Tapping one jumps to its step.
- When a goal is set (5.4), a progress bar toward it.

**5.4 Goals** (optional; never block ordering)
| Preset | Target |
|---|---|
| High protein | Protein ≥ 40 g |
| Under 600 | Calories ≤ 600 |
| Low carb | Carbs ≤ 30 g |
| Balanced | No target. Show the macro ring prominently |
| Custom | Customer sets a target for calories, protein, carbs and/or fat with +/- steppers (no typing) |

- While a goal is active, every ingredient card shows how it would change the goal metric ("+35 g protein", "+195 cal").
- A small "On track" / "Over by 80 cal" status in the panel.
- **Suggestions** (rule-based, not AI): if the bowl misses the goal, offer up to 2 one-tap swaps from the current menu, e.g. "Swap white rice for cauliflower rice: −155 cal" or "Make chicken Double: +35 g protein". Choose swaps that move the goal metric the most per change. Only suggest available items that match the active dietary filters.

**5.5 Dietary filters and allergens**
- Diet tags: `vegan`, `vegetarian`, `gluten_free`, `dairy_free`.
- Allergens (US major 9): milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame.
- Items that don't match an active filter are **dimmed, not hidden**, with the reason ("Contains milk"). Tapping one asks "This contains milk. Add anyway?"
- A bowl's tags are derived: a bowl is vegan only if every ingredient is vegan, and so on. A bowl's allergens are the union of its ingredients' allergens. Show both on Review.
- Always show the allergen disclaimer from 6.5 on Review.

**5.6 Step rules** (all configurable in Admin; these are the defaults)

| Step | Required | Min | Max | Included free | Notes |
|---|---|---|---|---|---|
| Base | Yes | 1 | 2 | 2 | Picking 2 makes it **half & half**: each becomes a Half portion (0.5×) and the portion control is hidden |
| Protein | Yes | 1 | 1 | — | The protein sets the bowl price. "No protein (veggie bowl)" is a valid choice. Portions: Light, Regular, Double (paid) |
| Veggies | No | 0 | 4 | 4 | Light / Regular / Extra, all free |
| Toppings | No | 0 | 5 | 2 standard | Each standard topping after the 2nd costs $0.75. **Premium** toppings always cost their own price and don't use up the free ones |
| Sauce | No | 0 | 2 | 2 | Light / Regular / Extra. Each sauce has an **"On the side"** toggle (same nutrition, flagged for the kitchen) |

### 6. Nutrition and pricing math (must be exact)

**6.1 Portions.** Each ingredient stores nutrition for **one Regular portion**. A portion multiplies every nutrient:

| Portion | Multiplier |
|---|---|
| Light | 0.5 |
| Half (half & half bases only) | 0.5 |
| Regular | 1 |
| Extra | 1.5 |
| Double | 2 |

**6.2 Totals.** Bowl total = sum of (ingredient nutrition × portion multiplier) over every line. **Keep full precision while summing and round only when displaying.** Never round per ingredient and then add up.

**6.3 Display rounding** (based on US FDA labeling rules). Use round-half-up.
- Calories: under 5 → `0`; 5 to 50 → nearest 5; over 50 → nearest 10.
- Protein, carbs, fat, fiber: under 0.5 g → `0 g`; otherwise nearest 1 g.
- Use the same rules for per-ingredient numbers on cards and in the Review table.

**6.4 Money.** Store all money as **integer cents**.
- Bowl price = the protein's bowl price + portion price deltas + paid extras (premium toppings, toppings beyond the free ones).
- Tax = subtotal × tax rate, rounded half-up to the cent, once per order (not per line).
- When an order is placed, **snapshot** each line's name, portion, price and nutrition into the order, so later menu edits don't change past orders.

**6.5 Required on-screen text** (shown on Review and in the nutrition breakdown)
- "2,000 calories a day is used for general nutrition advice, but calorie needs vary. Additional nutrition information available upon request."
- "Nutrition values are estimates. Bowls are made by hand, so portions may vary."
- "Our kitchen handles all major allergens. We can't guarantee any item is free of allergens."

**6.6 Admin sanity check.** When staff save an ingredient, compare stored calories to `4×protein + 4×carbs + 9×fat`. If they differ by more than 15% *and* more than 10 kcal, show a warning (don't block saving).

### 7. Data model (TypeScript; mirror it in Postgres)

```ts
type StepId = 'base' | 'protein' | 'veggies' | 'toppings' | 'sauces';
type PortionLevel = 'light' | 'half' | 'regular' | 'extra' | 'double';
type Allergen = 'milk' | 'egg' | 'fish' | 'shellfish' | 'tree_nuts' | 'peanuts' | 'wheat' | 'soy' | 'sesame';
type DietTag = 'vegan' | 'vegetarian' | 'gluten_free' | 'dairy_free';

interface Nutrition {        // for ONE Regular portion
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG?: number;           // optional: only shown when every item in the bowl has it
  sodiumMg?: number;         // optional: same rule
}

interface PortionOption {
  level: PortionLevel;
  priceDeltaCents: number;   // e.g. double chicken = 350
}

interface Ingredient {
  id: string;                // stable slug, e.g. 'grilled-chicken'
  stepId: StepId;
  name: Record<'en' | 'es', string>;
  description?: Record<'en' | 'es', string>;
  imageUrl: string;
  servingGrams: number;      // grams in a Regular portion
  nutrition: Nutrition;
  allergens: Allergen[];
  dietTags: DietTag[];
  portions: PortionOption[]; // which portion levels this item allows
  bowlPriceCents?: number;   // proteins only: sets the bowl price
  priceCents: number;        // add-on price; 0 when included
  premium: boolean;          // premium toppings always charge priceCents
  available: boolean;        // false = sold out ("86'd")
  sortOrder: number;
  color: string;             // used to draw it in the bowl illustration
}

interface StepConfig {
  id: StepId;
  title: Record<'en' | 'es', string>;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  includedSelections: number;
  extraSelectionPriceCents: number;
  halfAndHalf?: boolean;     // base step only
}

interface BowlLine { ingredientId: string; portion: PortionLevel; onSide?: boolean; }
interface Bowl { id: string; name?: string; lines: BowlLine[]; signatureId?: string; }

type OrderStatus = 'new' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled';

interface Order {
  id: string;
  number: string;            // 'A-042', resets daily
  createdAt: string;
  kioskId: string;
  diningOption: 'dine_in' | 'take_out';
  customerName: string;
  allergyNote?: string;
  bowls: OrderedBowl[];      // snapshots (see 6.4)
  drinks: OrderedDrink[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: OrderStatus;
  paymentStatus: 'pay_at_counter' | 'paid';
}
```

Core functions in `src/core/` (pure, fully unit tested):
`bowlNutrition(bowl, menu)`, `bowlPrice(bowl, menu, steps)`, `validateStep(bowl, step)`, `bowlDietTags(bowl, menu)`, `bowlAllergens(bowl, menu)`, `goalSuggestions(bowl, goal, menu, filters)`, `roundCalories(n)`, `roundGrams(n)`, `orderTotals(cart, taxRate)`.

### 8. Seed menu

Put the seed data in `src/data/seed-menu.ts` (and a matching SQL seed later). Values are for **one Regular portion**. They are realistic estimates for development. Add a comment at the top of the file saying the restaurant must replace them with its own recipe-calculated or lab-tested values before launch.

**8.1 Bases** (included; portions Light, Regular, Extra; half & half allowed)

| id | Name | g | Cal | Protein | Carbs | Fat | Fiber | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|
| white-rice | Jasmine White Rice | 150 | 195 | 4 | 42 | 0.5 | 0.6 | vegan, GF, DF | — |
| brown-rice | Brown Rice | 150 | 170 | 4 | 35 | 1.5 | 2.7 | vegan, GF, DF | — |
| quinoa | Quinoa | 150 | 180 | 6.5 | 32 | 3 | 4 | vegan, GF, DF | — |
| greens | Mixed Greens | 75 | 15 | 1 | 3 | 0 | 1.5 | vegan, GF, DF | — |
| cauli-rice | Cauliflower Rice | 150 | 40 | 3 | 7 | 0.5 | 3 | vegan, GF, DF | — |

**8.2 Proteins** (portions Light, Regular, Double; the bowl price comes from here)

| id | Name | g | Cal | Protein | Carbs | Fat | Fiber | Bowl price | Double | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| grilled-chicken | Grilled Chicken | 113 | 190 | 35 | 0 | 4.5 | 0 | $11.95 | +$3.50 | GF, DF | — |
| grilled-steak | Grilled Steak | 113 | 230 | 32 | 0 | 11 | 0 | $13.95 | +$4.50 | GF, DF | — |
| roasted-salmon | Roasted Salmon | 113 | 235 | 25 | 0 | 15 | 0 | $14.45 | +$4.95 | GF, DF | fish |
| garlic-shrimp | Garlic Shrimp | 113 | 135 | 26 | 1 | 3 | 0 | $13.45 | +$4.25 | GF, DF | shellfish |
| baked-tofu | Baked Tofu | 113 | 170 | 18 | 4 | 10 | 1 | $10.95 | +$2.50 | vegan, GF, DF | soy |
| no-protein | No Protein (Veggie Bowl) | 0 | 0 | 0 | 0 | 0 | 0 | $9.95 | — | vegan, GF, DF | — |

**8.3 Veggies** (included, up to 4; portions Light, Regular, Extra)

| id | Name | g | Cal | Protein | Carbs | Fat | Fiber | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|
| roasted-broccoli | Roasted Broccoli | 60 | 40 | 2 | 4 | 2 | 1.5 | vegan, GF, DF | — |
| charred-corn | Charred Corn | 50 | 50 | 1.5 | 10 | 0.5 | 1 | vegan, GF, DF | — |
| black-beans | Black Beans | 60 | 80 | 5 | 14 | 0.5 | 5 | vegan, GF, DF | — |
| cucumber | Cucumber | 50 | 10 | 0.5 | 2 | 0 | 0.5 | vegan, GF, DF | — |
| edamame | Edamame | 50 | 60 | 5.5 | 4.5 | 2.5 | 2.5 | vegan, GF, DF | soy |
| pickled-onion | Pickled Red Onion | 20 | 10 | 0 | 2.5 | 0 | 0.3 | vegan, GF, DF | — |
| cherry-tomatoes | Cherry Tomatoes | 50 | 10 | 0.5 | 2 | 0 | 0.6 | vegan, GF, DF | — |

**8.4 Toppings** (up to 5; 2 standard toppings free, then $0.75 each; premium always charged; portions Light, Regular, Extra)

| id | Name | g | Cal | Protein | Carbs | Fat | Fiber | Price | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|---|
| avocado | Avocado | 50 | 80 | 1 | 4.5 | 7.5 | 3.5 | **Premium $2.25** | vegan, GF, DF | — |
| soft-egg | Soft-Boiled Egg | 50 | 75 | 6.5 | 0.5 | 5 | 0 | **Premium $1.50** | vegetarian, GF, DF | egg |
| feta | Feta | 28 | 75 | 4 | 1 | 6 | 0 | standard | vegetarian, GF | milk |
| sesame-seeds | Toasted Sesame Seeds | 9 | 50 | 1.5 | 2 | 4.5 | 1 | standard | vegan, GF, DF | sesame |
| crispy-shallots | Crispy Shallots | 15 | 80 | 1 | 6 | 6 | 0.5 | standard | vegan, DF | wheat |

**8.5 Sauces** (included, up to 2; 30 g Regular; portions Light, Regular, Extra; "on the side" toggle)

| id | Name | g | Cal | Protein | Carbs | Fat | Fiber | Tags | Allergens |
|---|---|---|---|---|---|---|---|---|---|
| lemon-tahini | Lemon Tahini | 30 | 90 | 2.5 | 3.5 | 8 | 1 | vegan, GF, DF | sesame |
| spicy-mayo | Spicy Mayo | 30 | 160 | 0 | 1 | 17 | 0 | vegetarian, GF, DF | egg |
| teriyaki | Teriyaki | 30 | 50 | 1 | 11 | 0 | 0 | vegan, DF | soy, wheat |
| salsa-verde | Salsa Verde | 30 | 10 | 0 | 2 | 0 | 0.5 | vegan, GF, DF | — |
| yogurt-herb | Greek Yogurt Herb | 30 | 35 | 2.5 | 1.5 | 2 | 0 | vegetarian, GF | milk |

(GF = gluten_free, DF = dairy_free. Anything tagged vegan also counts as vegetarian. Write Spanish names for every item.)

**8.6 Signature bowls** (pre-filled starting points; prices and nutrition are calculated by the core, never hard-coded)

| Name | Lines |
|---|---|
| Protein Power | quinoa, grilled-chicken (Double), roasted-broccoli, edamame, soft-egg, yogurt-herb |
| Green Machine | greens, baked-tofu, cucumber, edamame, avocado, lemon-tahini |
| Steakhouse | brown-rice, grilled-steak, charred-corn, pickled-onion, feta, salsa-verde |
| Teriyaki Salmon | white-rice, roasted-salmon, edamame, cucumber, sesame-seeds, teriyaki |

**8.7 Drinks**: Still Water $2.00 (0 cal), Sparkling Water $2.50 (0 cal), Iced Green Tea unsweetened $3.25 (0 cal), Lemonade $3.50 (120 cal).

### 9. Kitchen Display (`/kitchen`)

- New orders appear instantly (Supabase Realtime) as ticket cards in arrival order, with a soft chime.
- Each bowl is listed **in assembly-line order** (base → protein → veggies → toppings → sauces), with portions in bold when not Regular (**DOUBLE** chicken, **LIGHT** rice) and **ON THE SIDE** for sauces.
- A red **ALLERGY** banner on any ticket with an allergy note.
- A timer on each ticket: neutral under 5 minutes, amber at 5–8, red after 8.
- Tap to move a ticket: New → In progress → Ready. "Recall" brings back the last bumped ticket.
- Big fonts, readable from 2 meters, dark theme, works without a mouse or keyboard.

### 10. Admin (`/admin`)

- Sign in (Supabase Auth). Kiosks never get admin access.
- **Menu editor:** create, edit, reorder, delete ingredients with every field from section 7, including photo upload, both languages, allowed portions and price deltas. Show the calorie sanity warning (6.6).
- **Sold-out toggle:** one tap to mark any item sold out or back. Kiosks update within 2 seconds.
- **Step rules:** edit min, max, included count and extra price per step.
- **Signature bowls:** create and edit from existing ingredients, with live price and nutrition preview.
- **Settings:** tax rate, restaurant name, logo, brand colors, idle timeout, order number prefix, staff PIN for the hidden kiosk menu.
- **Simple reports:** orders per day, revenue, top 10 ingredients, and the average calories and protein per bowl ordered.

### 11. Kiosk hardening

- **Idle reset:** after 60 seconds without a touch, show "Still there?" with a 15-second countdown and a big "I'm still here" button, then clear the cart and return to the attract screen. Also reset after each completed order.
- **Lockdown:** full screen; disable pinch zoom, double-tap zoom, text selection, long-press context menus, pull-to-refresh and swipe-back.
- **Hidden staff menu:** 5 taps on the top-left corner within 3 seconds, then the staff PIN. It allows: reload menu, toggle sold-out items, view kiosk ID and connection status, exit full screen.
- **Offline:** the menu is cached. If the network drops, the customer can still build and order. Orders are queued locally and sent when back online, and the confirmation says "Please pay at the counter". Show a small offline badge for staff, not a scary error for customers.
- **Crash recovery:** an error boundary that shows "Something went wrong, tap to start over" and logs the error. It never leaves a blank screen.
- Write `KIOSK_SETUP.md`: how to run this full screen on an iPad (Guided Access), an Android tablet (a kiosk browser app or screen pinning), and Windows (Chrome `--kiosk`), plus recommended screen brightness and sleep settings.

### 12. Design and accessibility standards

- Touch targets at least **64 × 64 px** with at least 12 px between them. No hover-only interactions.
- Body text at least 20 px on the kiosk. Calorie and price numbers large and bold.
- WCAG 2.2 AA contrast. Never use color alone to show state (add icons or text).
- **Accessibility button** on every kiosk screen: moves all controls into the lower part of the screen (wheelchair reach), enlarges text by 25%, and turns on high contrast.
- Every interactive element has an accessible label. Full flow works with a screen reader.
- Language switch on every screen without losing the cart. All copy lives in `src/i18n/en.json` and `src/i18n/es.json`.
- Great photography placeholders: use neutral illustrated placeholders per ingredient (colored shapes from `Ingredient.color`) so the app looks finished before real photos exist.
- Feel: fast, calm, friendly. Animations under 300 ms. No pop-ups except confirmations.

### 13. Out of scope for v1 (design so they can be added later)

Real card payments, loyalty accounts, online or delivery ordering, multiple locations, receipt printing, AI recommendations. Leave clean extension points (a payment provider interface, a `locationId` column) but don't build them.

### 14. Build order

Finish each milestone fully (running app, tests passing) before starting the next. After each one, update `README.md` with how to run it and what's done.

1. **Core engine:** types, seed menu, all `src/core/` functions, unit tests (section 15).
2. **Kiosk UI on local data:** every screen from section 4 and 5, both layouts, filters, goals, idle reset, no backend.
3. **Backend and kitchen:** Supabase schema, RLS, seed SQL, order placement, kitchen display with realtime, sold-out sync, offline queue.
4. **Admin:** everything in section 10.
5. **Polish:** Spanish translations, accessibility mode, PWA install and offline cache, kiosk lockdown, `KIOSK_SETUP.md`, Playwright tests at both screen sizes.

### 15. Acceptance tests (must pass)

Unit tests for the core, using the seed menu:

**Bowl A:** quinoa (Regular), grilled-chicken (Regular), roasted-broccoli, cucumber, feta, yogurt-herb.
- Raw totals: 530 cal, 50.5 g protein, 40.5 g carbs, 17.5 g fat, 6 g fiber.
- Displayed: **530 cal, 51 g protein, 41 g carbs, 18 g fat, 6 g fiber**.
- Price: **$11.95** (feta is 1 of the 2 free standard toppings).
- Diet: **not** vegetarian (chicken), **gluten-free**, **not** dairy-free. Allergens: **milk**.

**Bowl B:** half & half white-rice + greens, grilled-steak (Double), black-beans (Extra), spicy-mayo (Light).
- Raw totals: 765 cal, 74 g protein, 44 g carbs, 31.5 g fat, 8.55 g fiber.
- Displayed: **770 cal, 74 g protein, 44 g carbs, 32 g fat, 9 g fiber**.
- Price: **$18.45** ($13.95 + $4.50 double steak; extra beans and light mayo are free).
- Allergens: **egg**.

**Bowl C (pricing):** brown-rice, grilled-chicken, avocado, soft-egg, feta, sesame-seeds, crispy-shallots.
- Price: **$16.45** ($11.95 + $2.25 avocado + $1.50 egg + $0.75 for the 3rd standard topping).

**Rounding:** `roundCalories(3) = 0`, `roundCalories(47) = 45`, `roundCalories(48) = 50`, `roundCalories(765) = 770`, `roundGrams(0.4) = 0`, `roundGrams(0.5) = 1`.

**Validation:** can't leave Base with 0 items; a 3rd base is refused; a 5th veggie is refused; a 6th topping is refused; protein step requires exactly 1 choice.

**Order totals:** with an 8% tax rate, a cart of Bowl A + Bowl B has subtotal $30.40, tax $2.43, total $32.83.

End-to-end (Playwright, both screen sizes):
1. Build Bowl A from the menu home, check the panel shows 530 cal / 51 g protein / $11.95, place the order, see an order number, and see the ticket appear on `/kitchen`.
2. Pick the "High protein" goal, start from a low-protein bowl, accept a suggestion, and see the goal turn "On track".
3. Turn on the Vegan filter: chicken, feta and egg are dimmed with a reason; Green Machine shows as vegan.
4. Mark avocado sold out in Admin: within 2 seconds it's greyed out on the kiosk.
5. Leave the kiosk idle: the "Still there?" prompt appears at 60 s and the cart is cleared at 75 s.

### 16. What to hand back

- A working repo with `README.md` (setup, env vars, how to run each app, how to seed the database), `ASSUMPTIONS.md`, `KIOSK_SETUP.md`.
- All tests passing, with the command to run them.
- A short summary of what's built, what's not, and suggested next steps.

## END OF PROMPT
