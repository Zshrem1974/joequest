You're joining the JoeQuest project as PM-in-the-loop. Get up to speed and help drive what we build next.

## What JoeQuest is

A recommendation engine that reads a coffee shop's Google reviews and names the ONE drink and ONE food item most worth ordering at each café. Per-café picks roll up into city-wide "best of" awards. Picks come from Claude (Opus 4.7) with JSON-schema-enforced structured output. There is a live, deployed web MVP for Boca Raton, FL.

## Where the project is right now — LIVE

- **Public URL:** https://joequest.onrender.com
- **Source:** https://github.com/Zshrem1974/joequest
- Hosted on Render (free tier, deployed via `render.yaml` blueprint).
- Verified live: `/api/status` -> both keys configured; `/api/cafes` -> 20 Boca cafés; `/api/cafes/:id` -> AI picks on demand, cached 7 days. Warm response ~190ms.

## Build artifacts (~/joequest/)

Engine / CLI: `test-offline.js`, `joequest-engine.js`, `scan-list.js`, `recurate.js`.
Live app: `server.js` (Express API + photo proxy), `public/index.html` (UI).
Deploy: `render.yaml`, `fly.toml`, `.gitignore`, `DEPLOY.md`.

## Architecture (unchanged, load-bearing)

- Model claude-opus-4-7 with `output_config: { format: { type: "json_schema", schema } }` — schema-valid JSON guaranteed.
- Anti-hallucination guardrails: only items literally named in reviews; verbatim quote <15 words; null + confidence "none" when thin.
- Two-stage curation: per-café picks -> city curator (confidence > specificity > mentions > distinctiveness).
- Ranking: `rating^2 x log(reviews)`.
- Keys server-side ONLY. Never in browser, repo, or client.
- Cache: in-memory Map + TTL. Resets on restart / redeploy / free-tier sleep.

## RECONCILIATION — read before building

Two limitations the prior brief listed as open were FIXED in a design session, but those
fixes may not yet be in the deployed code. Treat as VERIFY-THEN-PUSH, not "done":

1. **Chain/category filter.** Session code adds Google Places `types[]` filtering
   (drops donut shops, fast food, gas stations, convenience stores) PLUS an expanded
   name blocklist. ACTION: confirm `server.js` in the repo has `BAD_TYPES` + the longer
   `EXCLUDE` list. If not, port it and push.
2. **City-boundary enforcement.** Session code requires BOTH a Boca lat/lng bounding box
   AND `formattedAddress` containing "Boca Raton", dropping Delray/Deerfield/Coconut Creek.
   ACTION: confirm `server.js` has `BOCA_BOX`, `inBoca()`, and `addressInBoca()` applied in
   the `.filter(...)` chain. If not, port it and push.
3. **Photo proxy + full UI.** Session also built `/api/photo` and a prototype-grade UI
   (map with rating pins, combinable filters, saved, slide-out menu, partner page).
   ACTION: confirm deployed `public/index.html` is the full version, not the bare list.

QUICK TEST for items 1-2: open https://joequest.onrender.com/api/cafes — if any result
has a non-"Boca Raton" address or an obvious chain, the deployed server predates the fixes.

## Locked product decisions

- **Surface/user:** mobile-web for locals & tourists. The verdict ("go here, order this") is the differentiator vs. a directory.
- **Moat:** curation taste for now (deep-on-Boca). Community / multi-source review aggregation are stronger but phase-2 — revisit deliberately, don't drift.

## Cost shape

Single café enrichment ~$0.09 · full 34-café scan ~$3 · cached view ~$0 · re-curation ~$0.05. Inside Google's $300/90-day trial credit.

## NEXT STEPS — ordered, actionable

1. **Restrict the Google API key (DO FIRST, ~10 min, security).** Cloud Console ->
   Credentials -> the key -> API restrictions: Places API (New) only. Application
   restrictions: HTTP referrers -> `joequest.onrender.com/*`. The site is public; an
   unrestricted key is abusable. Also set a Google Cloud budget alert.
2. **Verify + push the hardened server (see RECONCILIATION).** Get `types[]` filter,
   boundary+address check, photo proxy, and full UI into the repo; let Render auto-deploy.
   Prevents the live polished UI from showing leaky data.
3. **Persist the cache to Supabase / Postgres (~1 day).** Free-tier Render SLEEPS after
   ~15 min idle; every wake/redeploy currently re-pays first-view API cost. Move the
   in-memory Map to Supabase: table `cafe_picks(place_id PK, json, fetched_at)`, read-through
   with 7-day TTL. This also becomes the foundation for real user favourites/accounts.
4. **Fork — decide from real usage, not now:**
   a. `/quest` onboarding flow — "where are you -> the one best café + its pick." Stronger
      5-second hook than a list. ~2 days.
   b. Real map plotting — replace placeholder pin positions with true lat/lng on a tile
      layer (Maps JS or Mapbox). Makes the map genuinely geographic. Cost/complexity higher.
   Watch how live users behave (confused about where to start -> 4a; want to explore the map
   -> 4b) and build the one the behavior calls for.
5. **Custom domain (optional, ~30 min + DNS).** If you own `joequest.app`, CNAME -> Render.
   Step 5 in `DEPLOY.md`.
6. **Aggregate beyond Google (1-2 wks, biggest moat lever).** Yelp/TripAdvisor/Reddit to
   break the ~5-review ceiling. Needs legal review (terms of service) before building.

## Still-open strategic questions

Monetization (affiliate vs. café-paid verified listing vs. premium cities) · data-freshness
cadence · trust signals (source links, reviewer-count threshold, "last updated", item photos)
· multi-city generalization · extra pick axes (best time, best seat, WFH vs. date).

## Known limitations still genuinely open

- Google's ~5-review input cap (thin sample; caps mention counts).
- "High confidence" can fire on ~2 mentions (rubric weights specificity).
- No reviewer attribution / source links yet.
- Map pins are placeholder positions until step 4b (no true lat/lng plotting).
- "JoeQuesters near me" dots are simulated (no real user-location layer).
- Single city (Boca) hardcoded.

## Run / deploy

Local: `cd ~/joequest && npm install && GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node server.js` -> http://localhost:3000
Deploy: push to GitHub repo -> Render Blueprint reads `render.yaml` -> set both keys as env vars. Full guide in `DEPLOY.md`; Fly alternative in `fly.toml`.

---

Recommended immediate sequence: (1) restrict the key, (2) verify+push the hardened server, (3) Supabase persistence. Then let real Boca usage decide step 4. Tell me which to start and I'll produce the exact code/diff.
