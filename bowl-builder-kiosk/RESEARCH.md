# Research: What Already Exists and How We Can Do Better

Research for the Build-Your-Bowl Kiosk idea, done October 2026 in two rounds: competitors and customers (v2), then design, engineering and data (v3, section 6). It looks at who already does this, what works, what has gone wrong, and what changed in the prompt because of it.

**A note on sources:** much of what's written about restaurant kiosks comes from kiosk vendors and trade blogs, not independent studies. Numbers marked *(vendor)* are directional, not proven.

---

## 1. Who already does something like this

| Who | What they do | What we take from it |
|---|---|---|
| **Sweetgreen** (app) | The bowl builder shows each ingredient's photo, calories and allergen tags, and keeps a running calorie total. | Calories on every ingredient and a live total are the baseline. Our edge is full macros and goals, not just calories. |
| **Sweetgreen Infinite Kitchen** | Robot-assisted restaurants. Orders come from the app, **kiosks** or a host. More than 40 dispensers portion ingredients into the bowl on a moving line; people cook the proteins and finish the bowl. A "Ready" sign tells in-store guests when to pick up. Reported ~10% higher average ticket, linked to kiosk ordering. Sweetgreen agreed to sell the technology to Wonder in late 2025. | Kiosks + a pickup board + very consistent portions. **Portion consistency is what makes the nutrition numbers true.** |
| **Chipotle + Hyphen** | Tested an automated "digital makeline" for bowls and salads. Bowls and salads are ~65% of Chipotle's digital orders. | Bowl orders are structured data. Storing grams per line keeps the door open for scales or automation later. |
| **Chipotle High Protein Menu** (Dec 2025) | Built from high-protein customizations guests already ordered, plus a 4 oz **Protein Cup** as a smaller option. | Add protein cups and protein-first presets. Mostly a labeling and merchandising job, not new recipes. |
| **CAVA, BIBIBOP, SoFresh** | Third-party sites (e.g. BowlMacros) let people build these chains' bowls and see live calories and macros. BowlMacros says Sweetgreen publishes per-ingredient nutrition but has no official interactive calculator for custom bowls. | Customers want this enough that **outside sites rebuild it** for chains that don't offer it. A macro-first kiosk is a real differentiator. |
| **Nutritionix** "Chipotle calculator" | Third-party builder that shows % of daily values on a 2,000-calorie diet, adjustable. | Daily-value percentages are a nice option, but keep the default simple. |
| **Toast kiosk** | Release notes show nested modifier panels, size-based modifiers, **auto-advance when a modifier group is full**, offline mode, and upsells. | Auto-advance for single-choice steps (Protein). |
| **Square KDS** | Kitchen tickets can list modifiers in a different order than at checkout, color-code modifiers, and stagger prep times. | Tickets in **assembly-line order**, and station views (grill vs line). |
| **Eatsa** (closed by 2019) | Kiosk-only quinoa bowl automat. Expanded to 4 markets too fast and closed most stores in 2017. Was **sued in 2017** because its kiosks had no audio output or tactile input for blind customers; settled by adding accessible design. | Prove one store first. **Build accessibility in from day one.** |

## 2. Key findings

### Kiosks and sales
- Vendors and trade press report **12–20% higher tickets** on kiosks than at the cashier, sometimes up to 30% *(vendor)*. The usual explanation is that people order more without social pressure from a cashier.
- **Placement matters:** one vendor says concepts with kiosks at the counter get over 90% of orders through them, versus 20–30% when kiosks are off to the side *(vendor)*. Your plan (tablet in front of the cashier) is the right spot.
- Put signature bowls and popular items in prominent positions; screen position strongly shapes what people choose. Keep it uncluttered.
- Academic usability studies of fast-food kiosks found confusing flows, unclear guidance and **limited customization** as common problems. Customization is exactly where we can win.

