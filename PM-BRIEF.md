You're joining the JoeQuest project as PM-in-the-loop. Get up to speed and help drive what we build next.

## What JoeQuest is

A recommendation engine that reads a coffee shop's Google reviews and names the ONE drink and ONE food item most worth ordering at each café. Per-café picks roll up into city-wide "best of" awards. Picks come from Claude (Opus 4.7) with JSON-schema-enforced structured output. There is a live, deployed web MVP covering **6 South-Florida cities**: Boca Raton, Delray Beach, Boynton Beach, Deerfield Beach, Fort Lauderdale, Miami.

## Where the project is right now — LIVE

- **Public URL:** https://joequest.onrender.com
- **Source:** https://github.com/Zshrem1974/joequest
- Hosted on Render (free tier, deployed via `render.yaml` blueprint).
- Verified live: `/api/status` reports a `snapshots[]` array (one entry per
  city, all loaded from disk). `/api/cafes?city=<slug>` returns that
  city's cafés; `/api/cafes?all=1` returns the flat union (89 cafés total).
  `/api/cities` powers the dropdown. Warm response ~190 ms.

Coverage: **89 cafés across 6 cities** (Boca 20, Delray 15, Boynton 11,
Deerfield 9, Fort Lauderdale 18, Miami 16).

## Build artifacts (~/joequest/)

Engine / CLI: `test-offline.js`, `joequest-engine.js`, `scan-list.js`, `recurate.js`.
Live app:
- `server.js` (Express API: list, detail, photo proxy, favourites, taste, auth-config, status, **cities, zip→latlng**; multi-snapshot loader)
- `lib/data.js` (shared data layer: filters, Google Places, Claude pick, hours label; **city-parameterized**)
- `lib/cities.js` (**6 FL city configs**: slug, bbox, center, addressRegex, searchQuery; `nearestCity()` helper)
- `public/index.html` (vanilla-JS UI, single page, **nine views** + city dropdown / ZIP override / distance lines; loads `supabase-js` from CDN for browser-side auth)
- `public/img/` (brand SVGs: lockup, favicon, app icon, standalone pin; PNG: JoeQuester marker)
- `db.js` (Supabase: JWT verify, user-keyed favourites, taste profiles, user settings, offers, help messages. In-memory fallback for dev.)

Snapshot pipeline (one file per city):
- `data/boca-raton.json`, `delray-beach.json`, `boynton-beach.json`,
  `deerfield-beach.json`, `fort-lauderdale.json`, `miami.json` — each
  has café metadata + picks + **periods + weekdayDescriptions** + per-
  place `fetched_at` + `citySlug`.
- `scripts/snapshot.js --city=<slug>` — full refresh with the 90-day
  rule, `--force` + `--dry-run`. Defaults to `boca-raton`.
- `scripts/refresh-hours.js` — cheap hours-only refresh (~$0.005 + per-
  place Details backfill), no Claude.
- `scripts/add-cafe.js "<name>"` — manually add a single café that
  Google's top-20 search misses.
- `.github/workflows/snapshot.yml` — monthly cron + manual dispatch.
  (Currently still single-city; needs the city-matrix update — see
  next-steps.)

Admin / analytics:
- `admin-views/admin.html` — gated dashboard (events, funnel, by-day, by-name, by-view)
- `events` table in Supabase — privacy-light fire-and-forget analytics

Deploy: `render.yaml`, `fly.toml`, `.gitignore`, `DEPLOY.md`, `CHANGES.md`.

## Architecture (load-bearing)

- Model `claude-opus-4-7` with `output_config.format = { type: "json_schema", schema }` — schema-valid JSON guaranteed.
- Anti-hallucination guardrails: only items literally named in reviews; verbatim quote <15 words; null + confidence "none" when thin.
- Two-stage curation: per-café picks → city curator (confidence > specificity > mentions > distinctiveness).
- Ranking: `rating² × log10(reviews)`.
- Keys server-side ONLY. Never in browser, repo, or client.
- **Data path (priority order):**
  1. `data/boca-snapshot.json` — pre-baked file, instant, free.
  2. Supabase / in-memory cache (per-`place_id` pick).
  3. Live Google Places + Claude call (only when both fall through).
