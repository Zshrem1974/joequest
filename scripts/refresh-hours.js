#!/usr/bin/env node
/*
 * scripts/refresh-hours.js — patch hours data into data/boca-snapshot.json
 *
 * Does ONE Google Places text search (~$0.005), pulls fresh hours
 * (regularOpeningHours.periods + weekdayDescriptions) for every café that
 * still appears in the current top-20 results, and merges those into the
 * existing snapshot. NO Claude calls. Picks are untouched.
 *
 * Use this when:
 *   - You just added the periods/weekdayDescriptions fields and the
 *     existing snapshot doesn't have them yet.
 *   - Hours changed at a café and you want to refresh the display without
 *     triggering the 90-day full-pull rule.
 *
 * USAGE:
 *   GOOGLE_PLACES_API_KEY=xxx node scripts/refresh-hours.js
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchCafes, hoursLabel } from "../lib/data.js";

const PLACES_BASE = "https://places.googleapis.com/v1";

// Per-place Place-Details lookup. Used only for cafés that fell out of the
// fresh top-20 search — so we still get accurate hours for ALL existing
// snapshot rows. ~$0.017 per call (Places Details).
async function fetchHoursForPlace(placeId, googleKey) {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": "regularOpeningHours,currentOpeningHours",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const h = data.regularOpeningHours ?? data.currentOpeningHours;
  if (!h) return null;
  return {
    periods: h.periods ?? null,
    weekdayDescriptions: h.weekdayDescriptions ?? null,
    openNow: h.openNow ?? null,
    hoursLabel: hoursLabel(h),
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(__dirname, "..", "data", "boca-snapshot.json");

async function main() {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleKey) {
    console.error("❌  Missing GOOGLE_PLACES_API_KEY");
    process.exit(1);
  }
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error("❌  No snapshot at", SNAPSHOT_PATH);
    process.exit(1);
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  console.log(`Existing snapshot: ${snapshot.cafes.length} cafés (generated ${snapshot.generatedAt}).`);
  console.log("Fetching fresh café list from Google Places…");

  const fresh = await searchCafes(googleKey);
  console.log(`  Got ${fresh.length} cafés back.`);
  const byId = new Map(fresh.map((c) => [c.id, c]));

  let updated = 0, missing = 0;
  snapshot.cafes = snapshot.cafes.map((old) => {
    const f = byId.get(old.id);
    if (!f) { missing++; return old; }
    updated++;
    return {
      ...old,
      openNow: f.openNow,
      hoursLabel: f.hoursLabel,
      periods: f.periods,
      weekdayDescriptions: f.weekdayDescriptions,
      // also refresh photo + mapsUri while we're here (cheap)
      photo: f.photo,
      mapsUri: f.mapsUri,
    };
  });

  // Backfill: cafés that fell out of the search but exist as known place_ids.
  // We hit Place Details for each so the snapshot stays complete.
  let backfilled = 0;
  for (const cafe of snapshot.cafes) {
    if (cafe.periods && cafe.weekdayDescriptions) continue;
    process.stdout.write(`  · ${cafe.name}  — backfilling hours via Place Details… `);
    const h = await fetchHoursForPlace(cafe.id, googleKey);
    if (!h) { console.log("✗ not found"); continue; }
    cafe.periods = h.periods;
    cafe.weekdayDescriptions = h.weekdayDescriptions;
    cafe.openNow = h.openNow;
    cafe.hoursLabel = h.hoursLabel;
    backfilled++;
    console.log("✓");
  }

  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\n✓  Wrote ${SNAPSHOT_PATH}`);
  console.log(`   Updated from search: ${updated}   Backfilled via Place Details: ${backfilled}`);
}

main().catch((e) => {
  console.error("\n❌  Failed:", e.message);
  process.exit(1);
});