### Accessibility is a legal risk, not a nice-to-have
- Restaurant kiosk lawsuits: **Eatsa** (2017, no audio or tactile input) and **Applebee's / E la Carte** tablets (settled: text-to-speech, gestures for blind users, an audio jack with a Braille label). Similar suits hit Coca-Cola Freestyle touchscreens and health-screening kiosks.
- Common expectations: speech output, a headphone jack (plugging in starts audio mode), tactile or keypad input, and all controls **15–48 inches above the floor** within reach range (2010 ADA Standards).
- Our software answer: an audio mode using the browser's built-in speech, full keyboard/keypad operation, reach mode, larger text and high contrast. The hardware side (jack, keypad, mounting height) goes in the setup guide.

### Labeling laws
- **FDA menu labeling** (chains with 20+ locations) covers kiosks and electronic menus: calories next to every item, the "2,000 calories a day…" statement, and a statement that more nutrition information is available on request. Good practice even for a single store.
- **New York City** already requires a sodium warning icon on chain items with high sodium, and since **October 4, 2025** requires an added-sugar icon on items with **50 g or more of added sugar** (chains with 15+ locations). Other places may follow. So we track sodium and added sugar per ingredient and make warning icons a per-location setting.

### What customers want now
- **Protein and smaller portions.** By late 2025 about 12% of US adults were on GLP-1 drugs. A National Restaurant Association survey says 93% of GLP-1 users changed how they order: 49% choose smaller portions, 43% high-protein items, 41% more vegetables. Chipotle, Shake Shack, Smoothie King, Olive Garden and others launched protein-first or smaller-portion menus.
- **Tip screens on kiosks backfire.** Popeyes (2025), Wendy's (2025) and Shake Shack drew public backlash for tip prompts on self-order kiosks. A 2025 Bankrate survey (cited secondhand) found 38% of Americans are annoyed by pre-entered tip screens.
- **Returning-guest recognition** (loyalty, "your usual") is a common vendor pitch, but there's no independent data on how much it helps, and it requires collecting personal data.

### Devices and payments
- **Kiosk lockdown:** Android tablets are best run in a managed single-app or kiosk-browser mode through an MDM; screen pinning alone is easy to escape. iPads use Guided Access or Single App Mode.
- **Card payments from a web app:** Stripe Terminal's **server-driven** integration lets any web front end trigger a smart card reader (e.g. Stripe Reader S700) through your backend. It **can't take cards offline**, so offline must fall back to pay at counter. Square Terminal works in a similar way.

## 3. What changed in the prompt (v1 → v2)

### UI and UX
| Change | Why |
|---|---|
| Signature bowl in **≤ 6 taps**; dine-in / take-out moved to a single checkout screen; name optional | Speed is the main thing kiosks get judged on. Don't ask questions before showing food. |
| **Auto-advance** after picking a protein; **Skip** on optional steps; "Review bowl" shortcut | Fewer taps (Toast does this). |
| **Simple / Full nutrition toggle** (default: calories + protein) | Most people want two numbers; macro fans can open the rest. |
| **Lighter (≤ 450 cal)** goal and **protein cups** | Smaller-portion and protein-first demand. |
| **Neutral language** and colors for nutrition, no "bad food" red | Avoid diet shaming; it's information, not judgement. |
| **One** goal-aware suggestion on Review, no pop-ups, **tipping off** | Vendors report kiosks raise the check; customers punish pushy screens and tip prompts. |
| **Bowl codes** to reorder a saved bowl with no account | "Your usual" without collecting personal data. |
| **Pickup board** (`/pickup`) | Sweetgreen's Infinite Kitchen uses a "Ready" sign for in-store pickup. |
| Calories on **every** item and drink, sodium and sugar tracked, local **warning icons** | FDA kiosk rules and NYC sodium and added-sugar rules. |

### Accessibility
| Change | Why |
|---|---|
| **Audio mode** (speech), **full keypad/keyboard operation**, `aria-live` updates | Lawsuits against Eatsa and Applebee's tablets were about exactly this. |
| Mounting height **15–48 in** and keypad/headphone setup in `KIOSK_SETUP.md` | ADA reach range. |
| axe-core checks and a keyboard-only end-to-end test | Catch regressions automatically. |

