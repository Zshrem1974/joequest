/*
 * db.js — Supabase-backed durable cache & favourites helper.
 * ----------------------------------------------------------
 * Tables (see CHANGES.md for the SQL to create them):
 *   - cafe_picks(place_id PK, payload jsonb, fetched_at timestamptz)
 *   - favourites(client_id, place_id, created_at)  (composite PK)
 *
 * Requires env vars:
 *   SUPABASE_URL                    (public)
 *   SUPABASE_SERVICE_ROLE_KEY       (server-only — never exposed to the browser)
 *
 * If the env vars are missing, this module exports an in-memory fallback so the
 * server still boots in dev. The fallback logs a loud warning at startup; in
 * production you want real Supabase so picks survive restarts / Render sleeps.
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

// ---- favourites (groundwork; routes wired in server.js) -------------------
export async function listFavourites(clientId) {
  if (!clientId) return [];
  if (supabase) {
    const { data, error } = await supabase
      .from("favourites")
      .select("place_id, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase listFavourites: ${error.message}`);
    return (data || []).map((r) => r.place_id);
  }
  return Array.from(memFavs.get(clientId) || []);
}

export async function addFavourite(clientId, placeId) {
  if (!clientId || !placeId) return;
  if (supabase) {
    const { error } = await supabase
      .from("favourites")
      .upsert({ client_id: clientId, place_id: placeId });
    if (error) throw new Error(`Supabase addFavourite: ${error.message}`);
    return;
  }
  if (!memFavs.has(clientId)) memFavs.set(clientId, new Set());
  memFavs.get(clientId).add(placeId);
}

export async function removeFavourite(clientId, placeId) {
  if (!clientId || !placeId) return;
  if (supabase) {
    const { error } = await supabase
      .from("favourites")
      .delete()
      .eq("client_id", clientId)
      .eq("place_id", placeId);
    if (error) throw new Error(`Supabase removeFavourite: ${error.message}`);
    return;
  }
  memFavs.get(clientId)?.delete(placeId);
}
