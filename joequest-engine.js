#!/usr/bin/env node
/*
 * JoeQuest Recommendation Engine — single-café test script
 * ---------------------------------------------------------
 * Pulls one Boca Raton café from Google Places, fetches its reviews,
 * asks Claude for the #1 drink + #1 food to order, and prints the result.
 *
 * USAGE:
 *   node joequest-engine.js "The Roastery Lab"
 *   node joequest-engine.js                       (defaults to a search query)
 *
 * REQUIRES two environment variables:
 *   GOOGLE_PLACES_API_KEY   - from Google Cloud (Places API New enabled)
 *   ANTHROPIC_API_KEY       - from console.anthropic.com
 *
 * Run with:  GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node joequest-engine.js
 */

import Anthropic from "@anthropic-ai/sdk";

// ----------------------------------------------------------------------------
// CONFIG
// ----------------------------------------------------------------------------
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CITY = "Boca Raton, FL";
const MODEL = "claude-opus-4-7";           // current top model
const PLACES_BASE = "https://places.googleapis.com/v1";

// The café to look up — from CLI arg, or a default search.
const QUERY = process.argv[2]
  ? `${process.argv[2]} coffee, ${CITY}`
  : `best coffee shop in ${CITY}`;

// ----------------------------------------------------------------------------
// THE RECOMMENDATION PROMPT (the JoeQuest engine brain)
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are JoeQuest's recommendation engine. Your job is to read customer reviews of a single coffee shop and identify the ONE drink and ONE food item most worth ordering, based strictly on what reviewers actually say.

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

// ----------------------------------------------------------------------------
// JSON SCHEMA for structured output — the API enforces this shape
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// STEP 1: Find the café via Google Places Text Search
// ----------------------------------------------------------------------------
async function findCafe(query) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      // Field mask: request only what we need (Google bills per field tier)
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Places search failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  if (!data.places || data.places.length === 0) {
    throw new Error(`No café found for query: "${query}"`);
  }
  return data.places[0];
}

// ----------------------------------------------------------------------------
// STEP 2: Fetch that café's reviews via Place Details
//   NOTE: Google returns only ~5 reviews per place. That is the known limit.
// ----------------------------------------------------------------------------
async function getReviews(placeId) {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "reviews",
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Place details failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  // reviews[].text.text holds the body; reviews[].rating holds the stars
  return (data.reviews || []).map((r) => ({
    rating: r.rating ?? null,
    text: r.text?.text ?? r.originalText?.text ?? "",
  })).filter((r) => r.text.trim().length > 0);
}

// ----------------------------------------------------------------------------
// STEP 3: Ask Claude for the drink + food picks
// ----------------------------------------------------------------------------
async function getPicks(client, cafeName, reviews) {
  // Build a clean, numbered review block for the model
  const reviewBlock = reviews
    .map((r, i) => `Review ${i + 1}${r.rating ? ` (${r.rating}★)` : ""}: ${r.text}`)
    .join("\n\n");

  const userMessage =
    `Café: ${cafeName}\n\n` +
    `Reviews (${reviews.length} total):\n\n${reviewBlock}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // System as an array so we can attach cache_control. Caching only kicks in
    // above the model's minimum prefix size (~1024 tokens on Opus 4.7), so
    // this prompt is right at the threshold — check usage.cache_* to confirm.
    system: [{
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: userMessage }],
    // The API enforces this schema — no need to strip ```json fences or
    // defensively try/catch JSON.parse. The first text block is guaranteed
    // to be valid JSON matching PICKS_SCHEMA.
    output_config: {
      format: { type: "json_schema", schema: PICKS_SCHEMA },
    },
  });

  // Log cache + token usage so you can see what's happening
  const u = response.usage;
  console.log(
    `    tokens: ${u.input_tokens} in / ${u.output_tokens} out` +
    `  ·  cache: ${u.cache_creation_input_tokens ?? 0} written, ${u.cache_read_input_tokens ?? 0} read`
  );

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) {
    throw new Error("Claude returned no text block.");
  }
  return JSON.parse(text);
}

// ----------------------------------------------------------------------------
// Pretty-print the result
// ----------------------------------------------------------------------------
function printResult(cafe, reviews, picks) {
  const line = "─".repeat(56);
  console.log(`\n${line}`);
  console.log(`☕  ${cafe.displayName?.text || "Unknown café"}`);
  console.log(`    ${cafe.formattedAddress || ""}`);
  console.log(
    `    ★ ${cafe.rating ?? "n/a"}  ·  ${cafe.userRatingCount ?? 0} reviews` +
    `  ·  ${"$".repeat(priceToDollars(cafe.priceLevel))}`
  );
  console.log(`    Analysed ${reviews.length} review${reviews.length === 1 ? "" : "s"} (Google's max is ~5)`);
  console.log(line);

  printPick("DRINK TO ORDER", "☕", picks.drink);
  printPick("FOOD TO ORDER", "🥐", picks.food);
  console.log(`${line}\n`);
}

function printPick(label, icon, p) {
  console.log(`\n${icon}  ${label}`);
  if (!p || p.name === null || p.confidence === "none") {
    console.log(`    — Not enough review data to recommend yet.`);
    return;
  }
  console.log(`    ${p.name}   [confidence: ${p.confidence}, ${p.mention_count} mention(s)]`);
  console.log(`    ${p.reason}`);
  if (p.quote) console.log(`    "${p.quote}"`);
}

function priceToDollars(level) {
  const map = {
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level] || 2;
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
async function main() {
  // Guard: keys must be present
  if (!GOOGLE_KEY || !ANTHROPIC_KEY) {
    console.error(
      "\n❌  Missing API keys. Set them before running:\n\n" +
      '   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node joequest-engine.js "Café name"\n'
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log(`\n🔎  Searching Google Places for: "${QUERY}"`);
  const cafe = await findCafe(QUERY);
  console.log(`✅  Found: ${cafe.displayName?.text}  (place_id: ${cafe.id})`);

  console.log(`📝  Fetching reviews…`);
  const reviews = await getReviews(cafe.id);
  console.log(`✅  Got ${reviews.length} review(s).`);

  if (reviews.length === 0) {
    console.log("\n⚠️   No reviews available — cannot generate picks for this café.\n");
    return;
  }

  console.log(`🤖  Asking Claude (${MODEL}) for the best drink + food…`);
  const picks = await getPicks(client, cafe.displayName?.text || "café", reviews);

  printResult(cafe, reviews, picks);
}

main().catch((err) => {
  console.error(`\n❌  Error: ${err.message}\n`);
  process.exit(1);
});
