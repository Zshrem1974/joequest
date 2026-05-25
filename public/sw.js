/*
 * JoeQuest service worker — installable-PWA shell cache only.
 *
 * Bumping the shell? Increment SHELL_VERSION. The old cache is deleted on
 * the next activation. Clients pick up the new shell after a reload (or
 * sooner if they support `skipWaiting` flows — we don't force that here).
 *
 * Caches the static app shell so repeat loads are instant + a sensible
 * offline screen can render when the network is unreachable. Never caches
 * API responses, café data, photos, auth, or analytics — those always go
 * to network, because a wrong/old pick is worse than an honest failure.
 */

const SHELL_VERSION = "v1";
const SHELL_CACHE = `joequest-shell-${SHELL_VERSION}`;

// Same-origin static files that make up the app shell. Cross-origin assets
// (Google Fonts, supabase-js CDN) are deliberately NOT precached — they're
// owned by other origins and the SW shouldn't proxy them.
const SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/offline.html",
  "/img/favicon.svg",
  "/img/joequest-app-icon.svg",
  "/img/joequest-icon.svg",
  "/img/joequest-lockup.svg",
  "/img/joequest-icon-192.png",
  "/img/joequest-icon-512.png",
  "/img/apple-touch-icon.png",
  "/img/joequester-marker.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n.startsWith("joequest-shell-") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only intercept GETs. Anything else (POST /api/event, PUT favourites,
  // etc.) goes straight to the network as if no SW were installed.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Don't touch cross-origin requests. supabase-js, Google Fonts, any other
  // third-party — let the browser handle them normally.
  if (url.origin !== self.location.origin) return;

  // API + photo proxy + admin: NEVER cache. Wrong/old picks, stale
  // favourites, expired offer codes are all worse than honest failures.
  // Photos live behind /api/photo (same-origin proxy), so this catches
  // them too.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) {
    return; // network-only — no respondWith means default browser fetch
  }

  // Navigation requests (HTML page loads): try network first so a deployed
  // shell update is picked up promptly, fall back to cache, then to the
  // offline page. Avoids the "stuck on old shell" problem during deploys.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Mirror the latest index.html into the cache so the cached copy
          // doesn't drift from what's deployed.
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("/offline.html"))
        )
    );
    return;
  }

  // Same-origin static assets: cache-first. If the asset isn't in cache
  // (e.g. a new image added post-install), go to network and silently
  // cache the result for next time.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