### Architecture
| Change | Why |
|---|---|
| **Server recomputes price and nutrition** (`place-order` Edge Function using the same core code); kiosks can't write orders directly | Never trust the client with money. |
| **Idempotency keys** and an offline queue with kiosk-numbered orders | Flaky Wi-Fi must not lose or duplicate orders. |
| **Published menu versions** with diff, rollback, and switching only between customers | Menu edits never break an order in progress or change past orders. |
| **Sold-out separate from the menu**, live over Realtime | Instant 86'ing without republishing. |
| **Device pairing, heartbeat, remote reload** | You can't manage a fleet of tablets you can't see. |
| **Grams on every order line**, portion spec sheets, Grill station "all-day" counts | Nutrition numbers are only true if portions are consistent (the Infinite Kitchen lesson). Ready for scales or automation later. |
| **Zod schemas** shared by app and server; property tests | Same rules on both sides; math stays correct under any combination. |
| **Performance budget** (low-cost Android tablet) | Kiosks run on cheap hardware for years. |
| **Anonymous funnel analytics**; no cameras, no personal data; names deleted after 30 days | Learn where people drop off without privacy risk. |

## 4. Ideas for later (not in v1)

- **Order from your phone** by scanning a QR code on the kiosk (same app, `channel: 'phone'`) to shorten the line.
- **Staff "line-buster" mode** on a handheld during rush hour.
- **Card payments** via Stripe Terminal or Square Terminal.
- **Recipe nutrition helper** in Admin: enter a recipe in grams and calculate per-portion nutrition from USDA FoodData Central, then have staff confirm.
- **Optional loyalty** with saved bowls, only if customers ask for it.
- **"Describe your bowl"** (AI or voice): "high protein, no dairy, under 600" builds a starting bowl. Must still show the exact computed numbers.
- **Portion scales** on the line that read the grams from the ticket.

## 5. Biggest risks

1. **Wrong nutrition numbers.** The kiosk is only as accurate as the menu data and the portioning on the line. Get real values (lab-tested or calculated from recipes) and train portions with the spec sheets.
2. **Allergen trust.** A filter that says "dairy-free" must be right every time. Keep the cross-contact disclaimer and an allergy note that reaches the kitchen.
3. **Accessibility lawsuits** if the kiosk is the only way to order. Keep a human cashier option and ship the accessibility mode.
4. **Growing too fast** (the Eatsa lesson). Prove it in one location first.

---

## 6. Round 3 (v3): design, engineering and data

