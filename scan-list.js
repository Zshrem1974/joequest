#!/usr/bin/env node
/*
 * JoeQuest — scan a curated list of Boca Raton cafés and curate city-wide picks.
 * --------------------------------------------------------------------------
 * For each café: fetch reviews from Google Places, ask Claude for the best
 * drink + best food. Then a final curation pass picks the single best drink
 * and single best food across the whole city.
 *
 * USAGE:
 *   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node scan-list.js
 *   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node scan-list.js --limit 5
 *
 * FLAGS:
 *   --limit N   only process the first N cafés (smoke test before full run)
 */

import Anthropic from "@anthropic-ai/sdk";

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CITY = "Boca Raton, FL";
const MODEL = "claude-opus-4-7";
const PLACES_BASE = "https://places.googleapis.com/v1";
const CONCURRENCY = 4; // parallel café lookups

// Parse --limit
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

// Curated café list (Boca Raton, FL — chains/restaurants/bakeries filtered out)
const CAFES = [
  "Belladukes",
  "Cafe Louis Coffee & Espresso Bar",
  "CAFÉ CHÉRI",
  "Cali Coffee",
  "Carmela Coffee Uptown Boca",
  "Carmela Coffee BRiC",
  "Carmela Coffee East Boca",
  "Carmela Coffee Park Place",
  "Colombian Coffee House 495 NE 20th St",
  "Colombian Coffee House 12 SE 5th Ave",
  "Côte France",
  "Crema Gourmet Mizner",
  "Dolce Café",
  "Espresso Joint",
  "Foxtail Coffee West Boca",
  "Foxtail Coffee Boca Valley",
  "Kixi Cafe",
  "La Boulangerie Boul'Mich",
  "La Mesa Café Bistro",
  "Le Petit Parisian Cafe",
  "Living Green Cafe",
  "Long Story Short Cafe",
  "Maison Brunch Boca Raton",
  "Mane Coffee",
  "Rosalia's Botanical Cafe",
  "Saquella Cafe",
  "Subculture Coffee Mizner",
  "the seed Coffee Juice Bar Yamato",
  "the seed Coffee Juice Bar Palmetto",
  "The Pots Cafe",
  "Third Place Coffee Lounge",
  "Tiki Coffee and Desserts",
  "Tin Muffin Cafe",
  "VI Coffee Bar",
];

// --------------------------------------------------------------------------
// PROMPTS + SCHEMAS
// --------------------------------------------------------------------------
const PER_CAFE_SYSTEM = `You are JoeQuest's recommendation engine. Your job is to read customer reviews of a single coffee shop and identify the ONE drink and ONE food item most worth ordering, based strictly on what reviewers actually say.

You will receive the café name and a list of review texts (each with its star rating if available).

Your task:
1. Scan every review for mentions of specific drinks and specific food items.
2. For each item, weigh: how often it is mentioned, how positive the sentiment is, and how specific the praise is ("best cortado I've had" counts far more than "coffee was fine"). A specific rave in a 5-star review outweighs a vague mention in a 3-star one.
3. Pick the single best-supported DRINK and the single best-supported FOOD.
4. Extract one short, real quote from the reviews that supports each pick.
5. Assign a confidence level to each pick.

CRITICAL RULES:
- Only recommend items that are ACTUALLY NAMED in the reviews. Never invent or guess a menu item. If reviewers only say "great coffee" with no specific drink named, the drink confidence is "low" and the name should be generic (e.g. "House coffee") — do not fabricate a specialty drink.
- If there are too few mentions to support a pick (e.g. zero food mentioned), return null for that pick's name and quote and set confidence to "none".
- The supporting quote must be a real phrase from the provided reviews, truncated to under 15 words. Never write a quote that is not in the source text.
- Be honest. A trustworthy "we don't have enough reviews yet" is better than a confident wrong answer.`;