- Photo proxy at `/api/photo` keeps the Google key out of the browser.

## Snapshot model — the MVP refresh policy (LOCKED)

The deployed app serves entirely from `data/boca-snapshot.json` (committed
to the repo). This means **zero API cost per browse** — Render free-tier
sleep doesn't matter, the snapshot survives every wake / redeploy.

### The 90-day-per-café rule (locked decisions)

| Decision | Choice |
|---|---|
| Clock scope | **Per café.** Each `place_id` has its own `fetched_at`. |
| What a "pull" includes | **Whole pipeline** — Google place metadata, reviews, and the Claude drink/food picks, all stored together. |
| Enforcement | **Hard block in `scripts/snapshot.js`.** Refuses to re-pull a café whose `fetched_at` is <90 days old. `--force` flag overrides for emergencies. |
| Trigger | **Scheduled monthly via GitHub Action.** Manual override via `workflow_dispatch` (with optional force) and via running the script locally. |

This means a café's picks change at most every 90 days. We trust that reviews
don't shift meaningfully on shorter timescales, and we want stable picks so
users can rely on the recommendation. AI tokens spent only when the data is
stale OR a new café appears in Google's results.

### How to refresh

**Automatic:** `.github/workflows/snapshot.yml` runs on the 1st of each month
at 09:00 UTC. It runs the script (90-day rule enforced) and opens a PR with
the JSON diff. A human reviews and merges.

**Manual:**
```bash
GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node scripts/snapshot.js
# --force   re-pull every café
# --dry-run show what would change without writing
```

Required repo secrets for the Action: `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`.

### What the rule changes practically

- **Adding a café:** new cafés that appear in Google's top-20 list get pulled on the next refresh — they have no `fetched_at`, so they're always considered stale.
- **Removing a chain false-positive:** add to `EXCLUDE_NAMES` in `lib/data.js`, re-run snapshot, commit.
- **Dropping a café that no longer passes filters** (closed, renamed to a chain, moved out of Boca): automatic — the script tracks `stats.dropped` and they're absent from the new snapshot.
- **Editing a single café's picks** (e.g., reviewers got it wrong): hand-edit `data/boca-snapshot.json` — the schema is flat and obvious. Bump that café's `fetched_at` so the script doesn't immediately overwrite your edit.

## Multi-city — not yet, deliberately

When we add the second city the snapshot pattern generalizes:

- `data/{city-slug}.json` per city.
- Server reads all snapshots at startup, routes by `?city=` param.
- The same GitHub Action runs per-city snapshots in a matrix.

That design lives in the head; it's the *next-step* once we have demand. **Do
not generalize until we know whether deep-Boca beats broad-anywhere on
engagement.**

## Locked product decisions

- **Surface/user:** mobile-web for locals & tourists. The verdict ("go here, order this") is the differentiator vs. a directory.
- **Moat:** curation taste for now (deep-on-Boca). Community / multi-source review aggregation are stronger but phase-2 — revisit deliberately, don't drift.
- **Data freshness for MVP:** per-café 90-day clock, scheduled monthly refresh via GitHub Action with PR review. (Documented in the snapshot model section above.)

## UI & brand state (what's actually shipped)

The deployed app implements nine screens with the brand palette and
Poppins / Inter typography. **Every drawer item is now functional** —
no more `alert()` placeholders.

- **Discover** — header lockup, "Coffee Quest Begins" greeting, **city
  dropdown + ZIP override** in the city-bar (geolocation > ZIP > last city
  > Boca for first-timers; persisted via `localStorage["jq.lastCity"]`),
  mini-map with brand pins + rating pills, ranked café card list with rank
  badges, **live-computed open/closed status** (from each café's
  `periods[]` + current ET time — accurate regardless of snapshot age, no
  Google live call), heart-save, photo via the photo proxy, two-up
  Drink/Food strip, **"📍 1.4 mi away" distance line** (only when an
  origin is set, using mi/km from Settings), **"Today: 8 AM – 9 PM" line**
  at the bottom of each card. **Drink pick shows a mint `✓ your taste`
  chip** when it matches the user's coffee taste profile (honest, never
  fabricated). Typing a 5-digit ZIP disables the city dropdown and re-
  sorts all 89 cafés across the 6 cities by distance from the ZIP centroid.
