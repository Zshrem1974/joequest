import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, cityBySlug } from "../../lib/cities.js";
import { isRealCafe, typesAreCafe, score } from "../../lib/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

const snapshotFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
const snapshots = snapshotFiles.map((f) => {
  const slug = f === "boca-snapshot.json" ? "boca-raton" : f.replace(/\.json$/, "");
  return { slug, file: f, data: JSON.parse(readFileSync(path.join(DATA_DIR, f), "utf8")) };
}).filter((s) => cityBySlug(s.slug));

describe("snapshot data integrity", () => {
  it("at least one snapshot exists", () => {
    assert.ok(snapshots.length > 0);
  });

  for (const { slug, data } of snapshots) {
    describe(`${slug}`, () => {
      it("has version 1", () => {
        assert.equal(data.version, 1);
      });

      it("has a valid generatedAt timestamp", () => {
        assert.ok(data.generatedAt);
        const d = new Date(data.generatedAt);
        assert.ok(!isNaN(d.getTime()));
      });

      it("count matches cafes array length", () => {
        assert.equal(data.count, data.cafes.length);
      });

      it("every cafe has required fields", () => {
        for (const c of data.cafes) {
          assert.ok(c.id, `missing id for ${c.name}`);
          assert.ok(c.name, `missing name for ${c.id}`);
          assert.ok(typeof c.lat === "number", `bad lat for ${c.name}`);
          assert.ok(typeof c.lng === "number", `bad lng for ${c.name}`);
        }
      });

      it("no duplicate cafe ids", () => {
        const ids = data.cafes.map((c) => c.id);
        assert.equal(new Set(ids).size, ids.length, "duplicate cafe ids found");
      });

      it("no chain cafes in the list", () => {
        for (const c of data.cafes) {
          assert.ok(isRealCafe(c.name), `chain cafe found: ${c.name}`);
        }
      });

      it("cafes are sorted by score descending", () => {
        for (let i = 1; i < data.cafes.length; i++) {
          const prev = score(data.cafes[i - 1]);
          const curr = score(data.cafes[i]);
          assert.ok(prev >= curr,
            `sort violation: ${data.cafes[i - 1].name} (${prev.toFixed(1)}) before ${data.cafes[i].name} (${curr.toFixed(1)})`
          );
        }
      });

      it("picks object exists", () => {
        assert.ok(data.picks && typeof data.picks === "object");
      });

      it("every pick entry has valid structure", () => {
        for (const [id, entry] of Object.entries(data.picks)) {
          assert.ok(entry.picks, `pick entry ${id} missing picks field`);
          assert.ok(entry.picks.drink, `pick entry ${id} missing drink`);
          assert.ok(entry.picks.food, `pick entry ${id} missing food`);
          assert.ok(entry.fetched_at, `pick entry ${id} missing fetched_at`);

          for (const key of ["drink", "food"]) {
            const p = entry.picks[key];
            assert.ok("name" in p, `${id} ${key} missing name`);
            assert.ok("confidence" in p, `${id} ${key} missing confidence`);
            assert.ok(
              ["high", "medium", "low", "none"].includes(p.confidence),
              `${id} ${key} invalid confidence: ${p.confidence}`
            );
          }
        }
      });

      it("pick ids reference actual cafes", () => {
        const cafeIds = new Set(data.cafes.map((c) => c.id));
        for (const id of Object.keys(data.picks)) {
          assert.ok(cafeIds.has(id), `orphan pick for ${id} — no matching cafe`);
        }
      });
    });
  }
});