const pickSchema = {
  type: "object",
  properties: {
    name:          { anyOf: [{ type: "string" }, { type: "null" }] },
    reason:        { type: "string" },
    quote:         { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence:    { type: "string", enum: ["high", "medium", "low", "none"] },
    mention_count: { type: "integer" },
  },
  required: ["name", "reason", "quote", "confidence", "mention_count"],
  additionalProperties: false,
};
const PICKS_SCHEMA = {
  type: "object",
  properties: { drink: pickSchema, food: pickSchema },
  required: ["drink", "food"],
  additionalProperties: false,
};

const CURATE_SYSTEM = `You are JoeQuest's city-wide curator. You receive a list of cafés in one city, each with its best drink pick and best food pick (with confidence levels and short quotes from reviewers).

Your job: pick the SINGLE best drink in the entire city and the SINGLE best food in the entire city — the items most worth a special trip.

How to weigh:
1. Confidence first. A "high" confidence pick from one café outranks a "medium" from another, even if the medium sounds tastier.
2. Specificity of praise. "Best flat white in Boca" outranks "good coffee".
3. Mention count. More reviewers naming the item → stronger signal.
4. Tie-break on distinctiveness — favor items that are signature to one shop over generic items available everywhere.

For each city-wide pick, name the café it's at, the item, why it won, and the strongest supporting quote (a real phrase from the per-café data — do not invent).`;

const cityPickSchema = {
  type: "object",
  properties: {
    cafe:   { type: "string" },
    item:   { type: "string" },
    reason: { type: "string" },
    quote:  { type: "string" },
  },
  required: ["cafe", "item", "reason", "quote"],
  additionalProperties: false,
};
const CITY_SCHEMA = {
  type: "object",
  properties: { drink: cityPickSchema, food: cityPickSchema },
  required: ["drink", "food"],
  additionalProperties: false,
};

// --------------------------------------------------------------------------
// GOOGLE PLACES
// --------------------------------------------------------------------------
async function findCafe(query) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.rating",
        "places.userRatingCount",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Places search failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.places?.length) throw new Error(`No place found for: "${query}"`);
  return data.places[0];
}

async function getReviews(placeId) {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "reviews",
    },
  });
  if (!res.ok) throw new Error(`Place details failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.reviews || [])
    .map((r) => ({ rating: r.rating ?? null, text: r.text?.text ?? r.originalText?.text ?? "" }))
    .filter((r) => r.text.trim().length > 0);
}

// --------------------------------------------------------------------------
// CLAUDE CALLS
// --------------------------------------------------------------------------
async function getPicks(client, cafeName, reviews) {
  const block = reviews
    .map((r, i) => `Review ${i + 1}${r.rating ? ` (${r.rating}★)` : ""}: ${r.text}`)
    .join("\n\n");
  const userMessage = `Café: ${cafeName}\n\nReviews (${reviews.length} total):\n\n${block}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: PER_CAFE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: { type: "json_schema", schema: PICKS_SCHEMA } },
  });

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no text block.");
  return { picks: JSON.parse(text), usage: response.usage };
}