### What the research found
| Topic | Finding | What v3 does with it |
|---|---|---|
| Visual trends | Apple's Liquid Glass (2025) drew wide criticism for readability (low contrast, unclear borders); Material 3 Expressive was generally rated more readable, with bold shapes and motion | No translucent glass over content. Borrow bold shape and confident type sparingly |
| Design tokens | The W3C Design Tokens Community Group published its first stable spec, **2025.10** (Format, Color and Resolver modules), with OKLCH and Display P3 support | Tokens shipped in that format with OKLCH ramps and hex fallbacks, plus generated CSS |
| Styling | Tailwind CSS v4 moved to CSS-first config (`@theme`), OKLCH colors by default and built-in container queries | Tokens map straight into `@theme`; cards use container queries |
| Transitions | Same-document View Transitions became Baseline in October 2025 when Firefox 144 shipped them (Chrome/Edge 111, Safari 18) | Screen transitions and the "ingredient flies into the bowl" moment use them, with reduced-motion fallbacks |
| React | React Compiler 1.0 shipped on October 7, 2025; React 19.2 on October 1, 2025 | React 19 + Compiler; no hand-written memoization |
| Realtime | Supabase recommends **Broadcast from Database** over Postgres Changes for scale; Postgres Changes authorizes every change per subscriber on a single thread | Private per-location topics with tiny payloads; clients refetch through RLS |
| Supabase keys | Legacy `anon`/`service_role` keys are being replaced by **publishable** and **secret** keys (legacy deprecated by end of 2026) | The spec uses the new keys |
| Queues | Supabase Queues are built on the pgmq extension | The outbox table works anywhere and can switch to pgmq |
| Offline sync | PowerSync, ElectricSQL and Zero all sync Postgres to the client, but they add moving parts | Not needed: kiosks only need a cached menu plus an order outbox. Revisit for the admin app if it must work offline |
| EU accessibility | The European Accessibility Act applies from June 28, 2025; ordering kiosks that take payment are likely in scope; EN 301 549 is the standard most use; transition rules vary | Named in the accessibility section; spec says to check with counsel |
| WCAG timing | WCAG 2.2.1 requires at least 20 seconds to extend a time limit with a simple action | "Still there?" now counts down 20 s (was 15 s); timeouts triple in accessibility mode |
| Allergens | The EU's 14 allergens (Regulation 1169/2011) add celery, mustard, lupin, molluscs and sulphites and use "cereals containing gluten"; the US 9 use "wheat" | Allergen regimes per location (US9, EU14, CA) in a reference table |
| AI commerce | Stripe and OpenAI released the Agentic Commerce Protocol (2025); live use so far is retail, restaurant ordering only in demos | Agent-ready API and MCP server are extension points, with human confirmation required |
| Postgres IDs | UUIDv7 (time-ordered) is the modern default; Postgres 18 adds `uuidv7()` natively | Schema includes a UUIDv7 function for Postgres 15+ |

### What was built and verified (not just described)
- **`database/`:** a Postgres schema (37 tables), RLS on every table, and the RPCs. **60 automated tests pass** on PostgreSQL 16 locally. While testing I found and fixed:
  - A PL/pgSQL parse issue.
  - A non-deterministic UUID ordering test.
  - Missing service-role grants.
  - Per-row policy checks, rewritten to run once per query.
- **`design/`:** tokens generated by a script that checks 46 color pairs against WCAG AA in both themes and fails on any regression. It also added a control-border token, because hairlines alone (1.4:1) fail WCAG 1.4.11.
- **`data/seed-menu.json`:** validated against its JSON Schema with Ajv, with no broken references. Bowl A and B totals recomputed from the file match the acceptance tests.
- **New acceptance numbers:** promo, inclusive tax, group order, kJ and suggestion ranking. Each was recomputed independently.

## Sources