- **Map** — Google-Maps-style interaction:
  - viewBox-based zoom (1×–5×) with `+` / `−` controls
  - drag-to-pan once zoomed in
  - **pins keep a constant pixel size** as the map zooms (counter-scaled
    against viewBox zoom)
  - **red JQ-shaped "You" pin** at the user's lat/lng (geolocation; defaults
    to Boca centre)
  - locate-me button that pans + zooms to your position
  - filter chips: rating (cycles 4.0/4.5/4.8), open-now, price ($/$$/$$$),
    JoeQuesters (toggles the purple smiley-cup markers)
  - legend below the map: Café · You · JoeQuesters
- **Café detail bottom sheet** — hero photo, "AI read N reviews" banner,
  confidence-tinted Drink + Food cards (high = mint, medium = star-gold,
  low = crema), reviewer quote, mention count, Open in Maps / Directions
  CTAs, **full weekly hours table** at the bottom with today's row
  highlighted in crema-orange.
- **Saved** — favourites with empty state + nudge. Account-backed when
  signed in; localStorage when signed out; anon saves merge into the
  account on first sign-in.
- **Profile** (Stage 1) — tabbed Sign in / Create account form, **Forgot
  password?** link that fires `auth.resetPasswordForEmail`, dedicated
  "Set a new password" form rendered on `PASSWORD_RECOVERY` events.
  Signed-in state shows avatar, email, member-since, saved-café count,
  View saved + Sign out.
- **Coffee taste profile** (Stage 2) — 6-question pill quiz: roast, milk,
  strength, sweetness, adventurousness, **brewing method** (8 options each
  with a one-line description that appears when selected). Summary card +
  Edit affordance once saved.
- **Settings** (Stage 3) — three sections:
  - *Preferences* — units pill toggle (mi/km), notifications iOS-style
    switch (placeholder for the notification system).
  - *Location* — current `navigator.permissions` state as a coloured pill
    (granted / ask each time / denied) + "Update my location" button that
    re-runs the geolocation prompt.
  - *Data* — destructive "Clear my data" with a `confirm()` step (wipes
    favourites + taste profile + settings; account stays alive).
  - Preferences auto-save on change. Account users go to Supabase;
    logged-out users persist to `localStorage["jq.anonSettings"]`.
- **Offers** (Stage 4) — list of branded partner-coupon cards. Each card has
  the partner name, kind tag (Café offer / Brand offer), sample-vs-live
  badge, title, description, terms, expiry, redemption count. **Codes are
  hidden** until the user taps "Reveal code", which fires a server
  roundtrip that bumps the redemption counter and returns the code in a
  monospaced pill with a Copy button (Clipboard API). 3 sample offers
  seeded by hand.
- **Help** (Stage 4) — proper contact form: name + email + category pills
  (Bug / Suggestion / Partner enquiry / Other) + message textarea. Hidden
  honeypot input for basic spam triage; server validates email shape;
  submissions land in `help_messages` with optional `user_id`. Success
  state swaps the form for a thank-you card.
- **Slide-out drawer** — every item now navigates to a real screen:
  Profile, Coffee taste profile *(AI tag)*, Offers, Become a JQ partner,
  Settings, Privacy & location (routes to Settings), Help. Header shows
  user email + initials when logged in.
- **Partner page** — two offer types (Café placement $49/mo, Brand offers
  from $250/campaign) + the coffee-only sponsorship policy box.

Brand assets: `joequest-lockup.svg` in the header, `favicon.svg` in the tab,
`joequest-app-icon.svg` for iOS install, `joequest-icon.svg` paths used for
the café and "You" map pins (orange + red), `joequester-marker.png` for the
purple JoeQuesters markers and the filter chip icon.

## Accounts, taste profile & data privacy

