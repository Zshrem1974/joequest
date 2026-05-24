/*
 * lib/cities.js — config for every city JoeQuest knows about.
 *
 * Each entry owns:
 *   - slug          stable filename + URL param key (kebab-case)
 *   - name          human-readable
 *   - state         two-letter
 *   - displayName   "Boca Raton, FL" — what we show in UI
 *   - bbox          lat/lng box used for the filtering pipeline
 *   - center        rough centroid; used as fallback origin when we have no
 *                   user location AND for "nearest city to me" geolocation logic
 *   - addressRegex  must-match against Google's formattedAddress (disambiguates
 *                   places that fall inside multiple bboxes due to overlap)
 *   - searchQuery   text-search query used by snapshot.js
 *
 * To add a city: append a row, run `node scripts/snapshot.js --city=<slug>`,
 * commit the new data/<slug>.json. The server picks it up automatically.
 */

export const CITIES = [
  {
    slug: "boca-raton",
    name: "Boca Raton",
    state: "FL",
    displayName: "Boca Raton, FL",
    bbox:   { south: 26.32, north: 26.43, west: -80.22, east: -80.05 },
    center: { lat: 26.3683, lng: -80.1289 },
    addressRegex: /boca\s*raton/i,
    searchQuery: "coffee shops in Boca Raton, FL",
  },
  {
    slug: "delray-beach",
    name: "Delray Beach",
    state: "FL",
    displayName: "Delray Beach, FL",
    bbox:   { south: 26.42, north: 26.51, west: -80.20, east: -80.04 },
    center: { lat: 26.4615, lng: -80.0728 },
    addressRegex: /delray\s*beach/i,
    searchQuery: "coffee shops in Delray Beach, FL",
  },
  {
    slug: "boynton-beach",
    name: "Boynton Beach",
    state: "FL",
    displayName: "Boynton Beach, FL",
    bbox:   { south: 26.49, north: 26.59, west: -80.20, east: -80.02 },
    center: { lat: 26.5253, lng: -80.0664 },
    addressRegex: /boynton\s*beach/i,
    searchQuery: "coffee shops in Boynton Beach, FL",
  },
  {
    slug: "deerfield-beach",
    name: "Deerfield Beach",
    state: "FL",
    displayName: "Deerfield Beach, FL",
    bbox:   { south: 26.27, north: 26.34, west: -80.18, east: -80.07 },
    center: { lat: 26.3184, lng: -80.0997 },
    addressRegex: /deerfield\s*beach/i,
    searchQuery: "coffee shops in Deerfield Beach, FL",
  },
  {
    slug: "fort-lauderdale",
    name: "Fort Lauderdale",
    state: "FL",
    displayName: "Fort Lauderdale, FL",
    bbox:   { south: 26.07, north: 26.22, west: -80.22, east: -80.07 },
    center: { lat: 26.1224, lng: -80.1373 },
    addressRegex: /fort\s*lauderdale/i,
    searchQuery: "coffee shops in Fort Lauderdale, FL",
  },
  {
    slug: "miami",
    name: "Miami",
    state: "FL",
    displayName: "Miami, FL",
    bbox:   { south: 25.70, north: 25.92, west: -80.35, east: -80.13 },
    center: { lat: 25.7617, lng: -80.1918 },
    // Exclude "Miami Beach" — separate city.
    addressRegex: /\bMiami\b(?!\s*Beach)/i,
    searchQuery: "coffee shops in Miami, FL",
  },
];

export const DEFAULT_CITY = CITIES[0]; // Boca

export function cityBySlug(slug) {
  return CITIES.find((c) => c.slug === slug) || null;
}

// Cheap great-circle proxy — for "which of our 6 cities is closest to (lat, lng)"
// we don't need full Haversine; squared euclidean on lat/lng is fine at this scale.
export function nearestCity(lat, lng) {
  let best = null, bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.center.lat - lat) ** 2 + (c.center.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Generic bbox membership — used by city-aware filters in lib/data.js.
export function inBoxBy(lat, lng, box) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}
