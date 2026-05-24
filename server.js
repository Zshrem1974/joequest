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
 * Café picks are persisted in Supabase (or in-memory fallback). The café LIST
 * is held in a short-TTL in-memory cache since it's cheap to refetch and we
 * want filter changes to propagate fast.
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
import Anthropic from "@anthropic-ai/sdk";
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
const MODEL = "claude-opus-4-7";
const PLACES_BASE = "https://places.googleapis.com/v1";
const CITY = "Boca Raton, FL";
const LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (cheap to refetch)

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ============================================================================
// DATA QUALITY FILTERS
// ============================================================================

// 1) Name-substring chain/non-café blocklist
const EXCLUDE_NAMES = [
  "starbucks", "dunkin", "panera", "einstein", "wawa", "mcdonald",
  "7-eleven", "circle k", "pura vida", "tim hortons", "peet",
  "krispy kreme", "tropical smoothie", "jamba", "burger king", "subway",
  "chick-fil-a", "wendy", "taco bell", "popeyes", "kfc",
];

// 2) Google Places types[] blocklist — drops non-coffee categories
const BAD_TYPES = new Set([
  "donut_shop",
  "fast_food_restaurant",
  "gas_station",
  "convenience_store",
]);

// 3) Boca Raton bounding box (lat/lng). South=Hillsboro, North=Yamato area;
//    West includes West Boca (Sandalfoot), East = coast.
const BOCA_BOX = { south: 26.32, north: 26.43, west: -80.22, east: -80.05 };

function isRealCafe(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return !EXCLUDE_NAMES.some((c) => n.includes(c));
}
function typesAreCafe(types = []) {
  return !types.some((t) => BAD_TYPES.has(t));
}
function inBoca(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return (
    lat >= BOCA_BOX.south && lat <= BOCA_BOX.north &&
    lng >= BOCA_BOX.west && lng <= BOCA_BOX.east
  );
}
function addressInBoca(addr) {
  return typeof addr === "string" && /boca\s*raton/i.test(addr);
}

// ============================================================================
// AI RECOMMENDATION
// ============================================================================
const SYSTEM_PROMPT = `You are JoeQuest's recommendation engine. Read the reviews of a single coffee shop and identify the ONE drink and ONE food item most worth ordering, based strictly on what reviewers actually say.

Rules:
- Only recommend items ACTUALLY NAMED in the reviews. Never invent a menu item. If reviewers only say "great coffee" with no specific drink, use a generic name (e.g. "House coffee") and set confidence low.
- If too few mentions to support a pick, return null for that pick with confidence "none".
- The quote must be a real phrase from the reviews, under 15 words.
- Be honest: "not enough data" beats a confident wrong answer.
- Weigh specific praise in high-star reviews most heavily.`;

const pickShape = {
  type: "object",
  properties: {
    name: { type: ["string", "null"] },
    reason: { type: "string" },
    quote: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
    mention_count: { type: "integer" },
  },
  required: ["name", "reason", "quote", "confidence", "mention_count"],
  additionalProperties: false,
};
const PICK_SCHEMA = {
  type: "object",
  properties: { drink: pickShape, food: pickShape },
  required: ["drink", "food"],
  additionalProperties: false,
};

// ============================================================================
// GOOGLE PLACES
// ============================================================================
let listCache = null; // { data, expires }
function priceToDollars(level) {
  return {
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  }[level] || "$$";
}

// Compute a human-friendly "Closes 9 PM" or "Opens 8 AM Mon" label from the
// Places opening hours object. Times are local to Boca (ET).
function fmtTime(h, m) {
  m = m || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function nowInBoca() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date());
  const dayName = parts.find((p) => p.type === "weekday").value;
  const hour = parseInt(parts.find((p) => p.type === "hour").value, 10) || 0;
  const minute = parseInt(parts.find((p) => p.type === "minute").value, 10) || 0;
  const days = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  return { dayIdx: days[dayName], minutes: hour * 60 + minute };
}
function hoursLabel(hoursObj) {
  const periods = hoursObj?.periods;
  if (!periods?.length) return null;
  const { dayIdx, minutes } = nowInBoca();
  const nowMin = dayIdx * 1440 + minutes;

  const events = periods
    .map((p) => {
      if (!p.open) return null;
      const o = p.open, c = p.close;
      let open = (o.day || 0) * 1440 + (o.hour || 0) * 60 + (o.minute || 0);
      let close;
      if (!c) close = open + 1440;
      else {
        close = (c.day || 0) * 1440 + (c.hour || 0) * 60 + (c.minute || 0);
        if (close <= open) close += 7 * 1440;
      }
      // Roll past periods forward so we can pick "next" easily
      while (close <= nowMin) { open += 7 * 1440; close += 7 * 1440; }
      return { open, close, p };
    })
    .filter(Boolean)
    .sort((a, b) => a.open - b.open);
  if (!events.length) return null;

  const cur = events.find((e) => nowMin >= e.open && nowMin < e.close);
  if (cur) {
    const c = cur.p.close;
    if (!c) return "Open 24h";
    return "Closes " + fmtTime(c.hour || 0, c.minute || 0);
  }
  const next = events.find((e) => e.open >= nowMin);
  if (!next) return null;
  const o = next.p.open;
  const openDay = Math.floor((next.open % (7 * 1440)) / 1440);
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayPart = openDay === dayIdx ? "" : " " + dayLabels[openDay];
  return "Opens " + fmtTime(o.hour || 0, o.minute || 0) + dayPart;
}
function score(c) {
  if (!c.rating || !c.reviews) return 0;
  return c.rating * c.rating * Math.log10(c.reviews + 1);
}

