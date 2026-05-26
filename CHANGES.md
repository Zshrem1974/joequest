# CHANGES

## Cities #8-10: Gulf Coast expansion (Slidell, Gulfport, Biloxi)

JoeQuest's first non-Florida cities — three on the central Gulf Coast:

- **Slidell, LA** (16 cafés) — St. Tammany Parish, north shore of Lake
  Pontchartrain. ZIPs 70458/70460/70461. Notable: Sirincci Coffee (two
  locations), Roots Plants + Coffee, Flatland Coffee.
- **Gulfport, MS** (10 cafés) — Harrison County, ZIPs 39501/39503/39507.
  Notable: Coast Roast, Coffee Y'all Espresso, Cat Island Coffeehouse.
  The `addressRegex` anchor on `", MS"` was critical — Gulfport, FL
  also exists (near St. Petersburg) and would otherwise contaminate.
- **Biloxi, MS** (10 cafés) — Harrison County, ZIPs 39530/39531/39532.
  Shares its western boundary with Gulfport at lng -89.00; per-city
  `addressRegex` second-guard prevented any cross-bleed.

Total: **36 new cafés, ~$1.62** in Claude+Places for the snapshot pull.
All addresses verified clean, zero boundary leakage between Gulfport
and Biloxi or from Gulfport-FL.

### Per-city timezone wiring (bundled fix)

Both `lib/data.js` (server `hoursLabel`) and `public/index.html` (client
`nowInBocaClient` / `liveStatus`) hardcoded `America/New_York`. Correct
for FL-only; would have produced 1-hour-off "Closes X PM" labels for
any Central-time city.

Fixed end-to-end:
- New `timezone` field per city in `lib/cities.js` (existing 7 set to
  `America/New_York`, new 3 to `America/Chicago`).
- `nowInBoca` renamed to `nowInZone(timeZone)`; `hoursLabel(h, tz)`.
- `mapPlaceToCafe` bakes `timezone` into every café in the snapshot
  so the client uses it without a city lookup.
- Client functions thread `c.timezone` end-to-end, with an Eastern
  fallback for any snapshot row predating this change.
- `scripts/refresh-hours.js` passes timezone too and backfills the
  field on cafés it touches.

### Marketing copy

`public/index.html`'s "Right now we're deep in South Florida" line
became factually wrong the moment the Gulf Coast snapshots ship.
Rewritten to region-agnostic: "We're growing one coffee scene at a
time — South Florida is where we started, with the Gulf Coast
(Louisiana and Mississippi) coming online now."

### Observation, not bug

**7 Brew Coffee** (regional, ~250 locations) and **PJ's Coffee**
(Louisiana-regional, ~150 locations) appear in multiple Gulf Coast
cities — neither is in `EXCLUDE_NAMES`. Borderline chain-y. Worth
deciding later whether to exclude; for now they're shipping.

## City #7: Parkland, FL

Adds Parkland (Broward County, north of Coral Springs, bordering the
Palm Beach line) as JoeQuest's 7th city — slug `parkland`. Standard
add-a-city flow: config row in `lib/cities.js`, workflow snapshot run,
`data/parkland.json` committed via PR.

**Honest count: 2 cafés** — Carmela Coffee (4.8★, 1.7k reviews) and
Cozy Drop (4.8★, 68 reviews). Parkland is a residential suburb whose
coffee landscape is mostly chains in strip plazas, which the chain
blocklist correctly excludes. Worth revisiting whether 2 cafés earns
a dedicated city slot or whether Parkland should fold into a
neighbour once the rest mature — for now it ships as-is, with data
quality intact (real Parkland addresses only, no boundary leakage
from Coral Springs / Coconut Creek / Boca).

**Also unblocked along the way:** the monthly snapshot cron had been
silently failing every 1st — the two repo secrets (`GOOGLE_PLACES_API_KEY`,
`ANTHROPIC_API_KEY`) were never set, and "Allow GitHub Actions to
create and approve pull requests" was off. Both fixed, so the monthly
refresh will now actually open its PR.

## Offers: removed café samples; non-café brand examples only

Aligns the **Offers** page with the new Partner positioning (coffee
gear + bean brands only, no café partnerships ever). Two pieces:

### Frontend (shipped in this commit)

- `public/index.html` Offers-page intro copy:
  - Was: "Partner deals from cafés and coffee brands. Reveal a code,
    use it on the spot."
  - Now: "Member discounts from coffee-product brands — machines,
    beans, brewing gear, subscriptions. Reveal a code, use it on the
    spot."
- The defensive "Café offer" tag label in `offerCardHTML` is left in
  place — it's now unreachable code (every future row is
  `kind: 'brand'`) but it doesn't hurt and guards against any legacy
  row that might still exist.

### Database (run this in Supabase → SQL Editor)

I don't have access to the live DB from here. Paste this once to swap
the seeded samples:

```sql
-- 1. Remove the seeded café-kind sample offers (the BOGO cortado +
--    pastry discount from the original Stage 4 seed). Only touches
--    rows where sample = true, so any real café offer you added
--    manually is left alone.
delete from offers where sample = true and kind = 'cafe';

-- 2. Insert three non-café brand sample offers so the Offers page
--    has demo content again. Same DEMO- code prefix convention so
--    they're obviously fake.
insert into offers (partner_name, title, description, code, terms, kind, ends_at, sample)
values
  ('Aurum Espresso Works', '15% off any home espresso machine',
   'Get the home setup that ends the café guesswork.',
   'DEMO-MACHINE15',
   'Online only. One redemption per customer. Excludes commercial models.',
   'brand', now() + interval '90 days', true),
  ('Lighthouse Roasters', 'First bag free on a 3-month subscription',
   'Single-origin beans delivered fresh — try it on us.',
   'DEMO-FIRSTBAG',
   'New subscribers only. Auto-renews after the trial; cancel anytime.',
   'brand', now() + interval '90 days', true),
  ('Brew Co. Gear', '20% off pour-over and brewing kit',
   'Drippers, kettles, scales — the gear behind a great cup.',
   'DEMO-POUR20',
   'Online only. Excludes already-discounted items.',
   'brand', now() + interval '90 days', true);
```

