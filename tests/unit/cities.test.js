import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CITIES, DEFAULT_CITY, cityBySlug, nearestCity, inBoxBy,
} from "../../lib/cities.js";

describe("CITIES", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(CITIES));
    assert.ok(CITIES.length > 0);
  });

  it("every city has required fields", () => {
    for (const c of CITIES) {
      assert.ok(c.slug, `missing slug on ${c.name}`);
      assert.ok(c.name, `missing name on ${c.slug}`);
      assert.ok(c.state, `missing state on ${c.slug}`);
      assert.ok(c.displayName, `missing displayName on ${c.slug}`);
      assert.ok(c.bbox, `missing bbox on ${c.slug}`);
      assert.ok(c.center, `missing center on ${c.slug}`);
      assert.ok(c.addressRegex, `missing addressRegex on ${c.slug}`);
      assert.ok(c.searchQuery || c.searchQueries, `missing searchQuery on ${c.slug}`);
      assert.ok(c.timezone, `missing timezone on ${c.slug}`);
    }
  });

  it("has unique slugs", () => {
    const slugs = CITIES.map((c) => c.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("every bbox has valid coordinates", () => {
    for (const c of CITIES) {
      assert.ok(c.bbox.south < c.bbox.north, `${c.slug}: south >= north`);
      assert.ok(c.bbox.west < c.bbox.east, `${c.slug}: west >= east`);
    }
  });

  it("every center is inside its own bbox", () => {
    for (const c of CITIES) {
      assert.ok(
        inBoxBy(c.center.lat, c.center.lng, c.bbox),
        `${c.slug}: center not inside bbox`,
      );
    }
  });

  it("addressRegex is a RegExp for each city", () => {
    for (const c of CITIES) {
      assert.ok(c.addressRegex instanceof RegExp, `${c.slug}: addressRegex not a RegExp`);
    }
  });
});

describe("DEFAULT_CITY", () => {
  it("is Boca Raton", () => {
    assert.equal(DEFAULT_CITY.slug, "boca-raton");
  });
});

describe("cityBySlug", () => {
  it("finds a known city", () => {
    const c = cityBySlug("miami");
    assert.ok(c);
    assert.equal(c.name, "Miami");
  });

  it("returns null for unknown slug", () => {
    assert.equal(cityBySlug("atlantis"), null);
  });

  it("returns null for empty/null", () => {
    assert.equal(cityBySlug(""), null);
    assert.equal(cityBySlug(null), null);
    assert.equal(cityBySlug(undefined), null);
  });

  it("finds every city by its own slug", () => {
    for (const c of CITIES) {
      assert.strictEqual(cityBySlug(c.slug), c);
    }
  });
});

describe("nearestCity", () => {
  it("returns Boca for a point in Boca", () => {
    const c = nearestCity(26.37, -80.13);
    assert.equal(c.slug, "boca-raton");
  });

  it("returns Miami for a point in Miami", () => {
    const c = nearestCity(25.76, -80.19);
    assert.equal(c.slug, "miami");
  });

  it("returns NYC for a Manhattan point", () => {
    const c = nearestCity(40.75, -73.99);
    assert.equal(c.slug, "new-york-city");
  });

  it("returns the closest of neighboring cities", () => {
    const c = nearestCity(26.45, -80.07);
    assert.equal(c.slug, "delray-beach");
  });
});

describe("inBoxBy", () => {
  it("accepts a point inside the box", () => {
    const box = { south: 26.0, north: 27.0, west: -81.0, east: -80.0 };
    assert.ok(inBoxBy(26.5, -80.5, box));
  });

  it("rejects a point outside the box", () => {
    const box = { south: 26.0, north: 27.0, west: -81.0, east: -80.0 };
    assert.ok(!inBoxBy(25.0, -80.5, box));
  });

  it("accepts boundary points", () => {
    const box = { south: 10, north: 20, west: -50, east: -40 };
    assert.ok(inBoxBy(10, -50, box));
    assert.ok(inBoxBy(20, -40, box));
  });

  it("rejects non-numeric lat/lng", () => {
    const box = { south: 10, north: 20, west: -50, east: -40 };
    assert.ok(!inBoxBy("15", -45, box));
    assert.ok(!inBoxBy(null, null, box));
  });
});
