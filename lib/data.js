/*
 * lib/data.js — shared data-fetching layer used by both the live server and
 * the snapshot refresh script. Anything that hits Google Places or Anthropic
 * lives here so both call sites stay in lockstep.
 */

import Anthropic from "@anthropic-ai/sdk";

export const PLACES_BASE = "https://places.googleapis.com/v1";
export const CITY = "Boca Raton, FL";
export const MODEL = "claude-opus-4-7";

// ----------------------------------------------------------------------------
// DATA QUALITY FILTERS
// ----------------------------------------------------------------------------
export const EXCLUDE_NAMES = [
  "starbucks", "dunkin", "panera", "einstein", "wawa", "mcdonald",
  "7-eleven", "circle k", "pura vida", "tim hortons", "peet",
  "krispy kreme", "tropical smoothie", "jamba", "burger king", "subway",
  "chick-fil-a", "wendy", "taco bell", "popeyes", "kfc",
];

export const BAD_TYPES = new Set([
  "donut_shop",
  "fast_food_restaurant",
  "gas_station",
  "convenience_store",
]);

export const BOCA_BOX = { south: 26.32, north: 26.43, west: -80.22, east: -80.05 };

export function isRealCafe(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return !EXCLUDE_NAMES.some((c) => n.includes(c));
}
export function typesAreCafe(types = []) {
  return !types.some((t) => BAD_TYPES.has(t));
}
export function inBoca(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return (
    lat >= BOCA_BOX.south && lat <= BOCA_BOX.north &&
    lng >= BOCA_BOX.west && lng <= BOCA_BOX.east
  );
}
export function addressInBoca(addr) {
  return typeof addr === "string" && /boca\s*raton/i.test(addr);
}

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------
export function priceToDollars(level) {
  return {
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  }[level] || "$$";
}
export function score(c) {
  if (!c.rating || !c.reviews) return 0;
  return c.rating * c.rating * Math.log10(c.reviews + 1);
}
export function fmtTime(h, m) {
  m = m || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
export function nowInBoca() {
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
export function hoursLabel(hoursObj) {
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

// ----------------------------------------------------------------------------
// CLAUDE — prompt + schema
// ----------------------------------------------------------------------------
export const SYSTEM_PROMPT = `You are JoeQuest's recommendation engine. Read the reviews of a single coffee shop and identify the ONE drink and ONE food item most worth ordering, based strictly on what reviewers actually say.

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
export const PICK_SCHEMA = {
  type: "object",
  properties: { drink: pickShape, food: pickShape },
  required: ["drink", "food"],
  additionalProperties: false,
};

export function newAnthropic(apiKey) {
  return new Anthropic({ apiKey });
}
export function nonePick() {
  return { name: null, reason: "Not enough reviews yet.", quote: null, confidence: "none", mention_count: 0 };
}

// ----------------------------------------------------------------------------
// GOOGLE PLACES
// ----------------------------------------------------------------------------
const PLACES_FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.location", "places.rating", "places.userRatingCount",
  "places.priceLevel", "places.types", "places.photos",
  "places.regularOpeningHours", "places.currentOpeningHours",
  "places.googleMapsUri",
].join(",");

export async function searchCafes(googleKey) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: `coffee shops in ${CITY}`, maxResultCount: 20 }),
  });
  if (!res.ok) throw new Error(`Places search ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.places || [])
    .filter((p) => isRealCafe(p.displayName?.text))
    .filter((p) => typesAreCafe(p.types))
    .filter((p) => inBoca(p.location?.latitude, p.location?.longitude))
    .filter((p) => addressInBoca(p.formattedAddress))
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
      photo: p.photos?.[0]?.name
        ? `/api/photo?name=${encodeURIComponent(p.photos[0].name)}&w=800`
        : null,
    }))
    .sort((a, b) => score(b) - score(a));
}

export async function getReviews(placeId, googleKey) {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": "reviews" },
  });
  if (!res.ok) throw new Error(`Place details ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.reviews || [])
    .map((r) => ({
      rating: r.rating ?? null,
      text: r.text?.text ?? r.originalText?.text ?? "",
    }))
    .filter((r) => r.text.trim().length > 0);
}

export async function getPicks(anthropic, name, reviews) {
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
