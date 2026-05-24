You're joining the JoeQuest project as PM-in-the-loop. Get up to speed and help drive what we build next.

## What JoeQuest is

A recommendation engine that reads a coffee shop's Google reviews and names the ONE drink and ONE food item most worth ordering at each café. Per-café picks roll up into city-wide "best of" awards. Picks come from Claude (Opus 4.7) with JSON-schema-enforced structured output. There is a live, deployed web MVP for Boca Raton, FL.

## Where the project is right now — LIVE

- **Public URL:** https://joequest.onrender.com
- **Source:** https://github.com/Zshrem1974/joequest
- Hosted on Render (free tier, deployed via `render.yaml` blueprint).
- Verified live: `/api/status` -> both keys configured, snapshot loaded;
  `/api/cafes` -> 19 Boca cafés (all from disk); `/api/cafes/:id` -> drink + food
  picks (all from disk, `source: "snapshot"`). Warm response ~190 ms.

## Build artifacts (~/joequest/)

Engine / CLI: `test-offline.js`, `joequest-engine.js`, `scan-list.js`, `recurate.js`.
Live app: `server.js` (Express API + photo proxy + snapshot loader),
`public/index.html` (UI), `db.js` (Supabase / in-memory cache).
Data: `data/boca-snapshot.json` — pre-baked 19 cafés + their picks (66 KB).
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

## Snapshot model — the MVP refresh policy

The deployed app serves entirely from `data/boca-snapshot.json` (committed to
the repo). This means:

- **Zero API cost per browse.** Render free-tier sleep doesn't matter — the
  snapshot file survives every wake / redeploy.
- **One-time refresh per city/coffee place.** When we want to refresh Boca
  picks, we re-run the snapshot script, commit the new JSON, push. That's
  the entire refresh ceremony for MVP.
- **Adding a café:** we don't auto-discover until we resync. The current shape
  is "Google's top 20 cafés in Boca filtered by city-boundary + types[] +
  blocklist." If a worthy new café opens, it's picked up the next time we
  re-run the snapshot.
- **Removing a chain false-positive:** add the chain name to `EXCLUDE_NAMES`
  in `server.js`, re-run snapshot, commit. (Pura Vida already in blocklist.)
- **Editing a single café's picks** (e.g., reviewers got it wrong): hand-edit
  the JSON. The schema is flat and obvious. Commit.

### How to refresh the Boca snapshot (~$0.80 of Claude, ~90 seconds)

```bash
# From the repo root, against the live server:
python3 scripts/snapshot-boca.py   # to be extracted from the inline session script
# OR ad-hoc via curl + a quick python loop against /api/cafes and /api/cafes/:id,
# saving the assembled payload into data/boca-snapshot.json.
git add data/boca-snapshot.json && git commit -m "Refresh Boca snapshot" && git push
```

Render redeploys automatically.

## Multi-city — not yet, deliberately

When we add the second city, this snapshot pattern becomes:

- `data/{city-slug}.json` per city.
- Server reads all snapshots at startup, routes by `?city=` param.
- A scheduled job (GitHub Action cron, daily) regenerates each city's snapshot and opens a PR with the diff — a human approves before it goes live.

That design lives in the head right now; it's the *next-step* once we have user
demand to leave Boca. **Do not generalize until we know whether deep-Boca beats
broad-anywhere on engagement.**

## Locked product decisions

- **Surface/user:** mobile-web for locals & tourists. The verdict ("go here, order this") is the differentiator vs. a directory.
- **Moat:** curation taste for now (deep-on-Boca). Community / multi-source review aggregation are stronger but phase-2 — revisit deliberately, don't drift.
- **Data freshness for MVP:** manual snapshot refresh, no schedule, no auto-discovery. Cheaper to operate, easier to QA, no overnight bill surprises.

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

1. **Restrict the Google API key (DO FIRST, ~10 min, security).** Cloud Console
   → Credentials → the key → API restrictions: Places API (New) only.
   Application restrictions: HTTP referrers → `joequest.onrender.com/*`.
   Also set a Google Cloud budget alert. (Snapshot saves cost but the key is
   still public on the network — a leak is still a leak.)
2. **Extract `scripts/snapshot-boca.py` (~15 min).** Right now the snapshot
   ceremony lives in an ad-hoc curl+python flow from the session. Turn it into
   a committed script so refresh is reproducible by anyone with shell access.
3. **Persist favourites to Supabase (~1 day).** Pick cache is now redundant
   because of the snapshot, but the `favourites` table is still in-memory.
   Connect Supabase (set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in
   Render's env), run the SQL in `CHANGES.md`. After that, saves survive
   the free-tier sleep.
4. **Custom domain (optional, ~30 min + DNS).** If you own `joequest.app`,
   CNAME → Render. Step 5 in `DEPLOY.md`.
5. **Fork — decide from real usage, not now:**
   a. `/quest` onboarding flow — "where are you → the one best café + its pick." Stronger 5-second hook than a list. ~2 days.
   b. Real map plotting — replace placeholder positions with true lat/lng on a tile layer (Maps JS or Mapbox). Cost/complexity higher.
6. **Aggregate beyond Google (1–2 wks, biggest moat lever).** Yelp / TripAdvisor / Reddit to break the ~5-review ceiling. Needs legal review (ToS) before building.
7. **Multi-city scheduled refresh (when we add city #2).** See "Multi-city" section above.

## Still-open strategic questions

- **Monetization** — affiliate vs. café-paid verified listing vs. premium cities.
- **Trust signals** — source-review links, reviewer-count threshold, "last refreshed" timestamp shown to users, item photos.
- **Refresh cadence per city** — weekly? monthly? when reviews shift meaningfully?
- **Extra pick axes** — best time, best seat, WFH vs. date.

## Known limitations still genuinely open

- Google's ~5-review input cap (thin sample; caps mention counts on picks).
- "High confidence" can fire on ~2 mentions (rubric weights specificity).
- No reviewer attribution / source links shown to users yet.
- **Map is a stylized canvas, not a tile map.** Pin positions ARE accurate
  (real lat/lng projected into a Boca bounding box), but there's no street-
  level imagery. Real-map upgrade is step 5b above.
- "JoeQuesters near me" dots are simulated (no real user-location layer).
- Single city (Boca) hardcoded — by design for MVP, see "Multi-city" above.

## Run / deploy

Local: `cd ~/joequest && npm install && GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node server.js` → http://localhost:3000
(Snapshot is loaded automatically; you don't strictly need the keys to browse, only to refresh.)

Deploy: push to GitHub repo → Render Blueprint reads `render.yaml` → set both keys as env vars. Full guide in `DEPLOY.md`; Fly alternative in `fly.toml`.

---

**Recommended immediate sequence:** (1) restrict the Google key, (2) extract the snapshot script, (3) wire Supabase for favourites. Then let real Boca usage decide step 5. Tell me which to start and I'll produce the exact code/diff.