async function searchBocaCafes() {
  if (listCache && listCache.expires > Date.now()) return listCache.data;

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.formattedAddress",
        "places.location", "places.rating", "places.userRatingCount",
        "places.priceLevel", "places.types", "places.photos",
        "places.regularOpeningHours", "places.currentOpeningHours",
        "places.googleMapsUri",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: `coffee shops in ${CITY}`, maxResultCount: 20 }),
  });
  if (!res.ok) throw new Error(`Places search ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const cafes = (data.places || [])
    // ----- data quality gauntlet -----
    .filter((p) => isRealCafe(p.displayName?.text))
    .filter((p) => typesAreCafe(p.types))
    .filter((p) => inBoca(p.location?.latitude, p.location?.longitude))
    .filter((p) => addressInBoca(p.formattedAddress))
    // ----- shape for the client -----
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text || "Unknown",
      address: p.formattedAddress || "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating ?? null,
      reviews: p.userRatingCount ?? 0,
      price: priceToDollars(p.priceLevel),
      types: p.types || [],
      openNow: (p.currentOpeningHours ?? p.regularOpeningHours)?.openNow ?? null,
      hoursLabel: hoursLabel(p.currentOpeningHours ?? p.regularOpeningHours),
      mapsUri: p.googleMapsUri || null,
      // photo[0]'s resource name → exposed via our proxy
      photo: p.photos?.[0]?.name ? `/api/photo?name=${encodeURIComponent(p.photos[0].name)}&w=800` : null,
    }))
    .sort((a, b) => score(b) - score(a));

  listCache = { data: cafes, expires: Date.now() + LIST_CACHE_TTL_MS };
  return cafes;
}

async function getReviews(placeId) {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": GOOGLE_KEY, "X-Goog-FieldMask": "reviews" },
  });
  if (!res.ok) throw new Error(`Place details ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.reviews || [])
    .map((r) => ({ rating: r.rating ?? null, text: r.text?.text ?? r.originalText?.text ?? "" }))
    .filter((r) => r.text.trim().length > 0);
}

// ============================================================================
// CLAUDE PICKS
// ============================================================================
function nonePick() {
  return { name: null, reason: "Not enough reviews yet.", quote: null, confidence: "none", mention_count: 0 };
}

async function getPicks(name, reviews) {
  if (reviews.length === 0) return { drink: nonePick(), food: nonePick() };

  const block = reviews
    .map((r, i) => `Review ${i + 1}${r.rating ? ` (${r.rating}star)` : ""}: ${r.text}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Café: ${name}\n\nReviews:\n\n${block}` }],
    output_config: { format: { type: "json_schema", schema: PICK_SCHEMA } },
  });

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

async function enrichCafe(cafe) {
  const cached = await getCachedPick(cafe.id);
  if (cached) return { ...cafe, ...cached, cached: true };

  const reviews = await getReviews(cafe.id);
  const picks = await getPicks(cafe.name, reviews);
  const payload = { picks, reviewSample: reviews.slice(0, 3), reviewsAnalysed: reviews.length };
  await setCachedPick(cafe.id, payload);
  return { ...cafe, ...payload, cached: false };
}

// ============================================================================
// PHOTO PROXY
// ============================================================================
// The Places photo resource name looks like "places/XYZ/photos/ABC". We accept
// only that pattern to prevent the proxy from being used as an open SSRF.
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

// ============================================================================
// ROUTES
// ============================================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/cafes", async (req, res) => {
  try {
    if (!GOOGLE_KEY) return res.status(503).json({ error: "Server missing GOOGLE_PLACES_API_KEY" });
    const cafes = await searchBocaCafes();
    res.json({ city: CITY, count: cafes.length, cafes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/cafes/:id", async (req, res) => {
  try {
    if (!GOOGLE_KEY || !ANTHROPIC_KEY)
      return res.status(503).json({ error: "Server missing API keys" });
    const list = await searchBocaCafes();
    const cafe = list.find((c) => c.id === req.params.id);
    if (!cafe) return res.status(404).json({ error: "Café not found" });
    const enriched = await enrichCafe(cafe);
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/photo", streamPhoto);

// ---- favourites (anonymous client_id sent via header X-Client-Id) ----------
function clientId(req) {
  const id = (req.get("X-Client-Id") || "").trim();
  // basic shape check — keep it tight to avoid junk keys
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}
app.get("/api/favourites", async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.status(400).json({ error: "Missing or invalid X-Client-Id" });
    const ids = await listFavourites(id);
    res.json({ favourites: ids });
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
  });
});

app.listen(PORT, () => {
  console.log(`\n☕  JoeQuest live server → http://localhost:${PORT}`);
  if (!GOOGLE_KEY || !ANTHROPIC_KEY) {
    console.log("⚠️   Missing API keys — UI will load but show a setup banner.");
  }
  if (!dbReady()) {
    console.log("⚠️   Supabase not configured — using in-memory pick cache (lost on restart).");
    console.log("    Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to enable persistence.");
  }
});
