#!/usr/bin/env node
/*
 * JoeQuest — live MVP server (Boca Raton)
 * ----------------------------------------
 * Express backend that:
 *   - serves the JoeQuest web UI (public/)
 *   - exposes GET /api/cafes        → list of Boca cafés with AI picks
 *   - exposes GET /api/cafes/:id    → single café detail (cached)
 *
 * API keys live HERE (server-side) and never reach the browser.
 * Results are cached in memory with a 7-day TTL to keep API costs low.
 *
 * RUN:
 *   npm install
 *   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node server.js
 *   → open http://localhost:3000
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-opus-4-7";
const PLACES_BASE = "https://places.googleapis.com/v1";
const CITY = "Boca Raton, FL";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ---- simple in-memory cache (swap for Supabase/Redis in production) --------
const cache = new Map(); // key -> { data, expires }
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  cache.delete(key);
  return null;
}
function cacheSet(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// ---- chains / non-cafés to filter out (curation taste = the moat) ----------
const EXCLUDE = [
  "starbucks", "dunkin", "panera", "einstein", "wawa", "mcdonald",
  "7-eleven", "circle k",
];
function isRealCafe(name) {
  const n = name.toLowerCase();
  return !EXCLUDE.some((c) => n.includes(c));
}

// ---- the recommendation prompt (anti-hallucination guardrails) -------------
const SYSTEM_PROMPT = `You are JoeQuest's recommendation engine. Read the reviews of a single coffee shop and identify the ONE drink and ONE food item most worth ordering, based strictly on what reviewers actually say.

Rules:
- Only recommend items ACTUALLY NAMED in the reviews. Never invent a menu item. If reviewers only say "great coffee" with no specific drink, use a generic name (e.g. "House coffee") and set confidence low.
- If too few mentions to support a pick, return null for that pick with confidence "none".
- The quote must be a real phrase from the reviews, under 15 words.
- Be honest: "not enough data" beats a confident wrong answer.
- Weigh specific praise in high-star reviews most heavily.`;

const PICK_SCHEMA = {
  type: "object",
  properties: {
    drink: {
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
    },
    food: {
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
    },
  },
  required: ["drink", "food"],
  additionalProperties: false,
};

// ---- Google Places: search Boca cafés --------------------------------------
async function searchBocaCafes() {
  const cached = cacheGet("boca:list");
  if (cached) return cached;

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.formattedAddress",
        "places.location", "places.rating", "places.userRatingCount",
        "places.priceLevel",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: `coffee shops in ${CITY}`, maxResultCount: 20 }),
  });
  if (!res.ok) throw new Error(`Places search ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const cafes = (data.places || [])
    .filter((p) => isRealCafe(p.displayName?.text || ""))
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text || "Unknown",
      address: p.formattedAddress || "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating ?? null,
      reviews: p.userRatingCount ?? 0,
      price: priceToDollars(p.priceLevel),
    }))
    // JoeQuest ranking: rating² × log(reviews) — quality weighted by volume
    .sort((a, b) => score(b) - score(a));

  cacheSet("boca:list", cafes);
  return cafes;
}
function score(c) {
  if (!c.rating || !c.reviews) return 0;
  return c.rating * c.rating * Math.log10(c.reviews + 1);
}
function priceToDollars(level) {
  return { PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" }[level] || "$$";
}

// ---- Google Places: reviews for one café -----------------------------------
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

// ---- Claude: the drink + food pick (schema-enforced) -----------------------
async function getPicks(name, reviews) {
  if (reviews.length === 0) {
    return { drink: nonePick(), food: nonePick() };
  }
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
function nonePick() {
  return { name: null, reason: "Not enough reviews yet.", quote: null, confidence: "none", mention_count: 0 };
}

// ---- one café, fully enriched (cached) -------------------------------------
async function enrichCafe(cafe) {
  const key = `boca:pick:${cafe.id}`;
  const cached = cacheGet(key);
  if (cached) return { ...cafe, ...cached, cached: true };

  const reviews = await getReviews(cafe.id);
  const picks = await getPicks(cafe.name, reviews);
  const enriched = { picks, reviewSample: reviews.slice(0, 3), reviewsAnalysed: reviews.length };
  cacheSet(key, enriched);
  return { ...cafe, ...enriched, cached: false };
}

// ============================ ROUTES ========================================
app.use(express.static(path.join(__dirname, "public")));

// list — fast (no per-café Claude call); picks load on demand
app.get("/api/cafes", async (req, res) => {
  try {
    if (!GOOGLE_KEY) return res.status(503).json({ error: "Server missing GOOGLE_PLACES_API_KEY" });
    const cafes = await searchBocaCafes();
    res.json({ city: CITY, count: cafes.length, cafes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// single café detail — runs the AI pick (cached 7 days)
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

// health + key status (so the UI can show a helpful banner if keys are missing)
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    google: !!GOOGLE_KEY,
    anthropic: !!ANTHROPIC_KEY,
    cachedCafes: cache.size,
  });
});

app.listen(PORT, () => {
  console.log(`\n☕  JoeQuest live server → http://localhost:${PORT}`);
  if (!GOOGLE_KEY || !ANTHROPIC_KEY) {
    console.log("⚠️   Missing API keys — UI will load but show a setup banner.");
    console.log("    Run with: GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node server.js\n");
  }
});
