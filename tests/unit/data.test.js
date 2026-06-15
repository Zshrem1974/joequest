import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRealCafe, typesAreCafe, inBoca, addressInBoca,
  priceToDollars, score, fmtTime, nonePick,
  EXCLUDE_NAMES, BAD_TYPES, BOCA_BOX, PICK_SCHEMA,
} from "../../lib/data.js";

describe("isRealCafe", () => {
  it("accepts a standalone cafe", () => {
    assert.ok(isRealCafe("Subculture Coffee"));
  });

  it("rejects chains (case-insensitive)", () => {
    for (const chain of ["Starbucks Reserve", "DUNKIN'", "Panera Bread", "McDonald's Cafe"]) {
      assert.ok(!isRealCafe(chain), `should reject "${chain}"`);
    }
  });

  it("rejects falsy input", () => {
    assert.ok(!isRealCafe(""));
    assert.ok(!isRealCafe(null));
    assert.ok(!isRealCafe(undefined));
  });

  it("rejects 787 Coffee", () => {
    assert.ok(!isRealCafe("787 Coffee Williamsburg"));
  });

  it("rejects 7 Brew", () => {
    assert.ok(!isRealCafe("7 Brew Coffee Drive-Thru"));
  });
});

describe("typesAreCafe", () => {
  it("accepts cafe types", () => {
    assert.ok(typesAreCafe(["cafe", "food", "establishment"]));
  });

  it("rejects donut shops", () => {
    assert.ok(!typesAreCafe(["donut_shop", "food"]));
  });

  it("rejects fast food", () => {
    assert.ok(!typesAreCafe(["fast_food_restaurant"]));
  });

  it("rejects gas stations", () => {
    assert.ok(!typesAreCafe(["gas_station", "convenience_store"]));
  });

  it("handles empty types", () => {
    assert.ok(typesAreCafe([]));
    assert.ok(typesAreCafe());
  });
});

describe("inBoca", () => {
  it("accepts a point inside the box", () => {
    assert.ok(inBoca(26.37, -80.13));
  });

  it("rejects a point outside the box", () => {
    assert.ok(!inBoca(25.76, -80.19)); // Miami
  });

  it("accepts boundary points", () => {
    assert.ok(inBoca(BOCA_BOX.south, BOCA_BOX.west));
    assert.ok(inBoca(BOCA_BOX.north, BOCA_BOX.east));
  });

  it("rejects non-numeric input", () => {
    assert.ok(!inBoca("26.37", -80.13));
    assert.ok(!inBoca(null, null));
  });
});

describe("addressInBoca", () => {
  it("matches Boca Raton addresses", () => {
    assert.ok(addressInBoca("123 Main St, Boca Raton, FL 33431"));
  });

  it("handles spacing variations", () => {
    assert.ok(addressInBoca("BocaRaton"));
  });

  it("rejects non-Boca addresses", () => {
    assert.ok(!addressInBoca("123 Main St, Miami, FL"));
  });

  it("rejects non-string input", () => {
    assert.ok(!addressInBoca(null));
    assert.ok(!addressInBoca(42));
  });
});

describe("priceToDollars", () => {
  it("maps Google price levels to dollar signs", () => {
    assert.equal(priceToDollars("PRICE_LEVEL_INEXPENSIVE"), "$");
    assert.equal(priceToDollars("PRICE_LEVEL_MODERATE"), "$$");
    assert.equal(priceToDollars("PRICE_LEVEL_EXPENSIVE"), "$$$");
    assert.equal(priceToDollars("PRICE_LEVEL_VERY_EXPENSIVE"), "$$$$");
  });

  it("defaults to $$ for unknown levels", () => {
    assert.equal(priceToDollars("PRICE_LEVEL_UNKNOWN"), "$$");
    assert.equal(priceToDollars(null), "$$");
    assert.equal(priceToDollars(undefined), "$$");
  });
});

describe("score", () => {
  it("returns 0 for missing rating or reviews", () => {
    assert.equal(score({}), 0);
    assert.equal(score({ rating: 4.5 }), 0);
    assert.equal(score({ reviews: 100 }), 0);
  });

  it("produces higher score for higher rating", () => {
    const s1 = score({ rating: 4.0, reviews: 100 });
    const s2 = score({ rating: 5.0, reviews: 100 });
    assert.ok(s2 > s1);
  });

  it("produces higher score for more reviews", () => {
    const s1 = score({ rating: 4.5, reviews: 10 });
    const s2 = score({ rating: 4.5, reviews: 1000 });
    assert.ok(s2 > s1);
  });

  it("uses log10 of (reviews + 1)", () => {
    const c = { rating: 4.0, reviews: 99 };
    const expected = 4.0 * 4.0 * Math.log10(100);
    assert.equal(score(c), expected);
  });
});

describe("fmtTime", () => {
  it("formats AM times", () => {
    assert.equal(fmtTime(8, 0), "8 AM");
    assert.equal(fmtTime(8, 30), "8:30 AM");
  });

  it("formats PM times", () => {
    assert.equal(fmtTime(14, 0), "2 PM");
    assert.equal(fmtTime(17, 45), "5:45 PM");
  });

  it("handles noon and midnight", () => {
    assert.equal(fmtTime(12, 0), "12 PM");
    assert.equal(fmtTime(0, 0), "12 AM");
  });

  it("pads single-digit minutes", () => {
    assert.equal(fmtTime(9, 5), "9:05 AM");
  });

  it("handles missing minute param", () => {
    assert.equal(fmtTime(10), "10 AM");
  });
});

describe("nonePick", () => {
  it("returns the correct shape", () => {
    const p = nonePick();
    assert.equal(p.name, null);
    assert.equal(p.confidence, "none");
    assert.equal(p.mention_count, 0);
    assert.equal(p.quote, null);
    assert.equal(typeof p.reason, "string");
  });
});

describe("PICK_SCHEMA", () => {
  it("requires drink and food", () => {
    assert.deepEqual(PICK_SCHEMA.required, ["drink", "food"]);
  });

  it("disallows additional properties", () => {
    assert.equal(PICK_SCHEMA.additionalProperties, false);
  });
});

describe("EXCLUDE_NAMES", () => {
  it("is an array of lowercase strings", () => {
    assert.ok(Array.isArray(EXCLUDE_NAMES));
    for (const name of EXCLUDE_NAMES) {
      assert.equal(name, name.toLowerCase(), `"${name}" should be lowercase`);
    }
  });
});
