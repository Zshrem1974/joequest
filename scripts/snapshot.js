#!/usr/bin/env node
/*
 * scripts/snapshot.js — refresh data/boca-snapshot.json
 *
 * RULES (locked by PM, see PM-BRIEF.md):
 *   1. PER CAFÉ clock. A café whose picks were fetched <90 days ago is skipped.
 *      This saves Claude tokens — we trust reviews don't shift meaningfully on
 *      sub-90-day timescales.
 *   2. A "pull" includes the whole pipeline: Google reviews + Claude picks.
 *      Both are persisted to the snapshot together.
 *   3. Hard block. Without --force, the script refuses to re-pull a fresh café.
 *
 * USAGE:
 *   GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy node scripts/snapshot.js
 *
 * FLAGS:
 *   --force      Re-pull every café regardless of age (use sparingly).
 *   --dry-run    Show what would change without writing the file.
 *
 * SCHEDULED:
 *   .github/workflows/snapshot.yml runs this monthly and opens a PR with the
 *   resulting JSON diff. A human reviews and merges.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  searchCafes, getReviews, getPicks, newAnthropic,
} from "../lib/data.js";
import { CITIES, DEFAULT_CITY, cityBySlug } from "../lib/cities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TTL_DAYS = 90;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry-run");
const cityArg = process.argv.find((a) => a.startsWith("--city="));
const citySlug = cityArg ? cityArg.split("=")[1] : "boca-raton";
const CITY_CFG = cityBySlug(citySlug);
if (!CITY_CFG) {
  console.error(`❌  Unknown city slug "${citySlug}". Known: ${CITIES.map((c) => c.slug).join(", ")}`);
  process.exit(1);
}
const SNAPSHOT_PATH = path.resolve(__dirname, "..", "data", `${citySlug}.json`);

function loadSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")); } catch { return null; }
}

function ageMs(pickEntry, fallbackDate) {
  const ts = pickEntry?.fetched_at || fallbackDate;
  if (!ts) return Infinity;
  return Date.now() - new Date(ts).getTime();
}

function daysOf(ms) {
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function main() {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!googleKey || !anthropicKey) {
    console.error("❌  Missing GOOGLE_PLACES_API_KEY or ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const anthropic = newAnthropic(anthropicKey);

  const existing = loadSnapshot();
  const existingPicks = existing?.picks || {};
  const fallbackDate = existing?.generatedAt;

  console.log(`☕  JoeQuest snapshot refresh — ${CITY_CFG.displayName}`);
  console.log(`   90-day rule: ${FORCE ? "BYPASSED (--force)" : "active"}${DRY ? " · DRY RUN" : ""}`);
  console.log("");

  console.log("→ Pulling fresh café list from Google Places…");
  const cafes = await searchCafes(googleKey, CITY_CFG);
  console.log(`  Got ${cafes.length} cafés that pass filters (chains, types, bbox, address).`);
  console.log("");

  const picks = {};
  const stats = { fresh: 0, reused: 0, newCafes: 0, dropped: 0 };

  // Track cafés that have left the list (closed / no longer pass filters)
  const newIds = new Set(cafes.map((c) => c.id));
  for (const oldId of Object.keys(existingPicks)) {
    if (!newIds.has(oldId)) stats.dropped++;
  }

  for (const cafe of cafes) {
    const old = existingPicks[cafe.id];
    const a = ageMs(old, fallbackDate);
    const wasNew = !old;
    const isStale = a >= TTL_MS;
    const shouldPull = FORCE || wasNew || isStale;

    if (!shouldPull) {
      const d = daysOf(a);
      console.log(`  · ${cafe.name.padEnd(46)} reused  (${d}d old, next eligible in ${TTL_DAYS - d}d)`);
      picks[cafe.id] = old;
      stats.reused++;
      continue;
    }

    const reason = wasNew ? "new café" : FORCE ? "forced" : `stale ${daysOf(a)}d`;
    process.stdout.write(`  ★ ${cafe.name.padEnd(46)} pulling (${reason})… `);

    if (DRY) {
      console.log("(skipped, dry-run)");
      picks[cafe.id] = old || null;
      continue;
    }

    try {
      const reviews = await getReviews(cafe.id, googleKey);
      const got = await getPicks(anthropic, cafe.name, reviews);
      picks[cafe.id] = {
        picks: got,
        reviewSample: reviews.slice(0, 3),
        reviewsAnalysed: reviews.length,
        fetched_at: new Date().toISOString(),
      };
      console.log("✓");
      if (wasNew) stats.newCafes++;
      stats.fresh++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      // Keep the old data if we have it — better than nothing
      if (old) picks[cafe.id] = old;
    }
  }

  const snapshot = {
    version: 1,
    citySlug: CITY_CFG.slug,
    city: CITY_CFG.displayName,
    generatedAt: new Date().toISOString(),
    count: cafes.length,
    cafes,
    picks,
  };

  if (DRY) {
    console.log("\n— dry-run: snapshot NOT written —");
  } else {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
    console.log(`\n✓  Wrote ${SNAPSHOT_PATH}`);
  }

  console.log("");
  console.log(`Summary:`);
  console.log(`  Freshly pulled: ${stats.fresh}  (${stats.newCafes} new cafés)`);
  console.log(`  Reused (still fresh): ${stats.reused}`);
  if (stats.dropped) console.log(`  Dropped from list: ${stats.dropped}`);
  if (stats.fresh > 0) {
    const cost = (stats.fresh * 0.04 + cafes.length * 0.005).toFixed(2);
    console.log(`  Estimated cost: ~$${cost} (Claude + Google)`);
  } else {
    console.log(`  Estimated cost: ~$0  (nothing pulled)`);
  }
}

main().catch((err) => {
  console.error(`\n❌  Failed: ${err.message}`);
  process.exit(1);
});
