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
 *   - timezone      IANA tz database name. Drives the "open now / closes 8 PM"
 *                   computation on both server and client. Critical for any
 *                   non-Eastern city, since snapshot-baked hoursLabel and the
 *                   client's live recompute both consume this.
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
    timezone: "America/New_York",
    // Curated cafés that Google's rotating top-20 search drops out from
    // time to time. snapshot.js unions these in via Place Details so they
    // survive every refresh without manual re-adds. Add a place_id to keep
    // a café permanently in the snapshot — strip the entry to drop one.
    mustInclude: [
      "ChIJC1VsFw7j2IgRXX_XJkJMHb4", // Espresso Joint
      "ChIJ81Ar2sYZ2YgRllhJlMYB_dI", // Rosalia's Botanical Cafe
    ],
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
    timezone: "America/New_York",
    mustInclude: [],
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
    timezone: "America/New_York",
    mustInclude: [],
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
    timezone: "America/New_York",
    mustInclude: [],
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
    timezone: "America/New_York",
    mustInclude: [],
  },
  {
    slug: "miami",
    name: "Miami",
    state: "FL",
    displayName: "Miami, FL",
    // Extended east to -80.10 to capture Miami Beach (barrier island).
    bbox:   { south: 25.70, north: 25.92, west: -80.35, east: -80.10 },
    center: { lat: 25.7617, lng: -80.1918 },
    // Matches Miami, Miami Beach, and Coral Gables — all covered by the bbox.
    addressRegex: /\b(Miami(?:\s*Beach)?|Coral\s*Gables),?\s*FL\b/i,
    searchQueries: [
      "specialty coffee shops in Wynwood Design District Miami FL",
      "specialty coffee shops in Brickell Downtown Miami FL",
      "specialty coffee shops in Little Havana Coconut Grove Miami FL",
      "specialty coffee shops in South Beach Miami Beach FL",
      "specialty coffee shops in Coral Gables FL",
    ],
    timezone: "America/New_York",
    mustInclude: [],
  },
  {
    slug: "parkland",
    name: "Parkland",
    state: "FL",
    displayName: "Parkland, FL",
    // bbox covers ZIPs 33067, 33073, 33076 — Parkland's three ZIP areas.
    bbox:   { south: 26.27, north: 26.35, west: -80.30, east: -80.19 },
    center: { lat: 26.3098, lng: -80.2378 },
    // "Parkland" is a single word that could appear as a street name in
    // nearby cities (Coral Springs has a Parkland Ave). Anchor on ", FL"
    // so the city-slot of Google's formatted address is what matches.
    addressRegex: /\bparkland,?\s*fl\b/i,
    searchQuery: "coffee shops in Parkland, FL",
    timezone: "America/New_York",
    mustInclude: [],
  },
  {
    slug: "slidell",
    name: "Slidell",
    state: "LA",
    displayName: "Slidell, LA",
    // St. Tammany Parish, north shore of Lake Pontchartrain. No JoeQuest
    // cities nearby, so bbox can be generous.
    bbox:   { south: 30.21, north: 30.32, west: -89.85, east: -89.70 },
    center: { lat: 30.275, lng: -89.781 },
    // Anchor on ", LA" — defensive against any "Slidell" street names.
    addressRegex: /\bslidell,?\s*la\b/i,
    searchQuery: "coffee shops in Slidell, LA",
    timezone: "America/Chicago",
    mustInclude: [],
  },
  {
    slug: "gulfport",
    name: "Gulfport",
    state: "MS",
    displayName: "Gulfport, MS",
    // Harrison County, MS Gulf Coast. East edge at -89.00 shares the
    // Biloxi boundary; addressRegex on each side prevents bleed.
    bbox:   { south: 30.34, north: 30.48, west: -89.18, east: -89.00 },
    center: { lat: 30.385, lng: -89.094 },
    // CRITICAL: must anchor on ", MS" — Gulfport, FL exists (near St.
    // Petersburg) and would otherwise contaminate the search results.
    addressRegex: /\bgulfport,?\s*ms\b/i,
    searchQuery: "coffee shops in Gulfport, MS",
    timezone: "America/Chicago",
    mustInclude: [],
  },
  {
    slug: "biloxi",
    name: "Biloxi",
    state: "MS",
    displayName: "Biloxi, MS",
    // West edge at -89.00 shares Gulfport boundary. East edge -88.78
    // stops short of Ocean Springs (across Biloxi Bay).
    bbox:   { south: 30.34, north: 30.48, west: -89.00, east: -88.78 },
    center: { lat: 30.396, lng: -88.885 },
    addressRegex: /\bbiloxi,?\s*ms\b/i,
    searchQuery: "coffee shops in Biloxi, MS",
    timezone: "America/Chicago",
    mustInclude: [],
  },
  {
    slug: "new-york-city",
    name: "New York City",
    state: "NY",
    displayName: "New York City, NY",
    // Covers all 5 boroughs: Manhattan, Brooklyn, Queens, Bronx, Staten Island.
    // 20-result cap means Google will surface whichever cluster it ranks highest
    // (typically Manhattan). Expand to borough-level configs if coverage matters.
    bbox:   { south: 40.496, north: 40.917, west: -74.259, east: -73.700 },
    center: { lat: 40.7128, lng: -73.9060 },
    // Match any of the 5 borough names formatted as ", NY" — prevents NY-state
    // cities outside the bbox from slipping through on an addressRegex-only check.
    addressRegex: /\b(New York|Brooklyn|Queens|Bronx|Staten Island),?\s*NY\b/i,
    // Four neighborhood queries so we aren't capped at 20 results for the whole
    // city. Each returns up to 20; searchCafes dedupes by Place ID before filtering.
    searchQueries: [
      "specialty coffee shops in downtown Manhattan New York NY",
      "specialty coffee shops in Midtown Manhattan New York NY",
      "specialty coffee shops in Upper Manhattan New York NY",
      "specialty coffee shops in Brooklyn New York NY",
    ],
    timezone: "America/New_York",
    mustInclude: [],
  },
];

export const DEFAULT_CITY = CITIES[0]; // Boca

export function cityBySlug(slug) {
  return CITIES.find((c) => c.slug === slug) || null;
}

// Cheap great-circle proxy — for "which JoeQuest city is closest to (lat, lng)"
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