async function curate(client, perCafeResults) {
  const block = perCafeResults
    .filter((r) => r.picks)
    .map((r, i) => {
      const d = r.picks.drink;
      const f = r.picks.food;
      const dline = d?.name
        ? `  drink: ${d.name} (${d.confidence}, ${d.mention_count}× mentions) — "${d.quote ?? ""}"`
        : `  drink: (none)`;
      const fline = f?.name
        ? `  food: ${f.name} (${f.confidence}, ${f.mention_count}× mentions) — "${f.quote ?? ""}"`
        : `  food: (none)`;
      return `${i + 1}. ${r.displayName}\n${dline}\n${fline}`;
    })
    .join("\n\n");

  const userMessage = `City: ${CITY}\n\nPer-café picks (${perCafeResults.length} cafés):\n\n${block}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: CURATE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: { type: "json_schema", schema: CITY_SCHEMA } },
  });

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no text block.");
  return { city: JSON.parse(text), usage: response.usage };
}

// --------------------------------------------------------------------------
// PER-CAFE PIPELINE
// --------------------------------------------------------------------------
async function scanOne(client, name) {
  const query = `${name}, ${CITY}`;
  try {
    const cafe = await findCafe(query);
    const reviews = await getReviews(cafe.id);
    if (reviews.length === 0) {
      return { name, displayName: cafe.displayName?.text ?? name, status: "no-reviews" };
    }
    const { picks, usage } = await getPicks(client, cafe.displayName?.text ?? name, reviews);
    return {
      name,
      displayName: cafe.displayName?.text ?? name,
      address: cafe.formattedAddress,
      rating: cafe.rating,
      ratingCount: cafe.userRatingCount,
      reviewCount: reviews.length,
      picks,
      usage,
      status: "ok",
    };
  } catch (err) {
    return { name, displayName: name, status: "error", error: err.message };
  }
}

// Simple concurrency-limited map
async function parallelMap(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// --------------------------------------------------------------------------
// PRINT
// --------------------------------------------------------------------------
function printPerCafe(r) {
  const line = "─".repeat(64);
  if (r.status !== "ok") {
    console.log(`\n${line}\n☕  ${r.displayName}  — ${r.status}${r.error ? `: ${r.error}` : ""}\n${line}`);
    return;
  }
  console.log(`\n${line}`);
  console.log(`☕  ${r.displayName}    ★ ${r.rating ?? "?"} · ${r.ratingCount ?? 0} reviews`);
  console.log(`    ${r.address ?? ""}`);
  const d = r.picks.drink;
  const f = r.picks.food;
  console.log(
    `    DRINK: ${d?.name ?? "—"}  [${d?.confidence ?? "none"}, ${d?.mention_count ?? 0}×]` +
    (d?.quote ? `  "${d.quote}"` : "")
  );
  console.log(
    `    FOOD:  ${f?.name ?? "—"}  [${f?.confidence ?? "none"}, ${f?.mention_count ?? 0}×]` +
    (f?.quote ? `  "${f.quote}"` : "")
  );
}

function printCity(city, totalCafes) {
  const line = "═".repeat(64);
  console.log(`\n${line}`);
  console.log(`🏆  BOCA RATON — CITY-WIDE PICKS  (curated from ${totalCafes} cafés)`);
  console.log(line);
  console.log(`\n☕  BEST DRINK IN BOCA`);
  console.log(`    ${city.drink.item}  @  ${city.drink.cafe}`);
  console.log(`    ${city.drink.reason}`);
  console.log(`    "${city.drink.quote}"`);
  console.log(`\n🥐  BEST FOOD IN BOCA`);
  console.log(`    ${city.food.item}  @  ${city.food.cafe}`);
  console.log(`    ${city.food.reason}`);
  console.log(`    "${city.food.quote}"`);
  console.log(`\n${line}\n`);
}

// --------------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------------
async function main() {
  if (!GOOGLE_KEY || !ANTHROPIC_KEY) {
    console.error(
      "\n❌  Missing API keys. Both required:\n\n" +
      "   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node scan-list.js\n"
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const list = CAFES.slice(0, LIMIT);

  console.log(`\n🔎  Scanning ${list.length} café(s) in ${CITY} (concurrency ${CONCURRENCY})…\n`);

  const t0 = Date.now();
  const results = await parallelMap(list, CONCURRENCY, async (name, i) => {
    process.stdout.write(`  [${i + 1}/${list.length}] ${name}…\n`);
    return scanOne(client, name);
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Per-café output
  for (const r of results) printPerCafe(r);

  const ok = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status !== "ok");

  console.log(`\n📊  Scanned ${ok.length}/${results.length} successfully in ${elapsed}s.`);
  if (failed.length) {
    console.log(`    Failures: ${failed.map((f) => `${f.name} (${f.status})`).join(", ")}`);
  }

  if (ok.length === 0) {
    console.error("\n❌  No successful picks to curate.\n");
    process.exit(1);
  }

  // City-wide curation
  console.log(`\n🤖  Asking Claude to curate the city-wide best drink & food…`);
  const { city, usage } = await curate(client, ok);
  console.log(
    `    tokens: ${usage.input_tokens} in / ${usage.output_tokens} out` +
    `  ·  cache: ${usage.cache_creation_input_tokens ?? 0} written, ${usage.cache_read_input_tokens ?? 0} read`
  );

  printCity(city, ok.length);
}

main().catch((err) => {
  console.error(`\n❌  Fatal: ${err.message}\n`);
  process.exit(1);
});
