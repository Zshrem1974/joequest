import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

let server;
let baseUrl;

before(async () => {
  const port = 0; // let OS pick a free port
  process.env.PORT = String(port);
  // No Supabase or API keys — server boots in snapshot-only mode
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  // Import server.js — it calls app.listen(PORT). We need to capture the
  // actual port from the returned server instance. server.js calls
  // app.listen() at module scope, so we intercept via a dynamic import
  // after setting PORT=0.
  //
  // Express listen(0) picks a random free port. We extract it from the
  // address after the 'listening' event.
  const { default: appModule } = await import("../../server.js");

  // server.js doesn't export the http.Server — it calls app.listen() at
  // the end. We need to find it. Express 5 app.listen returns the Server.
  // But since server.js doesn't export it, we look at active handles.
  // Alternatively, we'll just use the PORT env approach + a small delay.
  //
  // Simpler: we read PORT from env and hit it.
  await new Promise((r) => setTimeout(r, 500));
  // Find what port the server actually bound to
  const handles = process._getActiveHandles?.() || [];
  const httpServer = handles.find(
    (h) => h?.constructor?.name === "Server" && typeof h.address === "function"
  );
  if (httpServer) {
    const addr = httpServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    server = httpServer;
  } else {
    baseUrl = `http://127.0.0.1:3000`;
  }
});

after(() => {
  if (server) server.close();
});

describe("GET /api/status", () => {
  it("returns ok: true", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.google, false);
    assert.equal(body.anthropic, false);
    assert.equal(body.cache, "memory-fallback");
  });

  it("includes snapshot info", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();
    assert.ok(Array.isArray(body.snapshots));
    assert.ok(body.snapshots.length > 0);
    const boca = body.snapshots.find((s) => s.slug === "boca-raton");
    assert.ok(boca, "boca-raton snapshot should be present");
    assert.ok(boca.cafes > 0);
  });
});

describe("GET /api/cities", () => {
  it("returns a list of cities", async () => {
    const res = await fetch(`${baseUrl}/api/cities`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.cities));
    assert.ok(body.cities.length > 0);
    const boca = body.cities.find((c) => c.slug === "boca-raton");
    assert.ok(boca);
    assert.equal(boca.displayName, "Boca Raton, FL");
    assert.ok(boca.hasSnapshot);
  });
});

describe("GET /api/cafes", () => {
  it("returns cafes for default city", async () => {
    const res = await fetch(`${baseUrl}/api/cafes`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count > 0);
    assert.ok(Array.isArray(body.cafes));
    assert.equal(body.citySlug, "boca-raton");
  });

  it("returns cafes for a specific city", async () => {
    const res = await fetch(`${baseUrl}/api/cafes?city=miami`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.citySlug, "miami");
    assert.ok(body.count > 0);
  });

  it("returns all cafes with all=1", async () => {
    const res = await fetch(`${baseUrl}/api/cafes?all=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.citySlug, "__all__");
    assert.ok(body.count > 10); // should be more than any single city
  });

  it("each cafe has required fields", async () => {
    const res = await fetch(`${baseUrl}/api/cafes`);
    const body = await res.json();
    const cafe = body.cafes[0];
    assert.ok(cafe.id);
    assert.ok(cafe.name);
    assert.ok(cafe.address);
    assert.ok(typeof cafe.lat === "number");
    assert.ok(typeof cafe.lng === "number");
    assert.ok(typeof cafe.rating === "number");
  });
});

describe("GET /api/cafes/:id", () => {
  it("returns a cafe with picks from snapshot", async () => {
    // Get a known cafe id from the list
    const listRes = await fetch(`${baseUrl}/api/cafes`);
    const list = await listRes.json();
    const id = list.cafes[0].id;

    const res = await fetch(`${baseUrl}/api/cafes/${id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id);
    assert.ok(body.name);
    assert.equal(body.source, "snapshot");
    assert.ok(body.picks);
    assert.ok(body.picks.drink);
    assert.ok(body.picks.food);
  });

  it("returns 404 for unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/cafes/NONEXISTENT_ID_12345`);
    assert.equal(res.status, 404);
  });
});

describe("GET /api/config", () => {
  it("returns maptilerKey (possibly empty)", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("maptilerKey" in body);
  });
});

describe("GET /api/auth/config", () => {
  it("returns null values when Supabase not configured", async () => {
    const res = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.url, null);
    assert.equal(body.anonKey, null);
  });
});

describe("authed routes without JWT", () => {
  it("GET /api/favourites returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/favourites`);
    assert.equal(res.status, 401);
  });

  it("POST /api/favourites/:id returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/favourites/test`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  it("DELETE /api/favourites/:id returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/favourites/test`, { method: "DELETE" });
    assert.equal(res.status, 401);
  });

  it("GET /api/taste returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/taste`);
    assert.equal(res.status, 401);
  });

  it("GET /api/settings returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    assert.equal(res.status, 401);
  });
});

describe("POST /api/event", () => {
  it("returns 204 for a valid event", async () => {
    const res = await fetch(`${baseUrl}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "app_open",
        client_id: "test_client_abc123",
        path: "/",
      }),
    });
    assert.equal(res.status, 204);
  });

  it("returns 204 even for unknown event names (silently dropped)", async () => {
    const res = await fetch(`${baseUrl}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "unknown_event",
        client_id: "test_client_abc123",
      }),
    });
    assert.equal(res.status, 204);
  });
});

describe("POST /api/help", () => {
  it("rejects incomplete submissions", async () => {
    const res = await fetch(`${baseUrl}/api/help`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects invalid email", async () => {
    const res = await fetch(`${baseUrl}/api/help`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "not-an-email",
        message: "Test message",
      }),
    });
    assert.equal(res.status, 400);
  });

  it("accepts valid submissions", async () => {
    const res = await fetch(`${baseUrl}/api/help`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        category: "bug",
        message: "This is a test bug report",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("silently accepts honeypot-filled submissions", async () => {
    const res = await fetch(`${baseUrl}/api/help`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Spam Bot",
        email: "spam@bot.com",
        message: "Buy now!",
        honeypot: "I am a bot",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });
});

describe("GET /api/admin/stats", () => {
  it("returns 403 without admin auth", async () => {
    const res = await fetch(`${baseUrl}/api/admin/stats`);
    assert.equal(res.status, 403);
  });
});

describe("GET /api/offers", () => {
  it("returns empty offers without Supabase", async () => {
    const res = await fetch(`${baseUrl}/api/offers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.offers, []);
  });
});

describe("static files", () => {
  it("serves index.html at /", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("JoeQuest"));
  });
});
