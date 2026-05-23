#!/usr/bin/env node
/*
 * JoeQuest Engine — OFFLINE TEST (no Google API key needed)
 * ----------------------------------------------------------
 * Tests the recommendation BRAIN on reviews you paste in yourself.
 * Only needs an Anthropic API key — no Google Places key required.
 *
 * HOW TO GET REAL REVIEWS WITHOUT THE API:
 *   1. Open Google Maps in your browser, search a real Boca café.
 *   2. Copy a handful of review texts.
 *   3. Paste them into the `reviews` array below (replace the samples).
 *   4. Run it.
 *
 * USAGE:
 *   ANTHROPIC_API_KEY=yyy node test-offline.js
 */

import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-opus-4-7";

// ============================================================================
// EDIT THIS: paste a real Boca Raton café's name + reviews here.
// These samples are placeholders — swap in real ones copied from Google Maps.
// ============================================================================
const cafeName = "Subculture Coffee (Boca)";
const reviews = [
  { rating: 5, text: "Best flat white in Boca, hands down. The baristas really know their craft and the space is gorgeous." },
  { rating: 5, text: "Came for the cold brew and stayed for hours. Their avocado toast is also surprisingly good and generous." },
  { rating: 4, text: "Solid coffee, the flat white is excellent. A bit pricey but worth it. Gets crowded on weekends." },
  { rating: 5, text: "The flat white and a slice of their banana bread is my go-to order every Saturday morning." },
  { rating: 3, text: "Nice vibe but service was slow. The latte was fine, nothing special." },
];
// ============================================================================

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

// JSON schema the API enforces on the response.
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

async function getPicks(client, name, revs) {
  const block = revs
    .map((r, i) => `Review ${i + 1}${r.rating ? ` (${r.rating}★)` : ""}: ${r.text}`)
    .join("\n\n");
  const userMessage = `Café: ${name}\n\nReviews (${revs.length} total):\n\n${block}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // Cached so re-runs while you iterate are cheaper. Caching only kicks
    // in above the model's minimum prefix size (~1024 tokens on Opus 4.7),
    // so this prompt is right at the threshold — check the usage line.
    system: [{
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: userMessage }],
    // API enforces this shape — first text block is guaranteed valid JSON.
    output_config: {
      format: { type: "json_schema", schema: PICKS_SCHEMA },
    },
  });

  const u = response.usage;
  console.log(
    `    tokens: ${u.input_tokens} in / ${u.output_tokens} out` +
    `  ·  cache: ${u.cache_creation_input_tokens ?? 0} written, ${u.cache_read_input_tokens ?? 0} read`
  );

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no text block.");
  return JSON.parse(text);
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

async function main() {
  if (!ANTHROPIC_KEY) {
    console.error("\n❌  Missing ANTHROPIC_API_KEY.\n\n   ANTHROPIC_API_KEY=yyy node test-offline.js\n");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log(`\n🤖  Running JoeQuest engine on ${reviews.length} reviews for "${cafeName}"…`);
  const picks = await getPicks(client, cafeName, reviews);

  const line = "─".repeat(56);
  console.log(`\n${line}\n☕  ${cafeName}\n${line}`);
  printPick("DRINK TO ORDER", "☕", picks.drink);
  printPick("FOOD TO ORDER", "🥐", picks.food);
  console.log(`${line}\n`);
}

main().catch((err) => {
  console.error(`\n❌  Error: ${err.message}\n`);
  process.exit(1);
});