**Competitors**
- [Sweetgreen custom bowl builder (Desirability Lab, 2021)](https://desirabilitylab.com/backfill/backfill-2021-189-sweetgreen-custom-bowl-builder)
- [Sweetgreen bowl customization (Desirability Lab, 2025)](https://desirabilitylab.com/backfill/backfill-2025-379-sweetgreen-bowl-customization)
- [BowlMacros: Sweetgreen](https://bowlmacros.com/restaurants/sweetgreen), [CAVA](https://bowlmacros.com/restaurants/cava), [BIBIBOP](https://bowlmacros.com/restaurants/bibibop), [SoFresh](https://bowlmacros.com/restaurants/sofresh)
- [Nutritionix Chipotle nutrition calculator](https://nutritionix.com/chipotle/nutrition-calculator)
- [GeekWire: inside Seattle's Sweetgreen Infinite Kitchen](https://www.geekwire.com/2024/inside-seattles-new-sweetgreen-restaurant-where-a-large-robot-helps-the-humans-make-your-salad/)
- [CNBC: inside Sweetgreen's first automated location](https://www.cnbc.com/2023/06/24/inside-sweetgreens-first-automated-location-plans-to-take-tech-nationwide.html)
- [Sweetgreen on Medium: why is our new restaurant a test?](https://medium.com/@sweetgreen/why-is-our-new-restaurant-a-test-53958694cb5e)
- [The Spoon: Sweetgreen launches Infinite Kitchen](https://thespoon.tech/two-years-after-buying-spyce-sweetgreen-launches-infinite-kitchen-robotic-restaurant/)
- [Food On Demand: Wonder to buy Infinite Kitchen tech](https://foodondemand.com/11182025/wonder-buys-sweetgreens-infinite-kitchen-tech-whats-next/)
- [Restaurant Dive: Chipotle starts automated makeline with Hyphen](https://www.restaurantdive.com/news/chipotle-starts-automated-makeline-hyphen-food-safety/695443/)
- [NRN: Chipotle testing an automated makeline](https://www.nrn.com/fast-casual/chipotle-mexican-grill-testing-automated-makeline-its-bowls-and-salads)
- [Toast POS release notes 2.85](https://doc.toasttab.com/doc/relnotes/techReleaseNotes2_85.html), [2.79](https://doc.toasttab.com/doc/relnotes/techReleaseNotes2_79.html)
- [Square help: kitchen display settings](https://squareup.com/help/article/7944)
- [NRN: Eatsa closes all but 2 locations](https://www.nrn.com/restaurant-operations/eatsa-closes-all-but-2-locations)
- [Restaurant Business: high-tech Eatsa closes majority of units](https://restaurantbusinessonline.com/emerging-brands/high-tech-eatsa-closes-majority-its-units)
- [Wikipedia: Eatsa](https://wikipedia.com/wiki/Eatsa)

**Kiosk design and sales**
- [Tillster: High-Performing Kiosk Design](https://www.tillster.com/reports/high-performing-kiosk-design)
- [QSR Magazine: designing a self-ordering kiosk UI](https://www.qsrmagazine.com/story/designing-a-self-ordering-kiosk-user-interface-to-optimize-sales-and-profitability/)
- [QSR Magazine: 6 ways self-serve kiosks boost sales](https://www.qsrmagazine.com/uncategorized/6-key-ways-self-serve-kiosks-can-boost-your-sales/)
- [Bite: the real revenue impact of restaurant kiosks](https://blog.getbite.com/articles/from-10-to-30-the-real-revenue-impact-of-restaurant-kiosks)
- [Xenial: why self-order kiosk placement matters](https://solotest.xenial.com/blog/table-kiosk/why-self-order-kiosk-placement-matters.stml)
- [Usability evaluation of self-ordering kiosks in fast food restaurants](https://openaccess.cms-conferences.org/publications/book/978-1-958651-86-5/article/978-1-958651-86-5_31)
- [UTS: usability issues in self-service technologies](https://opus.lib.uts.edu.au/handle/10453/176697)

**Accessibility**
- [TPGi: the legal case for accessible kiosks](https://vispero.com/resources/the-legal-case-why-your-kiosk-should-be-accessible/)
- [TPGi: ADA kiosk compliance requirements](https://vispero.com/resources/ada-kiosk/)
- [Kiosk Industry: ADA kiosk accessibility and self-service](https://kioskindustry.org/self-service-ada/)
- [KMA: ADA kiosk FAQ](https://kma.global/ada-faq/)

**Labeling laws**
- [FDA menu labeling guidance (PDF)](https://fda.gov/media/116000/download)
- [HHS: FDA menu labeling small entity compliance guide (PDF)](https://www.hhs.gov/guidance/sites/default/files/hhs-guidance-documents/FDA/MenuLabelingSECG.pdf)
- [NYC Health: new added sugars warning rule goes into effect (2025)](https://www.nyc.gov/site/doh/about/press/pr2025/new-added-sugars-warning-rule-goes-into-effect-2025.page)
- [CSPI: NYC Sweet Truth Act takes effect](https://www.cspi.org/press-release/new-york-citys-sweet-truth-act-takes-effect-marking-public-health-milestone)

**Trends**
- [Food Ingredients First: GLP-1 friendly menus 2026](https://www.foodingredientsfirst.com/news/glp-1-friendly-menus-food-dining-2026.html)
- [Restaurant Business: GLP-1 drugs and restaurant chain earnings](https://www.restaurantbusinessonline.com/consumer-trends/rise-glp-1-drugs-loom-restaurant-chain-earnings)
- [Tasting Table: how GLP-1 is reshaping restaurant menus in 2026](https://www.tastingtable.com/2112138/glp1-menu-trend-2026/)
- [Restaurant Business: Sweetgreen debuts mega protein bowl](https://restaurantbusinessonline.com/food/sweetgreen-debuts-mega-protein-bowl)

**Tipping**
- [Dexerto: Popeyes responds to kiosk tip prompt](https://www.dexerto.com/food/popeyes-responds-after-self-service-kiosk-asks-customers-to-leave-a-tip-3392333/)
- [Daily Dot: Wendy's kiosk tip](https://www.dailydot.com/news/wendys-kiosk-tip/)
- [SavingAdvice: places Americans are tired of being asked to tip](https://www.savingadvice.com/articles/2026/09/22/10747664_10-places-americans-are-getting-tired-of-being-asked-to-tip-in-2026.html)

**Devices, payments, personalization**
- [Stripe: design a Terminal integration](https://docs.stripe.com/terminal/designing-integration)
- [Stripe Reader S700 setup](https://docs.stripe.com/docs/terminal/payments/setup-reader/stripe-reader-s700)
- [Headwind MDM: single-task (kiosk) mode](https://h-mdm.com/?p=505)
- [Trio: Android kiosk browser](https://www.trio.so/blog/android-kiosk-browser)
- [GRUBBRR: AI-powered personalized kiosks](https://grubbrr.com/ai-powered-restaurant-kiosks-personalized-self-service/)
- [Modern Restaurant Management: QR codes and hospitality in 2026](https://modernrestaurantmanagement.com/three-ways-qr-codes-will-reshape-restaurant-hospitality-in-2026/)

**Round 3: design, engineering and data**
- [Android Authority: Material 3 Expressive vs Liquid Glass](https://www.androidauthority.com/android-16-material-3-expressive-vs-ios-26-liquid-glass-3565853/)
- [Michael Tsai: Liquid Glass reactions](https://mjtsai.com/blog/2025/06/10/liquid-glass)
- [LogRocket: Apple Liquid Glass UI](https://blog.logrocket.com/ux-design/apple-liquid-glass-ui/)
- [W3C: Design Tokens specification reaches first stable version](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Design Tokens Technical Reports 2025.10](https://www.designtokens.org/tr/2025.10/)
- [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4-alpha)
- [web.dev: Same-document view transitions are Baseline](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available)
- [Chrome: What's new in view transitions (2025)](https://developer.chrome.com/blog/view-transitions-in-2025)
- [React: React Compiler v1.0](https://de.react.dev/blog/2025/10/07/react-compiler-1)
- [Supabase: Realtime Broadcast from Database](https://supabase.com/blog/realtime-broadcast-from-database)
- [Supabase: Subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase: Realtime benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)
- [Supabase: Understanding API keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [PowerSync: ElectricSQL vs PowerSync](https://powersync.com/blog/electricsql-electric-next-vs-powersync)
- [Accessible.org: How EAA rules apply to self-service terminals](https://accessible.org/eaa-self-service-terminals/)
- [Acquia: European Accessibility Act and EN 301 549](https://www.acquia.com/blog/european-accessibility-act-and-en-301-549-your-complete-compliance-guide)
- [FSAI: List of 14 allergens](https://www.fsai.ie/enforcement-and-legislation/legislation/food-legislation/food-information-fic-(labelling)/list-of-14-allergens)
- [GoVisually: allergen labeling across markets](https://govisually.com/blog/allergen-labeling-requirements-across-10-global-markets-complete-cpg-guide/)
- [Stripe: Instant Checkout in ChatGPT and the Agentic Commerce Protocol](https://stripe.com/newsroom/news/stripe-openai-instant-checkout)
