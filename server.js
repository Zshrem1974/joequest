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
import { readFileSync, existsSync } from "node:fs";
import {
  searchCafes, getReviews, getPicks, newAnthropic, PLACES_BASE, CITY,
} from "./lib/data.js";
import {
  dbReady, dbStatus, cachedCount,
  getCachedPick, setCachedPick,
  listFavourites, addFavourite, removeFavourite,
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
const SNAPSHOT_PATH = path.join(__dirname, "data", "boca-snapshot.json");
let snapshot = null;
try {
  if (existsSync(SNAPSHOT_PATH)) {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    const cafeCount = snapshot.cafes?.length ?? 0;
    const pickCount = Object.keys(snapshot.picks || {}).length;
    console.log(`☕  Snapshot loaded: ${cafeCount} cafés, ${pickCount} picks (generated ${snapshot.generatedAt ?? "?"}).`);
  }
} catch (e) {
  console.log(`⚠️   Failed to load snapshot: ${e.message}`);
  snapshot = null;
}

// ----------------------------------------------------------------------------
// LIVE FALLBACK CACHES (only consulted when snapshot doesn't have an answer)
// ----------------------------------------------------------------------------
let listCache = null; // short-TTL in-memory list cache for live fallback

async function getCafeList() {
  if (snapshot?.cafes?.length) return snapshot.cafes;
  if (listCache && listCache.expires > Date.now()) return listCache.data;
  const cafes = await searchCafes(GOOGLE_KEY);
  listCache = { data: cafes, expires: Date.now() + LIST_CACHE_TTL_MS };
  return cafes;
}

async function enrichCafe(cafe) {
  // 1) Snapshot — instant, free.
  const snap = snapshot?.picks?.[cafe.id];
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

app.get("/api/cafes", async (req, res) => {
  try {
    const cafes = await getCafeList();
    res.json({
      city: CITY,
      count: cafes.length,
      cafes,
      generatedAt: snapshot?.generatedAt ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/cafes/:id", async (req, res) => {
  try {
    const list = await getCafeList();
    const cafe = list.find((c) => c.id === req.params.id);
    if (!cafe) return res.status(404).json({ error: "Café not found" });
    const enriched = await enrichCafe(cafe);
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/photo", streamPhoto);

// ---- favourites (anonymous client_id via X-Client-Id header) --------------
function clientId(req) {
  const id = (req.get("X-Client-Id") || "").trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}
app.get("/api/favourites", async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.status(400).json({ error: "Missing or invalid X-Client-Id" });
    res.json({ favourites: await listFavourites(id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/favourites/:placeId", async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.status(400).json({ error: "Missing or invalid X-Client-Id" });
    await addFavourite(id, req.params.placeId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/favourites/:placeId", async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.status(400).json({ error: "Missing or invalid X-Client-Id" });
    await removeFavourite(id, req.params.placeId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/status", async (req, res) => {
  res.json({
    ok: true,
    google: !!GOOGLE_KEY,
    anthropic: !!ANTHROPIC_KEY,
    cache: dbStatus(),
    cachedPicks: await cachedCount(),
    listCached: !!(listCache && listCache.expires > Date.now()),
    snapshot: snapshot
      ? {
          loaded: true,
          cafes: snapshot.cafes?.length ?? 0,
          picks: Object.keys(snapshot.picks || {}).length,
          generatedAt: snapshot.generatedAt ?? null,
        }
      : { loaded: false },
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
});
