# CHANGES

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