**Auth (Stage 1):** Supabase Auth with email + password. Browser holds the
JWT via `supabase-js`'s localStorage; server verifies via the service-role
client's `auth.getUser(jwt)`. Service-role key never leaves the server.
Anon-key + URL are public values (delivered via `/api/auth/config`).

**Per-user tables (all RLS-protected on `auth.uid() = user_id`):**
- `favourites(user_id, place_id, created_at)` — composite PK, FK to
  `auth.users(id) ON DELETE CASCADE`.
- `taste_profiles(user_id, roast, milk, strength, sweetness, adventurous,
  brewing, updated_at)` — single row per user, loose text columns so the
  quiz can evolve without migrations.
- `user_settings(user_id, units, notifications, updated_at)` — single row
  per user; preferences (Stage 3).

**Shared tables (not per-user):**
- `offers(id, partner_name, title, description, code, terms, kind,
  starts_at, ends_at, active, sample, redemptions, created_at)` — public
  SELECT on `active = true` via RLS, codes never returned by the list
  endpoint, no INSERT/UPDATE policies (only the service-role writes).
- `help_messages(id, user_id?, name, email, category, message,
  created_at)` — RLS on, no public policies; only the service-role
  inserts/reads. `user_id` references `auth.users(id) ON DELETE SET NULL`.
- `cafe_picks(place_id, payload jsonb, fetched_at)` — legacy pick cache
  from before the snapshot model; still works as a fallback under the
  snapshot.

**Analytics tables (server-only RLS — service-role writes/reads):**
- `events(id, client_id, user_id?, name, props jsonb, path, created_at)` —
  fire-and-forget allow-listed events from the browser (`app_open`,
  `view_change`, `cafe_open`, `pick_reveal`, `favourite_add/remove`,
  `taste_profile_complete`, `offer_reveal`, `help_submit`, `signin`,
  `signup`). No PII; the only identifiers are `client_id` (random
  localStorage UUID) and the user's Supabase id. `POST /api/event`
  returns 204 immediately.
- Admin dashboard at `/admin?token=…` (gated by `ADMIN_TOKEN`) renders
  funnel, by-day, by-name, by-view aggregates. Page lives **outside
  `/public`** so the static handler can't serve it without the token.

**Taste-match seam:** `tasteMatch(drink, profile)` in `public/index.html` is
the single matching surface. Conservative — generic picks ("Coffee") never
match; multi-axis (roast, strength, milk, sweetness, adventurousness,
brewing); never overrides ranking. **Future LLM-driven personalization
plugs in there as a drop-in replacement.**

## Cost shape (current)

| Action | Cost |
|---|---|
| Anyone browsing the live site | **$0** |
| Free-tier sleep / wake / redeploy | **$0** |
| Refresh Boca snapshot (one-time, on demand) | ~$0.80 Claude + a few cents Google |
| Live fallback (snapshot missing / new city not yet snapshotted) | ~$0.09 / café |

The Google trial credit ($300 / 90 days) is effectively untouchable at this
spend rate.

## NEXT STEPS — ordered, actionable

**Drawer build sequence (4 stages, ALL SHIPPED):**
- ~~Stage 1 — Accounts (Supabase Auth, user-keyed favourites)~~ ✅
- ~~Stage 2 — Coffee taste profile (6-question quiz, match-your-taste chips)~~ ✅
- ~~Stage 3 — Settings (units, location, notifications, clear-my-data)~~ ✅
- ~~Stage 4 — Offers (with redemption tracking) + Help-as-a-form~~ ✅

**General platform follow-ups:**
1. **Restrict the Google API key (~10 min, security).** Cloud Console →
   Credentials → API restrictions: Places API (New) only. Application
   restrictions: HTTP referrers → `joequest.onrender.com/*`. Set a budget
   alert.
2. **Add GitHub Actions secrets (~5 min).** Repo → Settings → Secrets and
   variables → Actions → `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`.
   Without these the monthly snapshot cron will fail.
3. **Custom domain (optional, ~30 min + DNS).** If you own `joequest.app`,
   CNAME → Render. Step 5 in `DEPLOY.md`.