**Optional follow-up (only if you have real café offers in the table):**
the new policy is no café partnerships at all, so any non-sample row
with `kind = 'cafe'` is now off-strategy. If you want, also run:

```sql
-- DOUBLE-CHECK before running. Lists what would be deactivated:
select id, partner_name, title from offers where kind = 'cafe' and sample = false and active = true;

-- If that list is OK to deactivate (the rows stay in the DB for audit
-- but stop showing on the Offers page):
update offers set active = false where kind = 'cafe' and sample = false;
```

The `kind` CHECK constraint still allows `'cafe'` so the schema is
unchanged — we're just declining to use it going forward. No code
change needed if/when you decide to tighten the constraint later.

---

## Messaging: new Our Story page + Partner page rebuilt around brand offers

Two drawer pages updated as a single messaging pass. No engine, auth,
snapshot, map, analytics, or offers-data-model changes. Verbatim copy
supplied by PM, used as-is.

### Our Story (new)

- New drawer item **"Our Story"** placed directly under Profile (top of
  the drawer's first section), open-book icon matching the existing
  20px stroke style.
- New `<main class="view" id="view-our-story">` following the same
  pattern as every other drawer page: Back button, gradient hero with
  page title, content sections.
- Two heading sections (`Coffee, without the guesswork.` and `New in
  town? Start with a good cup.`) with three body paragraphs each.
- CSS: `.story-hero` (gradient header, Poppins 26px) and
  `.story-section` (Poppins 19px h2, Inter 15px body, line-height
  1.65). Static content — no render fn needed.

### Partner page — rebuilt around brand offers

The page is now exclusively about **coffee brands offering discount
codes to JoeQuesters**, with JoeQuest earning a share when a code is
redeemed.

**Removed:** the paid café-placement tier in full — the $49/mo
"Featured café slot" card, the "Apply for placement" CTA, the
"Featured slot in the top 3 cards on Discover" bullet, and the prior
"Sponsored placements never override our AI picks" policy box (replaced
with a stronger standalone trust callout, see below). The standalone
"$250/campaign Coffee brand sponsorship" tier card is also gone — the
new model is performance-based on redemptions, not campaign-priced.

**Added:**
- New page title: "Partner with JoeQuest" (hero, no sub-tagline).
- Two pitch sections: "Coffee brands, meet JoeQuesters." and "How it
  works" — verbatim copy, rendered in the same `.story-section` style
  used by Our Story so the two new pages feel consistent.
- A visually distinct trust callout using the existing `.policy-box`
  style with a `.trust-callout` modifier that promotes the bold
  statement to a standalone heading: **"Offers never influence our
  picks."** followed by the explanatory paragraph.
- A single CTA: **"Offer a code to JoeQuesters"** that opens the
  existing Help form with the **Partner enquiry** category pill
  pre-selected. Wired via a tiny global click handler that watches
  `data-help-category`, then calls `go("help")` (which resets the form
  via `renderHelp`), then assigns the requested category to the module-
  scoped `helpCategory` variable and updates the pill UI. No new form,
  no `mailto:`, no self-serve portal — reuses the pattern already in
  the app.

### Why paid café placement was removed (positioning/trust)

A page that simultaneously says "our picks come from real reviews,
period" *and* "cafés can pay for a featured top-3 slot" is internally
inconsistent and reads as "we can be bought." Removing the paid tier
brings the partner-page pitch in line with the engine's editorial
promise (`SYSTEM_PROMPT` in `lib/data.js`: only items actually named in
reviews, null + confidence "none" when thin). Brand-offer redemption
sharing is a clean revenue model that doesn't touch the picks at all,
and that's what the page now leads with.

---

## PWA: JoeQuest is now installable on iOS + Android

Additive wrapper around the existing web app — no feature, UI, engine,
auth, snapshot, or routing changes. Phones can now "Add to Home Screen"
and launch JoeQuest full-screen with its own icon. Repeat loads are
instant from the shell cache.

### What landed

- **`public/manifest.webmanifest`** — `name`, `short_name`, standalone
  display, portrait orientation, crema-orange `#D98324` theme, oat
  `#F5E9DC` background. Icons declared at 192 + 512, with the 512
  flagged `purpose: "any maskable"` (the existing app icon's pin sits
  well inside the 80% safe zone, so one file serves both regular and
  Android adaptive masks).
- **`public/sw.js`** — plain service worker, no Workbox, no build step.
  Versioned cache (`joequest-shell-v1`), old versions deleted on
  activation. Caches the shell only: HTML, manifest, offline page, all
  icons/brand SVGs, the JoeQuesters marker PNG. **Never caches `/api/*`,
  the `/api/photo` proxy, `/admin`, or any cross-origin request** —
  stale picks/favourites/offers/auth would be worse than honest
  failures. Navigation requests use network-first (so deploy updates
  reach users immediately); other shell assets use cache-first.
- **`public/offline.html`** — brand-styled (oat/espresso/Poppins) page
  shown when the network is dead and there's no cached shell. One
  honest line + a Retry button. No fake data.
- **`public/img/joequest-icon-192.png`** (192×192), **`joequest-icon-512.png`**
  (512×512), **`apple-touch-icon.png`** (180×180) — all rasterized from
  the existing `joequest-app-icon.svg` via `qlmanage` (macOS-native
  Quick Look). Crema-orange background, cream pin/cup centered. No
  external rasterizer/build pipeline required.
- **`public/index.html` head additions** — `<link rel="manifest">`,
  `<meta name="theme-color" content="#D98324">` (updated from the prior
  espresso `#5E3E27` to match the manifest), `apple-mobile-web-app-*`
  metas (`capable`, `status-bar-style`, `title`), apple-touch-icon now
  points at the new 180px PNG (was the SVG — iOS prefers PNG). Title
  bumped from "JoeQuest — Boca Raton" to "JoeQuest — Coffee, sorted"
  to match the multi-city reality. Service-worker registration added
  in a tiny separate `<script>` block after the main app boot;
  registers on `window.load` so it can't block first paint and is
  feature-detected so old Safari / in-app webviews are a graceful no-op.

### Bumping the SW cache version when the shell changes

When you change anything in the precached shell list (a new icon, an
updated `index.html` shell, the offline page), bump `SHELL_VERSION` at
the top of `public/sw.js` (e.g. `"v1"` → `"v2"`). On the next user
visit, the install event opens a fresh cache, the activate handler
deletes any cache whose name doesn't match the new version, and clients
pick up the new shell on the following reload. Navigation requests use
network-first anyway, so HTML changes propagate without a version bump
— version bumps matter most for image/icon swaps.

### Note on hosting

Installability requires HTTPS — Render already provides it for the
deployed domain, so no infra change needed. No new env vars. The
manifest + SW are pure static files served by the existing
`express.static("public")` mount.

---

## UI: last-input-wins for city/ZIP/Location + share-on-sheet + copy tweaks

### City / ZIP / Location now follow a single "last input wins" rule

The three location-ish controls in the city-bar (city dropdown, ZIP
input, Location button) were previously additive — Location set the
distance origin but kept the old city; ZIP disabled the dropdown
entirely. They each now cleanly override the others, matching real
user intent.

| Last action | What clears | What stays |
|---|---|---|
| **Pick city** | ZIP mode + ZIP value + origin (geolocation **or** ZIP) | Selected city is the only filter; distance lines disappear |
| **Tap Location** | ZIP mode + ZIP value | Auto-switches dropdown to the nearest city we have data for; origin = your position; cards re-sort by distance |
| **Type ZIP** | Geolocation origin (overwritten by ZIP centroid) | ZIP mode active; all 6 cities' cafés listed, sorted by distance from ZIP |

Code: `selectCity()`, `locateMe()`, and `renderCityDropdown()` in
`public/index.html`. `applyZip()` already overrode geolocation origin
via direct reassignment so it didn't need a change.

**Pre-existing follow-up not addressed here:** `projectXY()` in the map
renderer is still hardcoded to Boca's bbox, so the "you" pin and café
pins for non-Boca cities will be off-canvas on the stylized SVG map
view. The card list, dropdown, and `?city=` API path all work correctly
across cities — only the map's pixel projection is Boca-only.

### Bug fix: Map view's café list now updates when city changes

`selectCity()` called `renderMaps()` (plural — repaints the mini + big
map SVG canvases) but never `renderMap()` (singular — owner of the
Map view's card list, count, and filter state). Switching city while
on the Map screen swapped the pins but left the previous city's cards
rendered underneath. Mirrors the pattern already used by the ZIP
override handler.

### Share button on the detail sheet + greeting copy tweak

* Bottom-sheet header now shows the share button alongside the heart
  (wrapped in a small flex group so they sit next to each other tidy).
  Click delegation already routes `[data-share]` to `shareCafe`, so no
  JS changes were needed.
* Greeting copy: "Coffee Quest Begins" → "**Your** Coffee Quest Begins".

---

## Snapshot ops: MUST_INCLUDE shipped + --city parity + dry-run cost summary

Three small changes that harden the monthly cron and make ops repeatable.

### MUST_INCLUDE per-city (shipped)

`scripts/snapshot.js` now unions `city.mustInclude` ids that are absent
from Google's top-20 text search via a per-id **Place Details** call,
*before* the 90-day loop runs. The per-café clock still applies — fresh
entries are reused, stale ones get re-pulled. Boca's two curated cafés
(**Espresso Joint** + **Rosalia's Botanical Cafe**) no longer need
manual re-adding via `scripts/add-cafe.js` after a Google rotation
drops them.

**How to add a place_id to a city's `mustInclude` list:**

1. Find the Google `place_id` (easiest: run `node scripts/add-cafe.js
   "Café Name" --city=<slug>` once — the script logs the place's id in
   its first response).
2. Open `lib/cities.js`, find the city entry, append the id to
   `mustInclude: [...]` with a trailing `// Café Name` comment.
3. Commit. The next monthly cron (or any `node scripts/snapshot.js
   --city=<slug>` run) will fetch it via Place Details and keep it in
   the snapshot indefinitely.

**To drop one:** delete the line from `mustInclude`. The café will still
be picked up by the next refresh if Google's search returns it, and
silently dropped if not.

DRY refactor that came with this: extracted `mapPlaceToCafe(place,
city)` + `fetchPlaceById(id, key, city)` into `lib/data.js`. Both
`searchCafes` and `scripts/add-cafe.js` now use the shared mapper, so
the snapshot field shape is defined in one place.

`--dry-run` honours the no-paid-calls rule — it logs missing
mustInclude ids as "would fetch via Place Details in real run" instead
of actually calling the API.

### `scripts/refresh-hours.js` — `--city=<slug>` flag

Brings the cheap hours-only patch script to parity with `snapshot.js`.
Defaults to `boca-raton`, validates the slug against `lib/cities.js`'s
`CITIES` export, exits with the known-list on unknown slugs. Snapshot
path resolves to `data/<slug>.json`, and the underlying Google search
uses the right per-city text query + bbox.

### `--dry-run` now prints a pre-flight plan + cost estimate

Before the per-café loop runs (where the Claude + Places-Details calls
happen), the script now prints a per-city plan:

```
Plan for Boca Raton, FL:
  Reused (fresh, <90d):     18
  Stale (≥90d, re-pull):    1
  New cafés (from search):  0
  MUST_INCLUDE:             would add 2
  Estimated cost: ~$0.22  (3 Claude × $0.04 + 21 Places × $0.005)
```

Lets a `--dry-run` show exactly what a real refresh would spend
*without* making any new paid calls itself. Same plan section prints
in a real run too — just without "would add" framing.

---

## Refresh pipeline: monthly cron now refreshes ALL 6 cities

**Correctness fix.** The monthly GitHub Action previously defaulted to Boca
only — Delray, Boynton, Deerfield, Fort Lauderdale, and Miami would have
silently gone stale at their 90-day mark. Now every monthly run iterates
every city in `lib/cities.js`.

### What changed in `.github/workflows/snapshot.yml`

- Single job serialises calls to `node scripts/snapshot.js --city=<slug>`
  for all 6 cities, then opens **one combined PR** with the diff.
- `workflow_dispatch` gained a `city` input — leave blank to run all,
  fill in a single slug (e.g. `delray-beach`) to target one.
- `force` input still ignores the 90-day rule when set.
- Per-city failures don't abort the rest (`|| echo failed — continuing`)
  so one bad city can't block the other five.

### Why one combined PR instead of one-per-city

- 6 separate PRs would step on each other's `data/*.json` diffs and
  thrash reviewer attention. One PR keeps the whole month's changes
  in a single reviewable unit and makes rollback trivial (revert one
  merge).
- The trade-off is cycle time — all 6 cities run serially in one job,
  so a partial failure in city 3 still gives you cities 1-2's results
  in the same PR.

### City list is duplicated in YAML — kept in sync with `lib/cities.js`

Action runners can't easily import ES modules from YAML, so the city
slug list is hardcoded in the workflow's run-step. A comment in the
file points back to `lib/cities.js` as the real source. **When you add
a new city, update both.**

### MUST_INCLUDE per-city (scaffolding — shipped in next session)

`lib/cities.js` got the new `mustInclude: [...]` field on Boca-Raton,
seeded with the place_ids for Espresso Joint and Rosalia's Botanical
Cafe — both have dropped out of Google's rotating top-20 before. The
union logic in `scripts/snapshot.js` landed in the **next** session;
see the top-of-file "Snapshot ops" entry.

---

## Multi-city (Stages A → D) + share + deep links + Espresso Joint refill

Expanded coverage from Boca-only to **6 South-Florida cities**: Boca Raton,
Delray Beach, Boynton Beach, Deerfield Beach, Fort Lauderdale, Miami.
**89 cafés total.** Added per-card share + deep links.

### A — backend plumbing
- New **`lib/cities.js`** holds the 6 city configs (slug, displayName, bbox,
  centroid, addressRegex, searchQuery) + `cityBySlug()` + `nearestCity()`
  + generic `inBoxBy()` helpers.
- **`lib/data.js`** `searchCafes(googleKey, city)` is now city-parameterized
  (defaults to Boca for back-compat). City slug stamped on each cafe row.
- **`server.js`** loads every `data/<slug>.json` whose slug matches a known
  city (also accepts legacy `boca-snapshot.json`).
- New endpoints:
  - `GET /api/cafes?city=<slug>` — that city's cafés
  - `GET /api/cafes?all=1` — every city flat, tagged with `city`
  - `GET /api/cities` — list for the dropdown (slug, displayName,
    hasSnapshot, cafeCount)
  - `GET /api/zip/:zip` — resolves a 5-digit US zip → `{lat,lng}` via one
    Places text search (~$0.005)
- `/api/status` now reports a `snapshots[]` array (was a single object).
- Renamed `data/boca-snapshot.json` → `data/boca-raton.json` (with the
  legacy filename still accepted by the server).

### B — UI: city dropdown, geolocation, distance
- New city-bar in the Discover greeting: dropdown (cities without a snapshot
  show "coming soon" + disabled) + origin hint.
- Boot logic: silent geolocation (only if already permitted) → pick nearest
  of the 6 cities → fall back to `localStorage["jq.lastCity"]` → Boca. No
  permission prompt on first visit.
- **"📍 N.N mi/km away"** line under each card's stats row when an origin
  is set. Uses mi/km from Settings.
- Cafés client-side re-sorted by distance whenever an origin exists.
- Locating yourself on the map (Locate-me button) also sets the
  Discover-card origin.

### C — zipcode override
- New ZIP input pill next to the city dropdown. 5 digits auto-fires
  `applyZip(zip)`:
  - Sets origin to that zip's centroid
  - Fetches `/api/cafes?all=1`
  - Sorts the combined list by distance from the zip
  - **City dropdown is disabled** while a zip is active
  - Hint flips to `📮 ZIP 33432 · sorting all cities by distance`
- `×` clear button resets to city-mode and reloads the active city.
- `Enter` to confirm, `Esc` to clear. Origin source is tracked (zip vs
  geolocation) so clearing the zip only drops origin when zip set it.
- **Map view gets its own city-bar** above the filter chips, mirroring the
  Discover bar. Both bars stay in sync via class-based selectors.

### D — data (one-time backfill, ~$3 in API)
- Ran `node scripts/snapshot.js --city=<slug>` for the 5 new cities:
  - `data/delray-beach.json` — 15 cafés
  - `data/boynton-beach.json` — 11 cafés
  - `data/deerfield-beach.json` — 9 cafés
  - `data/fort-lauderdale.json` — 18 cafés
  - `data/miami.json` — 16 cafés
- Each row has full hours data (periods + weekdayDescriptions) so the
  client computes open/closed live.

### Espresso Joint refill
- `scripts/add-cafe.js` refactored to be city-aware (`--city=<slug>`,
  defaults to `boca-raton`; uses city's bbox + addressRegex; stamps city
  slug on the row).
- Re-added **Espresso Joint** to Boca (it dropped out of Google's rotating
  top-20 search). Picks: Whipped Honey Latte (high) + Breakfast Croissant
  (medium). Boca now at **21 cafés**.

### Share button + deep links
- **Every café card** has a share button on the photo, left of the heart.
  Tap → `navigator.share` on mobile (native share sheet), clipboard fallback
  on desktop with a "Link copied" toast.
- Payload: `"Try the <drink> + <food> at <name> — JoeQuest"` plus
  `<origin>/?cafe=<id>` deep link.
- `?cafe=<id>` on page load auto-opens that café's bottom sheet.
  Cross-city: if the linked café lives in another city, the app switches
  via `selectCity()` first, then opens the sheet.
- `"share"` added to the events allow-list so the funnel can include
  share intents.

### Required env vars (unchanged)
Same `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_*`, `ADMIN_TOKEN`.

### Known structural debt
- Google's `places:searchText` caps at 20 per query — well-rated cafés at the
  edge of a city can drop out of the top-20. We have `scripts/add-cafe.js`
  as a per-place workaround. **TODO:** add a `MUST_INCLUDE` list of
  place_ids per city to `scripts/snapshot.js` so curated picks survive
  every refresh.
- `scripts/refresh-hours.js` and the monthly snapshot Action still use the
  legacy single-city path. Both need `--city=<slug>` matrix updates.

---

## Instrumentation Stage 1 — Event capture (user-testing analytics)

Lightweight self-hosted event tracking so we can see what real Boca users
do without a third-party analytics stack. Privacy-light: no PII in events,
no fingerprinting, no third-party trackers; one anonymous client_id in
localStorage and the user's existing Supabase id (never their email).

### What changed

**Schema** — new `events` table.
- `id` bigserial PK
- `client_id` — anon localStorage id (`jq.cid`)
- `user_id` — nullable FK to `auth.users(id) ON DELETE SET NULL`
- `name` — event name (allow-listed server-side)
- `props` — small `jsonb` payload (server caps at 1 KB)
- `path` — which of the nine views was active
- `created_at` — timestamp
- RLS on, **no policies** — only the service-role writes/reads.

**Server**
- `POST /api/event` — accepts `{ name, props, client_id, path }` + optional
  `Authorization: Bearer <jwt>` (or `token` in body for `sendBeacon`).
  Allow-lists the event name, validates the client_id shape (6–64 url-safe
  chars), caps `props` JSON to 1 KB, swallows all errors. **Returns 204
  immediately** before doing the DB write — analytics never slows the UI.
- `db.js → saveEvent({ client_id, user_id, name, props, path })`
  service-role insert with an in-memory dev fallback (capped at 2000 rows).

**Client**
- New `track(name, props)` helper in `public/index.html`:
  - lazily creates/reads `localStorage["jq.cid"]`
  - includes the current `state.view` as `path`
  - **logged-in users:** `fetch` with `keepalive: true` so the JWT
    `Authorization` header rides along
  - **logged-out users:** `navigator.sendBeacon` first, falling back to
    `fetch+keepalive`. (sendBeacon can't set headers, so logged-out
    events never carry a user_id — that's the intended trade-off.)
  - completely silent on failure
- Event hooks placed at:
  - `app_open` — once per browser session (sessionStorage guard) in `init()`
  - `view_change` (`{ to }`) — inside `go()` when the view actually changes
  - `cafe_open` (`{ place_id, rank }`) — top of `openSheet()`
  - `pick_reveal` (`{ place_id }`) — once per sheet open after picks render
  - `favourite_add` / `favourite_remove` (`{ place_id }`) — in `toggleFavourite()`
  - `taste_profile_complete` — after a successful `PUT /api/taste`
  - `offer_reveal` (`{ offer_id }`) — after a successful reveal+counter bump
  - `help_submit` (`{ category }`) — after a successful help-form POST
  - `signin` / `signup` (`{ confirmed }`) — in the auth-form success branches

The allow-list lives in `server.js`:

```js
const EVENT_ALLOWLIST = new Set([
  "app_open", "view_change", "cafe_open", "pick_reveal",
  "favourite_add", "favourite_remove",
  "taste_profile_complete", "offer_reveal", "help_submit",
  "signin", "signup",
]);
```

**Explicitly NOT captured:** review text, reviewer names, café-review
contents, user emails, help-form message bodies, precise lat/lng,
geolocation coordinates, IP addresses (Render's behind a load balancer; we
don't log them and Supabase doesn't either by default).

### Setup SQL (Supabase → SQL Editor → Run)

```sql
create table if not exists events (
  id         bigserial primary key,
  client_id  text not null,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  props      jsonb,
  path       text,
  created_at timestamptz not null default now()
);
create index if not exists events_created_idx on events (created_at desc);
create index if not exists events_name_idx    on events (name);
create index if not exists events_client_idx  on events (client_id);

alter table events enable row level security;
-- No policies — service-role only.

notify pgrst, 'reload schema';
```

### Stage 2 — minimal admin view (`/admin`)

A read-only stats page gated by a shared secret. Built for *us* to skim
during user-testing — not a product, not user-facing.

**Server**
- `GET /api/admin/stats?days=N` (default N=7) returns aggregates:
  `totalAllTime`, `totalInWindow`, `uniqueClients`, `byName` (count per
  event), `byPath` (count per view), `byDay` (count per ISO day, with
  empty days filled), `funnel` (unique-client counts for the four key
  steps), plus a `generatedAt` timestamp.
- `GET /admin` serves `admin-views/admin.html`. The file lives **outside
  `/public/`** so the static handler can't serve it without the token —
  the only path to it goes through the gate.
- Gate: `adminAllowed(req)` checks `ADMIN_TOKEN` env var against either
  `X-Admin-Token` header or `?token=…` query param, with a constant-
  time-ish string compare.

**Client**
- Bare HTML page in JoeQuest palette (Poppins display, Inter body), four
  stat cards (all-time, window, unique visitors, funnel conversion),
  four bar-chart sections (funnel, by day, by name, by view). No charting
  library — bars are `width: %` div fills.
- Window selector (1 / 7 / 14 / 30 days) and refresh button.
- Reads `?token=` from the URL and forwards it to `/api/admin/stats`.

**db.js**
- `computeEventStats({ days })` — fetches up to 5,000 most-recent rows in
  the window (cheap COUNT(*) for the all-time number), tallies in JS.
  At meaningful scale this becomes a Postgres view or `rpc()` — left as
  a comment in the source.

### How to open the admin view

1. Set `ADMIN_TOKEN` in Render → Environment → Add env var. Pick a long
   random string (e.g. `openssl rand -hex 32`). Save → Render redeploys.
2. In your browser: `https://joequest.onrender.com/admin?token=YOUR_TOKEN`
3. Bookmark that URL with the token included. **Don't paste it in chat or
   commit it to the repo.** The token is the only thing standing between
   the public internet and your stats.

### Required env var (NEW)

| Var | Required | Where |
|---|---|---|
| `ADMIN_TOKEN` | Yes (for admin view) | Server only. Long random secret. |

If `ADMIN_TOKEN` is unset, `/admin` and `/api/admin/stats` both reject
every request with 401.

### What this will tell us once Boca users hit the site

Funnel: `app_open` → `cafe_open` → `pick_reveal` → `favourite_add`.
That's the value chain: did they show up? Did they tap a café? Did they
see the AI picks? Did they save anything they'd come back for? Each drop-
off step points at a specific bit of UX to investigate. We'll also see
which screens (`view_change`) people return to and whether the taste
profile and offers screens get any traction — both are bets we can prune
or double down on. The admin view in Stage 2 surfaces these aggregates.

---

## Stage 4 (Drawer) — Offers + Help-as-a-form

Two independent additions:

- **Offers** — partner coupons. Codes are hidden until the user explicitly
  "Reveals" them, which logs an intent signal (redemption counter +1) on
  the server. No partner portal — offers seeded by hand.
- **Help** — drawer Help item now opens a real contact form. Submissions
  land in a Supabase table you can read whenever.

### What changed

**Schema**
- New `offers` table with title / description / code / terms / kind / dates /
  redemption counter / `sample` flag.
- New `help_messages` table — submissions saved with optional `user_id`,
  category enum, honeypot field for spam triage.
- Both have RLS enabled: `offers` is public-read on `active = true`;
  `help_messages` has NO policies (only the service role writes/reads it).

**Server**
- `GET /api/offers` — public list of active, non-expired offers. The `code`
  column is **never returned** in the list.
- `POST /api/offers/:id/redeem` — returns `{ code, redemptions }` and bumps
  the counter. Non-atomic by design (low traffic, count is a signal not a
  billing source). Real affiliate attribution will need partner-side
  confirmation later — left as a comment in `db.js`.
- `POST /api/help` — form submission endpoint. Honeypot accepted-silently
  on spam; basic email regex check; user_id captured if a JWT is present.

**db.js**
- `listActiveOffers()`, `revealOffer(offerId)`, `saveHelpMessage(msg)`.

**UI**
- New `view-offers` reachable from drawer → **Offers near you**. Each offer
  card shows partner badge + sample/live tag + title + description + terms +
  expiry. "Reveal code" button → server roundtrip → code appears in a
  monospaced pill with a Copy button (uses the Clipboard API).
- New `view-help` reachable from drawer → **Help**. Form has name + email +
  category pills (Bug / Suggestion / Partner enquiry / Other) + message
  textarea + hidden honeypot. Success state replaces the form on submit
  with a thank-you card and "Send another" / "Back" buttons.

### Setup SQL (Supabase → SQL Editor → Run)

```sql
-- Offers
create table if not exists offers (
  id            uuid primary key default gen_random_uuid(),
  partner_name  text not null,
  title         text not null,
  description   text,
  code          text,
  terms         text,
  kind          text not null check (kind in ('cafe','brand')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  active        boolean not null default true,
  sample        boolean not null default false,
  redemptions   integer not null default 0,
  created_at    timestamptz not null default now()
);
alter table offers enable row level security;
create policy "offers_public_read"
  on offers for select using (active = true);

-- Help messages
create table if not exists help_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  email       text not null,
  category    text not null check (category in ('bug','suggestion','partner','other')),
  message     text not null,
  created_at  timestamptz not null default now()
);
alter table help_messages enable row level security;
-- No public policies — only service-role can read/write.

notify pgrst, 'reload schema';
```

### Seed: 3 sample offers (clearly labelled, easy to delete)

```sql
insert into offers (partner_name, title, description, code, terms, kind, ends_at, sample)
values
  ('Carmela Coffee', 'Buy 1, get 1 cortado — weekday mornings',
   'Double up before 10 AM. Tip your barista with the saving.',
   'DEMO-CORTADO-BOGO',
   'Weekdays only, before 10 AM. One redemption per visit.',
   'cafe', now() + interval '60 days', true),
  ('Tiki Coffee & Desserts', '10% off any pastry',
   'Kunafa is calling.', 'DEMO-TIKI10',
   'Show this code at checkout. Cannot combine with other offers.',
   'cafe', now() + interval '60 days', true),
  ('Roastery House', '20% off whole-bean orders',
   'Stock the home brew kit.', 'DEMO-BEANS20',
   'Online only. One use per customer.',
   'brand', now() + interval '90 days', true);
```

**To add a real offer later, run this with the right values:**

```sql
insert into offers (partner_name, title, description, code, terms, kind, ends_at)
values ('<partner>', '<title>', '<desc>', '<code>', '<terms>', 'cafe', '2026-12-31');
```

### Render / env vars

No new env vars.

---

## Stage 3 (Drawer) — Settings (units, location, notifications, clear-data)

A real Settings page in the drawer with per-user preferences (Supabase when
logged in, localStorage when logged out) and a destructive "clear my data"
action.

### What changed

**Schema**
- New `user_settings` table — one row per user, fields are loose (text /
  bool) so it's easy to grow.
  - `units` — `'mi'` or `'km'`
  - `notifications` — bool placeholder (no notification system wired yet)
- RLS scoped to `auth.uid() = user_id`.

**Server**
- `GET /api/settings` → `{ settings }` (auth required, returns defaults if
  no row yet).
- `PUT /api/settings` → upserts; whitelist coerces inputs (`units` to
  `'mi'/'km'`, `notifications` to bool).
- `POST /api/clear-data` → DELETEs the user's rows from `favourites`,
  `taste_profiles`, and `user_settings`. Account stays alive.

**db.js**
- `getUserSettings(userId)` (returns defaults if no row).
- `saveUserSettings(userId, settings)`.
- `clearUserData(userId)` — wipes the three tables in parallel, returns
  `{ favourites, taste, settings }` counts/flags.

**UI**
- New `view-settings` reachable from drawer → **Settings**. (The
  **Privacy & location** drawer item also routes here, since location
  permission lives in this page.)
- Sections:
  1. **Preferences** — Units pill toggle (mi/km), Notifications switch.
  2. **Location** — current `navigator.permissions` status as a coloured
     pill (granted / ask each time / denied), helper text shifts when
     denied, "Update my location" button that calls `locateMe()`.
  3. **Data** — destructive "Clear my data" button with a `confirm()` step.
- Preferences save automatically on change (no submit button). Account
  users hit the API; logged-out users persist to
  `localStorage["jq.anonSettings"]`.
- "Clear my data" works in both modes: anon mode clears the localStorage
  keys; account mode hits `/api/clear-data` and resets local state to
  defaults. Toast confirms what was cleared.

### Setup SQL (Supabase → SQL Editor → Run)

```sql
create table if not exists user_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  units          text default 'mi',
  notifications  boolean default false,
  updated_at     timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "settings_select_own"
  on user_settings for select using (auth.uid() = user_id);

create policy "settings_modify_own"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
```

### Render / env vars

No new env vars.

---

## Stage 2 (Drawer) — Coffee taste profile + match-your-taste signal

A short 5-tap quiz the user fills in once. Stored per-user in Supabase. Used
as a *light* honest signal on café cards — never overrides ranking, never
fabricates a match.

### What changed

**Schema**
- New `taste_profiles` table, one row per user, fields are loose text so the
  quiz can evolve without migrations:
  - `roast` (light / medium / dark)
  - `milk` (black / milk / plant)
  - `strength` (mild / balanced / strong)
  - `sweetness` (none / little / sweet)
  - `adventurous` (usual / surprise)
- Row-level security so each user reads/writes only their own row.

**Server**
- New endpoints:
  - `GET  /api/taste` → `{ profile }` for the authenticated user.
  - `PUT  /api/taste` → upserts the user's profile; whitelist filters the body
    so the client can't sneak fields into the row.
- Both require `Authorization: Bearer <jwt>` (same auth as Stage 1).

**db.js**
- `getTasteProfile(userId)` and `saveTasteProfile(userId, profile)` —
  Supabase-backed with in-memory fallback for dev.

**UI**
- New `view-taste` reachable from drawer → **Coffee taste profile**.
- Logged-out gate: prompt to sign in.
- Logged-in:
  - No profile yet → quiz with 5 pill rows. Saving needs at least 3 answers.
  - Has profile → summary card showing the saved values + Edit button.
- Drawer item `taste` now navigates instead of `alert()`.

**Match-your-taste signal**
- New `tasteMatch(drink, profile)` function applies a conservative keyword
  heuristic against the pick name (`espresso` / `cortado` → dark+strong+black,
  `latte` / `cappuccino` → milky, `vanilla` / `caramel` → sweet, etc.).
- Returns `null` for generic picks like "Coffee" and any case where no
  signal aligns. **Never fabricates.**
- When a match fires, a small mint `✓ your taste` chip appears next to the
  Drink label on the café card; the pick-mini gets a faint mint inset border.
- Ranking is untouched — this is purely a visual hint.

**Seam for richer personalization (left intentionally)**
- `tasteMatch()` is the single matching surface. A future LLM-driven matcher
  (e.g. "given this user's taste vector + this pick + Wikipedia entry for the
  drink, does it match?") plugs in there. The data shape (`{ score, reasons }`)
  is what callers expect.

### Setup SQL (run once in Supabase → SQL Editor)

```sql
create table if not exists taste_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  roast        text,
  milk         text,
  strength     text,
  sweetness    text,
  adventurous  text,
  brewing      text,
  updated_at   timestamptz not null default now()
);

alter table taste_profiles enable row level security;

create policy "taste_select_own"
  on taste_profiles for select using (auth.uid() = user_id);

create policy "taste_modify_own"
  on taste_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
```

### Migration if you already created the table (Stage 2 was shipped first)

```sql
alter table taste_profiles add column if not exists brewing text;
notify pgrst, 'reload schema';
```

### Render / env vars

No new env vars. Uses the same `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` from Stage 1.

### Verification

1. Sign in (Stage 1).
2. Drawer → **Coffee taste profile**.
3. Tap one option per row, hit **Save taste profile** → toast "Taste profile saved."
4. Discover or Saved view → cards whose Drink pick aligns (e.g. Cafe Louis's
   "Espresso drinks" with a "dark + strong + black" taste) show
   `✓ your taste` next to "Drink".
5. Drawer → **Coffee taste profile** again → summary view → **Edit** lets you
   re-take the quiz with current values pre-selected.

---

## Stage 1 (Drawer) — accounts (Supabase Auth) + user-keyed favourites

This stage replaces the anonymous `client_id` favourites system with a real
account model: email + password sign-in via Supabase Auth, JWT-protected
favourites API, and a Profile page reachable from the drawer.

### What changed

**Auth model**
- Browser uses `@supabase/supabase-js@2` (loaded via CDN) with the ANON KEY
  to handle sign-up / sign-in / session. The session JWT is persisted in
  `localStorage` by the supabase-js client (default behaviour).
- Server verifies the JWT on every protected request via
  `supabase.auth.getUser(jwt)` (uses the SERVICE-ROLE client internally; the
  service-role key never leaves the server).
- New `db.js` helpers: `verifyJwt`, `listFavouritesForUser`,
  `addFavouriteForUser`, `removeFavouriteForUser`, `mergeAnonFavourites`.

**Favourites migration (BREAKING)**
- Dropped the `(client_id, place_id)` schema. Replaced with `(user_id, place_id)`
  referencing `auth.users(id) ON DELETE CASCADE`.
- Logged-OUT users save to `localStorage["jq.anonSaves"]` in the browser
  (no server roundtrip).
- On first sign-in, the client `POST`s any anon saves to
  `POST /api/favourites/merge` which upserts them into the user's account
  (best-effort; dupes ignored).
- Routes `GET / POST / DELETE /api/favourites` now require a valid JWT.
- Row-Level Security on `favourites` so a user can only see / mutate their
  own rows. This is defence-in-depth — the server already scopes queries
  by `user_id` from the verified JWT.

**Profile page**
- New `view-profile` reachable from drawer → Profile.
- Logged-out state: email + password form, tabbed Sign in / Create account,
  password autocomplete switches accordingly, inline error display.
- Logged-in state: avatar (email initials), email, member-since, saved-café
  count, "View saved" + "Sign out" CTAs.
- Drawer header updates to show the user's email + signed-in status when
  logged in.

**New endpoints**
- `GET /api/auth/config` → `{ url, anonKey }` (safe public values; the browser
  uses these to spin up its own Supabase client).
- `POST /api/favourites/merge` → upserts an array of place_ids into the
  authenticated user's account. Used on first sign-in to absorb local saves.

### New / updated env vars

| Var | Required | Where |
|---|---|---|
| `SUPABASE_URL` | Yes | Server **and** sent to browser via `/api/auth/config`. |
| `SUPABASE_ANON_KEY` | **NEW.** Yes for auth. | Sent to browser via `/api/auth/config`. Safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only. Verifies JWTs + admin DB ops. |

If `SUPABASE_ANON_KEY` is missing, the browser sees auth as "not configured"
and only the anon-saves path works (no sign-in UI).

### Supabase setup SQL (run once after creating the project)

```sql
-- The favourites schema from the previous stage is REPLACED.
drop table if exists favourites;

create table favourites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  place_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index favourites_user_idx on favourites(user_id);

-- Row-level security: a user can only read / write their own rows.
alter table favourites enable row level security;

create policy "favourites_select_own"
  on favourites for select using (auth.uid() = user_id);

create policy "favourites_modify_own"
  on favourites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The cafe_picks table from the previous stage is still useful as a
-- fallback under the snapshot. Leave it alone if it already exists.
```

In **Supabase → Auth → Providers**, make sure **Email** is enabled (it is
by default). If you want users to confirm their email before logging in,
flip the "Confirm email" toggle (the UI handles that case — it tells the
user to check their inbox).

### What to set in Render

Service → Environment → add:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` *(NEW)*
- `SUPABASE_SERVICE_ROLE_KEY`

After saving, Render redeploys. `/api/status` should report
`cache: "supabase"` and the Profile page in the drawer becomes functional.

### Security notes

- The browser only ever sees the **anon key**. That key is rate-limited and
  restricted by RLS; it's safe to be public (this is Supabase's intended use).
- The **service-role key** lives only on the server. It bypasses RLS so the
  server can do admin ops, but every user-facing query still scopes by the
  verified `user_id` from the JWT — RLS + server-side scoping = belt-and-braces.
- JWTs are short-lived (1h by default) and refreshed automatically by
  `supabase-js` from the refresh token in localStorage.
- The merge endpoint is best-effort; we don't trust the client-supplied
  place_id list to be exhaustive, just to be additive. Worst case: a few
  cafés don't get carried across.

---

## Stage 2 — backend hardening + Supabase persistence

This stage took the deployed backend from "works but leaks" to production-grade
data quality and durable caching. UI work is still pending (Stage 3).

### What changed

**Data quality (server.js)**
- Expanded the chain/non-café name blocklist (now blocks Pura Vida, Tim Hortons,
  Peet's, Krispy Kreme, Tropical Smoothie, Jamba, fast-food chains, etc.).
- Added `BAD_TYPES` filter on Google Places `types[]` to drop donut shops, fast
  food, gas stations, and convenience stores even if the name doesn't match.
- Added a **Boca Raton bounding box** (`BOCA_BOX`) — a café must be inside the
  lat/lng box (`26.32–26.43` N, `-80.22 to -80.05` W).
- Added a **`formattedAddress` check** — must contain "Boca Raton" (case-insensitive).
  Both checks must pass, so near-city results (Delray, Deerfield, Coconut Creek,
  Coral Springs) are dropped.
- Pulled `places.types`, `places.photos`, `places.regularOpeningHours`,
  `places.googleMapsUri` into the Places FieldMask so the UI has what it needs.
- List cache TTL dropped from 7d to **1h** (it's a cheap call; we want filter
  iterations to propagate fast). Pick cache stays at 7 days.

**Photo proxy (server.js)**
- New endpoint `GET /api/photo?name=places/XYZ/photos/ABC&w=800` streams the
  Google Places image binary through the server. Google key stays hidden.
- Photo name is validated against a strict regex to prevent SSRF abuse.
- `w` is clamped to `[64, 1600]`; sets a `Cache-Control: public, max-age=604800`
  so the browser caches the image for 7 days.

**Supabase persistence (db.js — new file)**
- New `cafe_picks` table caches per-café AI picks (place_id PK, payload jsonb,
  fetched_at). Read-through with 7-day TTL.
- New `favourites` table (composite PK of `client_id` + `place_id`) is the
  groundwork for user-saved cafés. Anonymous client id is sent via the
  `X-Client-Id` header (UI will generate + persist a UUID per device).
- Graceful in-memory fallback when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  are unset, so dev still works.

**New API routes (server.js)**
- `GET /api/photo?name=…&w=…` — photo proxy (above).
- `GET /api/favourites` — returns the list of place_ids the client has saved.
- `POST /api/favourites/:placeId` — add.
- `DELETE /api/favourites/:placeId` — remove.
- `GET /api/status` now also reports `cache: "supabase" | "memory-fallback"` and
  the count of cached picks.

### New env vars

| Var | Required? | Notes |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Yes | (unchanged) |
| `ANTHROPIC_API_KEY` | Yes | (unchanged) |
| `SUPABASE_URL` | Recommended | Without this, falls back to in-memory cache. |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Server-only secret — never client. |

### Supabase setup SQL

Run this in the Supabase SQL editor (Project → SQL Editor → New query) once
after creating the project:

```sql
create table if not exists cafe_picks (
  place_id    text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

create table if not exists favourites (
  client_id   text not null,
  place_id    text not null,
  created_at  timestamptz not null default now(),
  primary key (client_id, place_id)
);

create index if not exists favourites_client_idx on favourites(client_id);
```

We use the service-role key on the server, so Row Level Security (RLS) is not
required for this MVP. If/when we ever expose Supabase to the browser, enable
RLS and add explicit policies first.

### Render deployment

After this is pushed to GitHub, Render auto-redeploys. To enable persistence in
production:

1. Create a Supabase project at https://supabase.com (free tier is fine).
2. Run the SQL above in the SQL editor.
3. In Supabase: Project Settings → API → copy the **URL** and the
   **`service_role` secret** (NOT the anon key).
4. In Render: service → Environment → add `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Save → Render redeploys.
5. Hit `/api/status` and confirm `cache: "supabase"`.

Until those vars are set, the deployed app falls back to the in-memory cache —
fully functional but resets on each free-tier sleep.

### Verification checklist (post-deploy)

- `curl https://joequest.onrender.com/api/status` → `cache` field shows the
  right backing store.
- `curl https://joequest.onrender.com/api/cafes` → every result has an address
  containing "Boca Raton". No Pura Vida. No donut shops.
- Hit any café detail twice in a row — second call should be `cached: true`.
- `GET /api/photo?name=…` returns an image (where a photo is available).
