/*
 * lib/photos.js — self-healing photo-name resolution.
 *
 * WHY THIS EXISTS
 * ---------------
 * Google Places (New) photo *resource names* expire. Google's own docs are
 * explicit: "You cannot cache a photo name, as the name can expire. You
 * should always get the name from a response to a request to Place Details
 * (New), Nearby Search (New), or Text Search (New)."
 *
 * JoeQuest does cache them — every café in data/<city>.json carries a
 * pre-baked `/api/photo?name=places/X/photos/Y` URL minted when the snapshot
 * was generated. That's the right call for cost (the snapshot is the whole
 * point), but it means a snapshot older than Google's rotation window serves
 * dead photo names and EVERY image in the app falls back to the ☕ placeholder
 * at once. Silently, because the client just swaps in the fallback on error.
 *
 * This module makes that failure recoverable at request time: when a cached
 * name is rejected upstream, we re-resolve the place's current photo name via
 * Place Details, remember it in memory, and retry once. The snapshot stays
 * the source of truth for everything else; only the volatile bit is refreshed.
 *
 * Guard rails, because Place Details costs money:
 *   - one refresh in flight per place (concurrent card renders share it)
 *   - a resolved name is reused for RESOLVED_TTL_MS without touching Google
 *   - a place that fails to resolve is negative-cached for FAILURE_TTL_MS, so
 *     a café with no photos can't turn into a per-render Places call
 */

// Places photo resource names look like "places/XYZ/photos/ABC". Only that
// pattern is allowed so the proxy can't be coerced into open SSRF.
export const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export const RESOLVED_TTL_MS = 6 * 60 * 60 * 1000;  // trust a re-resolved name 6h
export const FAILURE_TTL_MS = 30 * 60 * 1000;       // don't re-ask for 30min after a miss

/** "places/ChIJabc/photos/AXQ..." → "ChIJabc" (null if the name is malformed). */
export function placeIdFromPhotoName(name) {
  const m = /^places\/([A-Za-z0-9_-]+)\/photos\//.exec(String(name || ""));
  return m ? m[1] : null;
}

/** Upstream status codes that mean "this name is dead, ask Google for a new one". */
export function isStaleNameStatus(status) {
  return status === 400 || status === 403 || status === 404;
}

/**
 * @param {object} opts
 * @param {(placeId: string) => Promise<string|null>} opts.fetchPhotoName
 *        Resolves a place's *current* first photo name (null when it has none).
 * @param {() => number} [opts.now] Injectable clock for tests.
 */
export function createPhotoResolver({ fetchPhotoName, now = Date.now } = {}) {
  // placeId -> { name, at }        successfully re-resolved names
  const resolved = new Map();
  // placeId -> { at, reason }      places we failed to resolve (negative cache)
  const failures = new Map();
  // placeId -> Promise             in-flight refreshes, so N cards = 1 call
  const inflight = new Map();

  const stats = {
    served: 0,          // photos streamed on the snapshot's name
    servedRefreshed: 0, // photos streamed only because we re-resolved
    refreshes: 0,       // Place Details calls made
    failed: 0,          // requests that ended in no image
    lastFailure: null,  // { placeId, status, at }
  };

  /** A name we already re-resolved for this place, if still within TTL. */
  function cachedName(placeId) {
    const hit = resolved.get(placeId);
    if (!hit) return null;
    if (now() - hit.at > RESOLVED_TTL_MS) { resolved.delete(placeId); return null; }
    return hit.name;
  }

  /** True when this place is negative-cached and shouldn't hit Google again yet. */
  function isCoolingDown(placeId) {
    const miss = failures.get(placeId);
    if (!miss) return false;
    if (now() - miss.at > FAILURE_TTL_MS) { failures.delete(placeId); return false; }
    return true;
  }

  /**
   * Ask Google for this place's current photo name. Returns null when the
   * place has no photo, the lookup failed, or we're in the cooldown window.
   * Concurrent callers for the same place share one request.
   */
  async function refresh(placeId) {
    if (!placeId || typeof fetchPhotoName !== "function") return null;
    if (isCoolingDown(placeId)) return null;

    const pending = inflight.get(placeId);
    if (pending) return pending;

    const p = (async () => {
      stats.refreshes++;
      try {
        const name = await fetchPhotoName(placeId);
        if (name && PHOTO_NAME_RE.test(name)) {
          resolved.set(placeId, { name, at: now() });
          failures.delete(placeId);
          return name;
        }
        failures.set(placeId, { at: now(), reason: "no photo on place" });
        return null;
      } catch (e) {
        failures.set(placeId, { at: now(), reason: e.message });
        return null;
      } finally {
        inflight.delete(placeId);
      }
    })();

    inflight.set(placeId, p);
    return p;
  }

  function recordServed(viaRefresh) {
    if (viaRefresh) stats.servedRefreshed++;
    else stats.served++;
  }

  function recordFailure(placeId, status) {
    stats.failed++;
    stats.lastFailure = { placeId, status, at: new Date(now()).toISOString() };
  }

  /** Drop a name we just watched fail, so the next request re-resolves it. */
  function forget(placeId, name) {
    const hit = resolved.get(placeId);
    if (hit && hit.name === name) resolved.delete(placeId);
  }

  return {
    cachedName, isCoolingDown, refresh, forget,
    recordServed, recordFailure,
    snapshot: () => ({
      ...stats,
      resolvedNames: resolved.size,
      coolingDown: failures.size,
    }),
    // test seams
    _resolved: resolved,
    _failures: failures,
  };
}
