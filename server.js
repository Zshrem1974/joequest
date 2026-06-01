#!/usr/bin/env node
/*
 * JoeQuest — live MVP server (Boca Raton)
 * ----------------------------------------
 * Express backend that:
 *   - serves the JoeQuest web UI (public/)
 *   - exposes GET /api/cafes        → list of Boca cafés (filtered, ranked)
 *   - exposes GET /api/cafes/:id    → single café detail w/ AI picks (cached)
 *   - exposes GET /api/photo        → photo proxy (keeps Google key off the client)
 *   - exposes GET/POST/DELETE /api/favourites
 *   - exposes GET /api/status
 *
 * API keys live HERE (server-side) and never reach the browser.
 *
 * DATA PATH (priority):
 *   1) data/boca-snapshot.json — pre-baked on disk, instant, free.
 *   2) Supabase (or in-memory fallback) per-place pick cache.
 *   3) Live Google Places + Claude (only when both above miss).
 *
 * The snapshot is the primary source. It's refreshed by scripts/snapshot.js
 * (manual or via the monthly GitHub Action). The 90-day-per-café rule lives
 * in the script, not here — this file just serves what the snapshot contains.
 *
 * RUN locally:
 *   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy \
 *   SUPABASE_URL=zzz SUPABASE_SERVICE_ROLE_KEY=aaa \
 *   node server.js
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "node:stream";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import {
  searchCafes, getReviews, getPicks, newAnthropic, PLACES_BASE, CITY,
} from "./lib/data.js";
import { CITIES, DEFAULT_CITY, cityBySlug } from "./lib/cities.js";
import {
  dbReady, dbStatus, cachedCount,
  getCachedPick, setCachedPick,
  verifyJwt,
  listFavouritesForUser, addFavouriteForUser, removeFavouriteForUser,
  mergeAnonFavourites,
  getTasteProfile, saveTasteProfile,
  getUserSettings, saveUserSettings, clearUserData,
  listActiveOffers, revealOffer, saveHelpMessage,
  saveEvent, computeEventStats,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (only relevant when snapshot missing)

const anthropic = ANTHROPIC_KEY ? newAnthropic(ANTHROPIC_KEY) : null;

// ----------------------------------------------------------------------------
// SNAPSHOT — primary data source, committed to the repo at data/boca-snapshot.json
// ----------------------------------------------------------------------------
// Multi-city snapshot loader. Reads every data/<slug>.json whose slug matches
// a known city in lib/cities.js, indexes by slug. Back-compat: also accepts
// the legacy "boca-snapshot.json" filename.
const DATA_DIR = path.join(__dirname, "data");
const snapshots = new Map(); // slug -> snapshot object
function loadSnapshots() {
  let files = [];
  try { files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")); } catch {}
  for (const file of files) {
    // accept slug.json AND legacy boca-snapshot.json
    const slug = file === "boca-snapshot.json" ? "boca-raton" : file.replace(/\.json$/, "");
    if (!cityBySlug(slug)) continue;
    try {
      const obj = JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8"));
      obj.citySlug = obj.citySlug || slug;
      // ensure every cafe carries its city slug
      (obj.cafes || []).forEach((c) => { c.city = c.city || slug; });
      snapshots.set(slug, obj);
      console.log(`☕  Snapshot[${slug}]: ${obj.cafes?.length ?? 0} cafés, ${Object.keys(obj.picks || {}).length} picks (gen ${obj.generatedAt ?? "?"})`);
    } catch (e) {
      console.log(`⚠️   Failed to load ${file}: ${e.message}`);
    }
  }
}
loadSnapshots();

// Back-compat alias — older code paths referenced `snapshot` (singular, Boca).
const snapshot = snapshots.get("boca-raton") || null;
function getSnapshotForCafe(cafeId) {
  for (const s of snapshots.values()) {
    if (s.picks?.[cafeId]) return s;
  }
  return null;
}

// ----------------------------------------------------------------------------
// LIVE FALLBACK CACHES (only consulted when snapshot doesn't have an answer)
// ----------------------------------------------------------------------------
let listCache = null; // short-TTL in-memory list cache for live fallback

// Returns ALL cafés from every snapshot we have, each tagged with `city` slug.
function allCafesFromSnapshots() {
  const out = [];
  for (const [slug, s] of snapshots) {
    for (const c of (s.cafes || [])) out.push({ ...c, city: c.city || slug });
  }
  return out;
}
// Resolve a city slug → its cafés. Falls back to the default city, then to
// a live Places call. `slug` may be null/undefined.
async function getCafeList(slug) {
  // ?all=1
  if (slug === "__all__") return allCafesFromSnapshots();
  const wanted = slug ? (cityBySlug(slug) || DEFAULT_CITY) : DEFAULT_CITY;
  const s = snapshots.get(wanted.slug);
  if (s?.cafes?.length) return s.cafes;
  if (listCache && listCache.slug === wanted.slug && listCache.expires > Date.now()) return listCache.data;
  const cafes = await searchCafes(GOOGLE_KEY, wanted);
  listCache = { slug: wanted.slug, data: cafes, expires: Date.now() + LIST_CACHE_TTL_MS };
  return cafes;
}

async function enrichCafe(cafe) {
  // 1) Snapshot — instant, free. Look across ALL city snapshots.
  const ownerSnap = getSnapshotForCafe(cafe.id);
  const snap = ownerSnap?.picks?.[cafe.id];
  if (snap?.picks) return { ...cafe, ...snap, cached: true, source: "snapshot" };

  // 2) Per-place pick cache (Supabase or memory).
  const cached = await getCachedPick(cafe.id);
  if (cached) return { ...cafe, ...cached, cached: true };

  // 3) Cold path — Google Places + Claude.
  if (!anthropic) throw new Error("Server missing ANTHROPIC_API_KEY");
  const reviews = await getReviews(cafe.id, GOOGLE_KEY);
  const picks = await getPicks(anthropic, cafe.name, reviews);
  const payload = {
    picks,
    reviewSample: reviews.slice(0, 3),
    reviewsAnalysed: reviews.length,
    fetched_at: new Date().toISOString(),
  };
  await setCachedPick(cafe.id, payload);
  return { ...cafe, ...payload, cached: false };
}

// ----------------------------------------------------------------------------
// PHOTO PROXY
// ----------------------------------------------------------------------------
// Places photo resource names look like "places/XYZ/photos/ABC". Only that
// pattern is allowed so the proxy can't be coerced into open SSRF.
const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

async function streamPhoto(req, res) {
  if (!GOOGLE_KEY) return res.status(503).send("Missing Google key");
  const name = String(req.query.name || "");
  if (!PHOTO_NAME_RE.test(name)) return res.status(400).send("Bad photo name");

  let w = parseInt(req.query.w, 10);
  if (!Number.isFinite(w) || w < 64 || w > 1600) w = 800;

  const url = `${PLACES_BASE}/${name}/media?maxWidthPx=${w}&key=${GOOGLE_KEY}`;
  const upstream = await fetch(url);
  if (!upstream.ok) return res.status(upstream.status).send(`Photo ${upstream.status}`);

  res.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
  res.set("Cache-Control", "public, max-age=604800"); // 7d browser cache
  Readable.fromWeb(upstream.body).pipe(res);
}

// ----------------------------------------------------------------------------
// ROUTES
// ----------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// List endpoint:
//   /api/cafes                 → default city (Boca)
//   /api/cafes?city=delray-beach
//   /api/cafes?all=1           → all cities flat, each cafe tagged with city
app.get("/api/cafes", async (req, res) => {
  try {
    const all = req.query.all === "1" || req.query.all === "true";
    const slug = all ? "__all__" : (typeof req.query.city === "string" ? req.query.city : null);
    const cafes = await getCafeList(slug);
    const cityCfg = all ? null : (cityBySlug(slug || "") || DEFAULT_CITY);
    res.json({
      city: cityCfg ? cityCfg.displayName : "All cities",
      citySlug: cityCfg ? cityCfg.slug : "__all__",
      count: cafes.length,
      cafes,
      // generatedAt only meaningful when scoped to one city
      generatedAt: cityCfg ? snapshots.get(cityCfg.slug)?.generatedAt ?? null : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /api/cities — list of cities we have data for (for the dropdown)
app.get("/api/cities", (req, res) => {
  res.json({
    cities: CITIES.map((c) => ({
      slug: c.slug,
      name: c.name,
      displayName: c.displayName,
      state: c.state,
      center: c.center,
      bbox: c.bbox,
      hasSnapshot: snapshots.has(c.slug),
      cafeCount: snapshots.get(c.slug)?.cafes?.length ?? 0,
    })),
  });
});

app.get("/api/cafes/:id", async (req, res) => {
  try {
    // Look across every snapshot first (id is globally unique = Google place_id)
    let cafe = null;
    for (const s of snapshots.values()) {
      const found = (s.cafes || []).find((c) => c.id === req.params.id);
      if (found) { cafe = found; break; }
    }
    if (!cafe) {
      // Fallback: try the default-city live list
      const list = await getCafeList(null);
      cafe = list.find((c) => c.id === req.params.id);
    }
    if (!cafe) return res.status(404).json({ error: "Café not found" });
    const enriched = await enrichCafe(cafe);
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/photo", streamPhoto);

// ---- zipcode → lat/lng (Stage C) ------------------------------------------
// Resolve a US 5-digit zip to its centroid via Google Places text search.
// Cheap: one Places call, ~$0.005. Used by the zipcode override UI to set the
// distance-sort origin without requiring browser geolocation permission.
app.get("/api/zip/:zip", async (req, res) => {
  if (!GOOGLE_KEY) return res.status(503).json({ error: "Server missing GOOGLE_PLACES_API_KEY" });
  const zip = String(req.params.zip || "").trim();
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: "5-digit ZIP required" });
  try {
    const r = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "places.location,places.formattedAddress,places.displayName,places.types",
      },
      body: JSON.stringify({ textQuery: `ZIP ${zip} USA`, maxResultCount: 1 }),
    });
    if (!r.ok) throw new Error(`Places ${r.status}: ${await r.text()}`);
    const d = await r.json();
    const p = d.places?.[0];
    if (!p?.location) return res.status(404).json({ error: "ZIP not found" });
    res.json({
      zip,
      lat: p.location.latitude,
      lng: p.location.longitude,
      address: p.formattedAddress || null,
      name: p.displayName?.text || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- auth config (safe public values for the browser) ---------------------
// Browser uses these to spin up its own Supabase client (anon key + URL).
// The service-role key NEVER leaves the server.
app.get("/api/auth/config", (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL || null,
    anonKey: process.env.SUPABASE_ANON_KEY || null,
  });
});

// MAPTILER_KEY is a client-side tile key (domain-restrict it in MapTiler's dashboard).
// GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY never leave this server.
app.get("/api/config", (_req, res) => {
  res.json({ maptilerKey: process.env.MAPTILER_KEY || "" });
});

// ---- auth helper: extract & verify the user from the Authorization header --
async function authedUser(req) {
  const h = req.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return await verifyJwt(h.slice(7).trim());
}

// ---- favourites (user-keyed, JWT-authed) ----------------------------------
// All four routes require a logged-in user. Anonymous saves live in the
// browser's localStorage and are merged in via POST /api/favourites/merge
// on first sign-in.
app.get("/api/favourites", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to view saved cafés" });
    res.json({ favourites: await listFavouritesForUser(user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/favourites/:placeId", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to save cafés" });
    await addFavouriteForUser(user.id, req.params.placeId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/favourites/:placeId", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to manage saved cafés" });
    await removeFavouriteForUser(user.id, req.params.placeId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Move anonymous localStorage saves into the freshly-signed-in user's account.
// Best-effort: dupes are ignored by the upsert.
app.post("/api/favourites/merge", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first" });
    const placeIds = Array.isArray(req.body?.placeIds) ? req.body.placeIds : [];
    const merged = await mergeAnonFavourites(user.id, placeIds);
    res.json({ ok: true, merged });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- taste profile (Stage 2) ----------------------------------------------
// Whitelist what the client can write; ignore anything else. Loose strings,
// not enums — the quiz can evolve without a migration.
const TASTE_FIELDS = ["roast", "milk", "strength", "sweetness", "adventurous", "brewing"];

app.get("/api/taste", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see your taste profile" });
    res.json({ profile: await getTasteProfile(user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/taste", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to save your taste profile" });
    const body = req.body || {};
    const clean = {};
    for (const k of TASTE_FIELDS) {
      if (typeof body[k] === "string" && body[k].length > 0 && body[k].length <= 32) {
        clean[k] = body[k];
      }
    }
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "Empty profile" });
    }
    const saved = await saveTasteProfile(user.id, clean);
    res.json({ ok: true, profile: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- settings (Stage 3) ---------------------------------------------------
app.get("/api/settings", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to load your settings" });
    res.json({ settings: await getUserSettings(user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/settings", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to save your settings" });
    const body = req.body || {};
    const clean = {
      units: body.units === "km" ? "km" : "mi",
      notifications: !!body.notifications,
    };
    const saved = await saveUserSettings(user.id, clean);
    res.json({ ok: true, settings: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Destructive: wipes favourites + taste profile + settings for the user.
// The account itself stays alive (managed by Supabase Auth).
app.post("/api/clear-data", async (req, res) => {
  try {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first" });
    const result = await clearUserData(user.id);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- offers (Stage 4) -----------------------------------------------------
// Public list (no auth needed). Codes are stripped — clients must explicitly
// reveal an offer to see the code, which also bumps the redemption counter.
app.get("/api/offers", async (req, res) => {
  try {
    res.json({ offers: await listActiveOffers() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/offers/:id/redeem", async (req, res) => {
  try {
    const result = await revealOffer(req.params.id);
    if (!result) return res.status(404).json({ error: "Offer not found or expired" });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- help / contact form (Stage 4) ----------------------------------------
const HELP_CATEGORIES = ["bug", "suggestion", "partner", "other"];
app.post("/api/help", async (req, res) => {
  try {
    const body = req.body || {};
    // Honeypot: spam bots fill hidden fields. Accept silently to avoid hints.
    if (typeof body.honeypot === "string" && body.honeypot.length > 0) {
      return res.json({ ok: true });
    }
    const user = await authedUser(req);
    const name = String(body.name || "").trim().slice(0, 80);
    const email = String(body.email || "").trim().slice(0, 200);
    const category = HELP_CATEGORIES.includes(body.category) ? body.category : "other";
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required." });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email." });
    }
    await saveHelpMessage({
      user_id: user?.id || null,
      name, email, category, message,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- events (Instrumentation Stage 1) -------------------------------------
// Allow-list keeps the schema small and PII-clean. Anything outside this set
// is dropped on the floor. Never throws to the client.
const EVENT_ALLOWLIST = new Set([
  "app_open",
  "view_change",
  "cafe_open",
  "pick_reveal",
  "favourite_add",
  "favourite_remove",
  "taste_profile_complete",
  "offer_reveal",
  "help_submit",
  "signin",
  "signup",
  "share",
]);
const CID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const PROPS_MAX_BYTES = 1024;

// ---- admin gate + admin stats (Instrumentation Stage 2) -------------------
// Simple shared-secret gate via the ADMIN_TOKEN env var. Header takes priority,
// query string is the fallback so you can open /admin?token=… in a browser.
function adminAllowed(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const got = req.get("X-Admin-Token") || req.query?.token || "";
  if (typeof got !== "string" || got.length === 0) return false;
  // Constant-time-ish compare. Strings of different length always reject.
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

app.get("/api/admin/stats", async (req, res) => {
  if (!adminAllowed(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const days = Math.max(1, Math.min(30, parseInt(req.query?.days, 10) || 7));
    res.json(await computeEventStats({ days }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// /admin — render the dashboard page. The file lives OUTSIDE /public so the
// static middleware can't accidentally serve it without the token.
app.get("/admin", (req, res) => {
  if (!adminAllowed(req)) {
    return res
      .status(401)
      .type("text/plain")
      .send("Unauthorized.\n\nAppend ?token=YOUR_ADMIN_TOKEN to the URL.");
  }
  res.sendFile(path.join(__dirname, "admin-views", "admin.html"));
});

app.post("/api/event", async (req, res) => {
  // Acknowledge immediately so the browser never waits on us.
  res.status(204).end();
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!EVENT_ALLOWLIST.has(name)) return;

    const client_id = String(b.client_id || "").trim();
    if (!CID_RE.test(client_id)) return;

    const path = b.path ? String(b.path).trim().slice(0, 64) : null;

    let props = null;
    if (b.props && typeof b.props === "object" && !Array.isArray(b.props)) {
      let s;
      try { s = JSON.stringify(b.props); } catch { return; }
      if (s.length > PROPS_MAX_BYTES) return; // silently drop oversized
      props = b.props;
    }

    // JWT path (header). sendBeacon can also embed a token in the body
    // because it can't set custom headers — accept that as a fallback.
    let user = await authedUser(req);
    if (!user && typeof b.token === "string" && b.token.length > 20) {
      user = await verifyJwt(b.token);
    }

    await saveEvent({
      client_id,
      user_id: user?.id || null,
      name,
      props,
      path,
    });
  } catch {
    // Swallow — analytics must not break the UI, and we've already 204'd.
  }
});

app.get("/api/status", async (req, res) => {
  res.json({
    ok: true,
    google: !!GOOGLE_KEY,
    anthropic: !!ANTHROPIC_KEY,
    cache: dbStatus(),
    cachedPicks: await cachedCount(),
    listCached: !!(listCache && listCache.expires > Date.now()),
    snapshots: Array.from(snapshots.entries()).map(([slug, s]) => ({
      slug,
      cafes: s.cafes?.length ?? 0,
      picks: Object.keys(s.picks || {}).length,
      generatedAt: s.generatedAt ?? null,
    })),
  });
});

app.listen(PORT, () => {
  console.log(`\n☕  JoeQuest live server → http://localhost:${PORT}`);
  if (!snapshot && (!GOOGLE_KEY || !ANTHROPIC_KEY)) {
    console.log("⚠️   No snapshot AND missing API keys — UI will load but show a setup banner.");
  }
  if (!dbReady()) {
    console.log("ℹ️   Supabase not configured — favourites use in-memory fallback (lost on restart).");
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    console.log("ℹ️   SUPABASE_ANON_KEY not set — browser auth (sign-in/sign-up) will be disabled.");
  }
});
