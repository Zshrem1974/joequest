import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_NAME_RE, placeIdFromPhotoName, isStaleNameStatus, createPhotoResolver,
  RESOLVED_TTL_MS, FAILURE_TTL_MS,
} from "../../lib/photos.js";

const NAME = "places/ChIJ8-AgkXwF9YgRerw_Yj02Fsw/photos/AaVGc3mEMJqWl0L2Gsm_VRo9SI0";
const FRESH = "places/ChIJ8-AgkXwF9YgRerw_Yj02Fsw/photos/AWCwydNEWnameHere-123";

describe("PHOTO_NAME_RE", () => {
  it("accepts real Places photo names", () => {
    assert.ok(PHOTO_NAME_RE.test(NAME));
    assert.ok(PHOTO_NAME_RE.test(FRESH));
  });

  it("rejects anything that could steer the proxy elsewhere", () => {
    for (const bad of [
      "https://evil.example/x",
      "places/X/photos/Y/../../../etc/passwd",
      "places/X/photos/Y?key=leak",
      "places//photos/Y",
      "",
    ]) {
      assert.ok(!PHOTO_NAME_RE.test(bad), `should reject "${bad}"`);
    }
  });
});

describe("placeIdFromPhotoName", () => {
  it("extracts the place id", () => {
    assert.equal(placeIdFromPhotoName(NAME), "ChIJ8-AgkXwF9YgRerw_Yj02Fsw");
  });

  it("returns null on junk", () => {
    assert.equal(placeIdFromPhotoName("nope"), null);
    assert.equal(placeIdFromPhotoName(null), null);
  });
});

describe("isStaleNameStatus", () => {
  it("treats 400/403/404 as expired-name signals", () => {
    for (const s of [400, 403, 404]) assert.ok(isStaleNameStatus(s));
  });

  it("leaves server-side errors alone", () => {
    for (const s of [200, 429, 500, 502, 503]) assert.ok(!isStaleNameStatus(s));
  });
});

describe("createPhotoResolver", () => {
  function harness({ names = { any: FRESH }, throws = false } = {}) {
    let clock = 1_000_000;
    const calls = [];
    const resolver = createPhotoResolver({
      now: () => clock,
      fetchPhotoName: async (placeId) => {
        calls.push(placeId);
        if (throws) throw new Error("Place details 403");
        return Object.prototype.hasOwnProperty.call(names, placeId) ? names[placeId] : names.any;
      },
    });
    return { resolver, calls, tick: (ms) => { clock += ms; } };
  }

  it("resolves a fresh name and caches it", async () => {
    const { resolver, calls } = harness();
    assert.equal(await resolver.refresh("P1"), FRESH);
    assert.equal(resolver.cachedName("P1"), FRESH);
    assert.equal(calls.length, 1);
  });

  it("serves the cached name without calling Google again", async () => {
    const { resolver, calls } = harness();
    await resolver.refresh("P1");
    assert.equal(resolver.cachedName("P1"), FRESH);
    assert.equal(calls.length, 1, "cachedName must not hit Places");
  });

  it("expires a resolved name after the TTL", async () => {
    const { resolver, tick } = harness();
    await resolver.refresh("P1");
    tick(RESOLVED_TTL_MS + 1);
    assert.equal(resolver.cachedName("P1"), null);
  });

  it("shares one in-flight refresh across concurrent requests", async () => {
    const { resolver, calls } = harness();
    const [a, b, c] = await Promise.all([
      resolver.refresh("P1"), resolver.refresh("P1"), resolver.refresh("P1"),
    ]);
    assert.equal(a, FRESH);
    assert.equal(b, FRESH);
    assert.equal(c, FRESH);
    assert.equal(calls.length, 1, "10 cards rendering must not mean 10 Places calls");
  });

  it("negative-caches a place with no photos", async () => {
    const { resolver, calls } = harness({ names: { P1: null } });
    assert.equal(await resolver.refresh("P1"), null);
    assert.ok(resolver.isCoolingDown("P1"));
    assert.equal(await resolver.refresh("P1"), null);
    assert.equal(calls.length, 1, "cooldown must suppress the repeat lookup");
  });

  it("negative-caches a failed lookup, then retries after the cooldown", async () => {
    const { resolver, calls, tick } = harness({ throws: true });
    assert.equal(await resolver.refresh("P1"), null);
    assert.equal(await resolver.refresh("P1"), null);
    assert.equal(calls.length, 1);
    tick(FAILURE_TTL_MS + 1);
    assert.equal(await resolver.refresh("P1"), null);
    assert.equal(calls.length, 2);
  });

  it("rejects a malformed name coming back from Places", async () => {
    const { resolver } = harness({ names: { P1: "https://evil.example/x" } });
    assert.equal(await resolver.refresh("P1"), null);
    assert.equal(resolver.cachedName("P1"), null);
  });

  it("forgets only the name that actually failed", async () => {
    const { resolver } = harness();
    await resolver.refresh("P1");
    resolver.forget("P1", NAME);            // a different (older) name failed
    assert.equal(resolver.cachedName("P1"), FRESH, "unrelated failure must not evict");
    resolver.forget("P1", FRESH);
    assert.equal(resolver.cachedName("P1"), null);
  });

  it("no-ops safely when no resolver function is wired up", async () => {
    const resolver = createPhotoResolver({});
    assert.equal(await resolver.refresh("P1"), null);
  });

  it("tracks serve/failure counters for /api/status", async () => {
    const { resolver } = harness();
    resolver.recordServed(false);
    resolver.recordServed(true);
    await resolver.refresh("P1");
    resolver.recordFailure("P2", 403);

    const s = resolver.snapshot();
    assert.equal(s.served, 1);
    assert.equal(s.servedRefreshed, 1);
    assert.equal(s.refreshes, 1);
    assert.equal(s.failed, 1);
    assert.equal(s.lastFailure.placeId, "P2");
    assert.equal(s.lastFailure.status, 403);
    assert.equal(s.resolvedNames, 1);
  });
});
