# CHANGES

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