4. **Fork — decide from real usage, not now:**
   a. `/quest` onboarding flow — "where are you → the one best café + its
      pick." Stronger 5-second hook than a list. ~2 days.
   b. Real map plotting — replace placeholder positions with true lat/lng on
      a tile layer (Maps JS or Mapbox). Cost/complexity higher.
5. **Aggregate beyond Google (1–2 wks, biggest moat lever).** Yelp /
   TripAdvisor / Reddit to break the ~5-review ceiling. Needs legal review
   (ToS) before building.
6. **Multi-city snapshot matrix (when we add city #2).** See "Multi-city"
   section above.

## Env vars (current, after all four drawer stages)

| Var | Required | Where |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Yes | Server. Snapshot script + photo proxy + live fallback. |
| `ANTHROPIC_API_KEY` | Yes | Server. Snapshot script + live fallback. |
| `SUPABASE_URL` | Yes | Server **and** sent to browser via `/api/auth/config`. |
| `SUPABASE_ANON_KEY` | Yes for auth | Sent to browser. Safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only. Verifies JWTs + admin DB ops. |
| `ADMIN_TOKEN` | Yes for `/admin` | Server-only. Gates the analytics dashboard + `/api/admin/stats`. |

## Still-open strategic questions

- **Monetization** — affiliate vs. café-paid verified listing vs. premium cities.
- **Trust signals** — source-review links, reviewer-count threshold, "last refreshed" timestamp shown to users, item photos.
- **Refresh cadence per city** — weekly? monthly? when reviews shift meaningfully?
- **Extra pick axes** — best time, best seat, WFH vs. date.

## Known limitations still genuinely open

- Google's ~5-review input cap (thin sample; caps mention counts on picks).
- "High confidence" can fire on ~2 mentions (rubric weights specificity).
- No reviewer attribution / source links shown to users yet.
- **Map is a stylized SVG canvas, not a tile map.** Pin positions ARE accurate
  (real lat/lng projected into a Boca bounding box) and zoom/pan now work
  Google-Maps-style, but there's no street-level imagery. Real-map upgrade is
  step 5b above.
- **JoeQuesters markers are simulated** — the purple smiley-cup pins are
  branded but their positions are seeded (no real user-location signal yet).
- **Google's top-20 search misses good cafés.** The snapshot script feeds
  off `places:searchText` which caps at 20. Cafés at the city edge can fall
  off the list (Rosalia's, Espresso Joint — both manually re-added via
  `scripts/add-cafe.js`). Structural fix queued: add a `MUST_INCLUDE` list
  of place_ids per city to `scripts/snapshot.js` so curated picks survive
  every refresh.
- **`scripts/refresh-hours.js` and the monthly cron are still single-city.**
  They default to `boca-raton`. Need a matrix update to run per-city
  before the next 90-day refresh cycle.

## Sharing & deep linking

Every café card has a **share button** on the photo (next to the heart).
Tap → `navigator.share` on mobile (native share sheet), clipboard fallback
on desktop ("Link copied" toast). Payload is `"Try the <drink> + <food> at
<name> — JoeQuest"` plus `<origin>/?cafe=<id>`.

**Deep links** — `?cafe=<id>` on load opens that café's sheet. If the linked
café lives in a different city than the user's current one, the app calls
`selectCity()` first, then opens the sheet after the snapshot loads.
- "You" pin uses real `navigator.geolocation` when the user grants permission,
  else defaults to Boca centre.
- Single city (Boca) hardcoded — by design for MVP, see "Multi-city" above.

## Run / deploy

Local: `cd ~/joequest && npm install && GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node server.js` → http://localhost:3000
(Snapshot is loaded automatically; you don't strictly need the keys to browse, only to refresh.)

Deploy: push to GitHub repo → Render Blueprint reads `render.yaml` → set both keys as env vars. Full guide in `DEPLOY.md`; Fly alternative in `fly.toml`.

---

**Recommended immediate sequence:** (1) restrict the Google API key
(security hygiene), (2) add the two GitHub Actions secrets so the monthly
snapshot cron can run, (3) let real Boca usage decide between the
`/quest` onboarding flow and the real-tile-map upgrade. Tell me which to
start and I'll produce the exact code/diff.
