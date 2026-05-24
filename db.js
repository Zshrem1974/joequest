/*
 * db.js — Supabase-backed durable cache, auth-aware favourites, JWT verify.
 * ------------------------------------------------------------------------
 * Tables (see CHANGES.md for SQL):
 *   - cafe_picks(place_id PK, payload jsonb, fetched_at timestamptz)  [legacy fallback]
 *   - favourites(user_id, place_id, created_at)                       [Stage 1: user-keyed]
 *
 * Auth model:
 *   - Browser uses supabase-js with the ANON KEY → user gets a JWT in localStorage.
 *   - Server uses the SERVICE-ROLE KEY for admin ops.
 *   - For per-user reads/writes, we still scope by user_id in the query AND
 *     RLS is enabled on the favourites table as defence-in-depth.
 *   - JWTs are verified server-side via `supabase.auth.getUser(jwt)`.
 *
 * Anonymous saves live in the browser's localStorage and merge into the user's
 * account on first sign-in (no anon table on the server).
 *
 * Required env vars:
 *   SUPABASE_URL                  (public; also served to browser via /api/auth/config)
 *   SUPABASE_ANON_KEY             (public; served to browser via /api/auth/config)
 *   SUPABASE_SERVICE_ROLE_KEY     (server-only — NEVER exposed to the browser)
 *
 * Without these, the module exports an in-memory fallback so dev still boots.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// ---- in-memory fallback (dev only) ----------------------------------------
const memCache = new Map(); // place_id -> { payload, fetched_at }
const memFavs = new Map();  // client_id -> Set<place_id>

export function dbReady() {
  return !!supabase;
}

export function dbStatus() {
  return supabase ? "supabase" : "memory-fallback";
}

// ---- cafe_picks ------------------------------------------------------------
export async function getCachedPick(placeId) {
  if (supabase) {
    const { data, error } = await supabase
      .from("cafe_picks")
      .select("payload, fetched_at")
      .eq("place_id", placeId)
      .maybeSingle();
    if (error) throw new Error(`Supabase getCachedPick: ${error.message}`);
    if (!data) return null;
    const age = Date.now() - new Date(data.fetched_at).getTime();
    if (age > CACHE_TTL_MS) return null;
    return data.payload;
  }
  const hit = memCache.get(placeId);
  if (!hit) return null;
  if (Date.now() - new Date(hit.fetched_at).getTime() > CACHE_TTL_MS) {
    memCache.delete(placeId);
    return null;
  }
  return hit.payload;
}

export async function setCachedPick(placeId, payload) {
  const fetched_at = new Date().toISOString();
  if (supabase) {
    const { error } = await supabase
      .from("cafe_picks")
      .upsert({ place_id: placeId, payload, fetched_at });
    if (error) throw new Error(`Supabase setCachedPick: ${error.message}`);
    return;
  }
  memCache.set(placeId, { payload, fetched_at });
}

export async function cachedCount() {
  if (supabase) {
    const { count, error } = await supabase
      .from("cafe_picks")
      .select("place_id", { count: "exact", head: true });
    if (error) return null;
    return count ?? 0;
  }
  return memCache.size;
}

// ----------------------------------------------------------------------------
// AUTH — JWT verification (server side, using the service-role client)
// ----------------------------------------------------------------------------
export async function verifyJwt(jwt) {
  if (!supabase || !jwt) return null;
  try {
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data?.user) return null;
    return data.user; // { id, email, created_at, ... }
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// FAVOURITES — user-keyed (Stage 1)
// ----------------------------------------------------------------------------
// Logged-in users: rows live in Supabase, scoped by user_id.
// Logged-out users: saves live in localStorage in the browser (not this server).
// Pre-Supabase fallback: in-memory map keyed by user_id, so dev still works.
//
// All queries also scope by user_id explicitly even though RLS enforces it,
// because we're using the service-role key which bypasses RLS.
// ----------------------------------------------------------------------------
export async function listFavouritesForUser(userId) {
  if (!userId) return [];
  if (supabase) {
    const { data, error } = await supabase
      .from("favourites")
      .select("place_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase listFavouritesForUser: ${error.message}`);
    return (data || []).map((r) => r.place_id);
  }
  return Array.from(memFavs.get(userId) || []);
}

export async function addFavouriteForUser(userId, placeId) {
  if (!userId || !placeId) return;
  if (supabase) {
    const { error } = await supabase
      .from("favourites")
      .upsert({ user_id: userId, place_id: placeId }, { onConflict: "user_id,place_id" });
    if (error) throw new Error(`Supabase addFavouriteForUser: ${error.message}`);
    return;
  }
  if (!memFavs.has(userId)) memFavs.set(userId, new Set());
  memFavs.get(userId).add(placeId);
}

export async function removeFavouriteForUser(userId, placeId) {
  if (!userId || !placeId) return;
  if (supabase) {
    const { error } = await supabase
      .from("favourites")
      .delete()
      .eq("user_id", userId)
      .eq("place_id", placeId);
    if (error) throw new Error(`Supabase removeFavouriteForUser: ${error.message}`);
    return;
  }
  memFavs.get(userId)?.delete(placeId);
}

// Bulk-upsert used when an anonymous user signs in and we move their
// localStorage saves into their account. Duplicates are silently ignored
// (the ON CONFLICT clause).
export async function mergeAnonFavourites(userId, placeIds) {
  if (!userId || !Array.isArray(placeIds) || placeIds.length === 0) return 0;
  const rows = placeIds.map((place_id) => ({ user_id: userId, place_id }));
  if (supabase) {
    const { error } = await supabase
      .from("favourites")
      .upsert(rows, { onConflict: "user_id,place_id" });
    if (error) throw new Error(`Supabase mergeAnonFavourites: ${error.message}`);
    return placeIds.length;
  }
  if (!memFavs.has(userId)) memFavs.set(userId, new Set());
  const set = memFavs.get(userId);
  placeIds.forEach((p) => set.add(p));
  return placeIds.length;
}

// ----------------------------------------------------------------------------
// USER SETTINGS (Stage 3 — drawer → Settings)
// ----------------------------------------------------------------------------
//   units          'mi' or 'km'
//   notifications  bool placeholder (no notification system wired yet)
// Anonymous users persist in localStorage; this server-side path is only used
// when there's an authenticated user.
// ----------------------------------------------------------------------------
const memSettings = new Map(); // user_id -> settings row

const SETTINGS_DEFAULTS = { units: "mi", notifications: false };

export async function getUserSettings(userId) {
  if (!userId) return null;
  if (supabase) {
    const { data, error } = await supabase
      .from("user_settings")
      .select("units, notifications, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Supabase getUserSettings: ${error.message}`);
    return data || { ...SETTINGS_DEFAULTS };
  }
  return memSettings.get(userId) || { ...SETTINGS_DEFAULTS };
}

export async function saveUserSettings(userId, settings) {
  if (!userId || !settings || typeof settings !== "object") return null;
  const row = {
    user_id: userId,
    units: settings.units === "km" ? "km" : "mi",
    notifications: !!settings.notifications,
    updated_at: new Date().toISOString(),
  };
  if (supabase) {
    const { data, error } = await supabase
      .from("user_settings")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase saveUserSettings: ${error.message}`);
    return data;
  }
  memSettings.set(userId, row);
  return row;
}

// Wipe everything we store about a user. Account stays alive — they can keep
// using JoeQuest, just with a clean slate.
export async function clearUserData(userId) {
  if (!userId) return { favourites: 0, taste: false, settings: false };
  if (supabase) {
    const [favResult, tasteResult, settResult] = await Promise.all([
      supabase.from("favourites").delete().eq("user_id", userId).select("place_id"),
      supabase.from("taste_profiles").delete().eq("user_id", userId).select("user_id"),
      supabase.from("user_settings").delete().eq("user_id", userId).select("user_id"),
    ]);
    if (favResult.error) throw new Error(`Supabase clearUserData favourites: ${favResult.error.message}`);
    if (tasteResult.error) throw new Error(`Supabase clearUserData taste: ${tasteResult.error.message}`);
    if (settResult.error) throw new Error(`Supabase clearUserData settings: ${settResult.error.message}`);
    return {
      favourites: favResult.data?.length ?? 0,
      taste: (tasteResult.data?.length ?? 0) > 0,
      settings: (settResult.data?.length ?? 0) > 0,
    };
  }
  const favCount = memFavs.get(userId)?.size || 0;
  memFavs.delete(userId);
  const hadTaste = memTaste.delete(userId);
  const hadSettings = memSettings.delete(userId);
  return { favourites: favCount, taste: hadTaste, settings: hadSettings };
}

// ----------------------------------------------------------------------------
// TASTE PROFILES (Stage 2 — drawer → Coffee taste profile)
// ----------------------------------------------------------------------------
// Five short answers per user. Stored flat in one row; the schema is loose
// (plain text columns) so we can evolve the quiz without migrations.
//
//   roast       light / medium / dark
//   milk        black / milk / plant
//   strength    mild / balanced / strong
//   sweetness   none / little / sweet
//   adventurous usual / surprise
// ----------------------------------------------------------------------------
const memTaste = new Map();   // user_id -> profile object

export async function getTasteProfile(userId) {
  if (!userId) return null;
  if (supabase) {
    const { data, error } = await supabase
      .from("taste_profiles")
      .select("roast, milk, strength, sweetness, adventurous, brewing, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Supabase getTasteProfile: ${error.message}`);
    return data || null;
  }
  return memTaste.get(userId) || null;
}

export async function saveTasteProfile(userId, profile) {
  if (!userId || !profile || typeof profile !== "object") return null;
  const row = {
    user_id: userId,
    roast: profile.roast ?? null,
    milk: profile.milk ?? null,
    strength: profile.strength ?? null,
    sweetness: profile.sweetness ?? null,
    adventurous: profile.adventurous ?? null,
    brewing: profile.brewing ?? null,
    updated_at: new Date().toISOString(),
  };
  if (supabase) {
    const { data, error } = await supabase
      .from("taste_profiles")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase saveTasteProfile: ${error.message}`);
    return data;
  }
  memTaste.set(userId, row);
  return row;
}
