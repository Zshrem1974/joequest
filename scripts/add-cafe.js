#!/usr/bin/env node
/*
 * scripts/add-cafe.js — add a single café to data/boca-snapshot.json
 *
 * For cafés Google's "coffee shops in Boca Raton" search doesn't surface
 * in its top-20 (size cap), this lets us pull them in by name.
 *
 * USAGE:
 *   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy \
 *   node scripts/add-cafe.js "Rosalia's Botanical Cafe"
 *
 * What it does:
 *   1. Places text-search for "<name>, Boca Raton, FL", takes the first hit
 *   2. Runs the same data-quality filters as the main snapshot
 *   3. Fetches reviews + asks Claude for the drink/food picks (~$0.04)
 *   4. Appends/replaces in the snapshot, re-sorts by ranking
 *   5. Writes the file
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACES_BASE,
  isRealCafe, typesAreCafe, priceToDollars, hoursLabel, score,
  getReviews, getPicks, newAnthropic,
} from "../lib/data.js";
import { CITIES, cityBySlug } from "../lib/cities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cityArg = process.argv.find((a) => a.startsWith("--city="));
const citySlug = cityArg ? cityArg.split("=")[1] : "boca-raton";
const CITY_CFG = cityBySlug(citySlug);
if (!CITY_CFG) {
  console.error(`❌  Unknown city slug "${citySlug}". Known: ${CITIES.map((c) => c.slug).join(", ")}`);
  process.exit(1);
}
const SNAPSHOT_PATH = path.resolve(__dirname, "..", "data", `${citySlug}.json`);

const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.location", "places.rating", "places.userRatingCount",
  "places.priceLevel", "places.types", "places.photos",
  "places.regularOpeningHours", "places.currentOpeningHours",
  "places.googleMapsUri",
].join(",");

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('Usage: node scripts/add-cafe.js "Cafe Name"');
    process.exit(1);
  }
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!googleKey || !anthropicKey) {
    console.error("Need GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY");
    process.exit(1);
  }
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error("No snapshot found at", SNAPSHOT_PATH);
    process.exit(1);
  }

  console.log(`Searching Google Places for: "${query}, ${CITY_CFG.displayName}"`);
  const r = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: `${query}, ${CITY_CFG.displayName}`, maxResultCount: 5 }),
  });
  if (!r.ok) throw new Error(`Places search ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const place = data.places?.[0];
  if (!place) {
    console.error("❌  No match");
    process.exit(1);
  }
  console.log(`  → ${place.displayName?.text}`);
  console.log(`    ${place.formattedAddress}`);
  console.log(`    ★ ${place.rating ?? "—"} · ${place.userRatingCount ?? 0} reviews · types: ${(place.types || []).join(", ")}`);

  // Apply the same filters; warn rather than refusing in case user wants to override.
  const fName  = isRealCafe(place.displayName?.text);
  const fTypes = typesAreCafe(place.types);
  const lat = place.location?.latitude, lng = place.location?.longitude;
  const b = CITY_CFG.bbox;
  const fBox = typeof lat === "number" && typeof lng === "number"
    && lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
  const fAddr = CITY_CFG.addressRegex.test(place.formattedAddress || "");
  console.log(`    filters: name=${fName} types=${fTypes} bbox=${fBox} address=${fAddr}`);
  if (!fName || !fTypes || !fBox || !fAddr) {
    console.log("⚠️   Filter failure — adding anyway because you asked. Tweak filters if this is consistent.");
  }

  const h = place.regularOpeningHours ?? place.currentOpeningHours;
  const cafe = {
    city: CITY_CFG.slug,
    id: place.id,
    name: place.displayName?.text || "Unknown",
    address: place.formattedAddress || "",
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? 0,
    price: priceToDollars(place.priceLevel),
    types: place.types || [],
    openNow: h?.openNow ?? null,
    hoursLabel: hoursLabel(h),
    periods: h?.periods ?? null,
    weekdayDescriptions: h?.weekdayDescriptions ?? null,
    mapsUri: place.googleMapsUri || null,
    photo: place.photos?.[0]?.name
      ? `/api/photo?name=${encodeURIComponent(place.photos[0].name)}&w=800`
      : null,
  };

  console.log(`\nFetching reviews + generating Claude picks…`);
  const reviews = await getReviews(cafe.id, googleKey);
  console.log(`  reviews: ${reviews.length}`);
  const anthropic = newAnthropic(anthropicKey);
  const picks = await getPicks(anthropic, cafe.name, reviews);

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const idx = snapshot.cafes.findIndex((c) => c.id === cafe.id);
  if (idx >= 0) {
    snapshot.cafes[idx] = cafe;
    console.log(`  (replaced existing entry at index ${idx})`);
  } else {
    snapshot.cafes.push(cafe);
    snapshot.count = snapshot.cafes.length;
  }
  snapshot.picks[cafe.id] = {
    picks,
    reviewSample: reviews.slice(0, 3),
    reviewsAnalysed: reviews.length,
    fetched_at: new Date().toISOString(),
  };
  snapshot.cafes.sort((a, b) => score(b) - score(a));

  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\n✓  Added to snapshot. Total cafés: ${snapshot.cafes.length}`);
  console.log(`   drink: ${picks.drink?.name || "—"}  [${picks.drink?.confidence || "none"}]`);
  console.log(`   food:  ${picks.food?.name || "—"}  [${picks.food?.confidence || "none"}]`);
}

main().catch((e) => { console.error("\n❌  Failed:", e.message); process.exit(1); });
