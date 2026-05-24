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
import { searchCafes } from "../lib/data.js";

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

  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\n✓  Wrote ${SNAPSHOT_PATH}`);
  console.log(`   Updated: ${updated}   Missing-from-fresh-results: ${missing}`);
  if (missing > 0) {
    console.log("   (Missing cafés keep their existing hours — they may have dropped out of Google's top-20.)");
  }
}

main().catch((e) => {
  console.error("\n❌  Failed:", e.message);
  process.exit(1);
});
