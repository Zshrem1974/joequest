import { test, expect } from "@playwright/test";

// Skip the onboarding overlay by setting localStorage before page load
async function skipOnboarding(page) {
  await page.addInitScript(() => {
    localStorage.setItem("jq.onboarded", "1");
    localStorage.setItem("jq.city", "boca-raton");
  });
}

test.describe("App shell", () => {
  test("loads and shows JoeQuest title", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/JoeQuest/);
  });

  test("header is visible with logo", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator("#logo-home")).toBeVisible();
  });

  test("tab bar renders three tabs", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator(".tab-bar .tab")).toHaveCount(3);
  });

  test("discover view is active by default", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator("#view-discover")).toHaveClass(/active/);
  });
});

test.describe("Discover view", () => {
  test("shows cafe list with cards", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    const firstCard = page.locator("#discover-list > *").first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    const count = await page.locator("#discover-list > *").count();
    expect(count).toBeGreaterThan(0);
  });

  test("shows city name", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator("#discover-city-name")).not.toHaveText("…", { timeout: 5000 });
  });

  test("shows cafe count", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator("#discover-count")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Tab navigation", () => {
  test("switching to Map tab shows map view", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await page.locator("button.tab[data-tab='map']").click();
    await expect(page.locator("#view-map")).toHaveClass(/active/);
    await expect(page.locator("#view-discover")).not.toHaveClass(/active/);
  });

  test("switching to Saved tab shows saved view", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await page.locator("button.tab[data-tab='saved']").click();
    await expect(page.locator("#view-saved")).toHaveClass(/active/);
  });

  test("switching back to Discover works", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await page.locator("button.tab[data-tab='map']").click();
    await expect(page.locator("#view-map")).toHaveClass(/active/);
    await page.locator("button.tab[data-tab='discover']").click();
    await expect(page.locator("#view-discover")).toHaveClass(/active/);
  });
});

test.describe("Cafe detail sheet", () => {
  test("clicking a cafe card opens the sheet", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    const firstCard = page.locator("#discover-list > *").first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();
    await expect(page.locator("#sheet")).toHaveClass(/open/, { timeout: 5000 });
  });

  test("sheet shows cafe name", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    const firstCard = page.locator("#discover-list > *").first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();
    await expect(page.locator("#sheet")).toHaveClass(/open/, { timeout: 5000 });
    const title = page.locator("#sheet-title");
    await expect(title).toBeVisible();
    const text = await title.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test("sheet shows picks area", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    const firstCard = page.locator("#discover-list > *").first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();
    await expect(page.locator("#sheet")).toHaveClass(/open/, { timeout: 5000 });
    await expect(page.locator("#sheet-picks")).toBeVisible();
  });
});

test.describe("Menu drawer", () => {
  test("menu button opens drawer", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await page.locator("#menu-btn").click();
    const drawer = page.locator("#drawer");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true", { timeout: 3000 });
  });
});

test.describe("City switcher", () => {
  test("city button is visible", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator("#discover-city-btn")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("API endpoints", () => {
  test("GET /api/status returns ok", async ({ request }) => {
    const res = await request.get("/api/status");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("GET /api/cafes returns cafe list", async ({ request }) => {
    const res = await request.get("/api/cafes");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.cafes.length).toBeGreaterThan(0);
    expect(body.citySlug).toBe("boca-raton");
  });

  test("GET /api/cafes?city=miami returns Miami cafes", async ({ request }) => {
    const res = await request.get("/api/cafes?city=miami");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.citySlug).toBe("miami");
    expect(body.cafes.length).toBeGreaterThan(0);
  });

  test("GET /api/cities returns city list", async ({ request }) => {
    const res = await request.get("/api/cities");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.cities.length).toBeGreaterThan(0);
    const slugs = body.cities.map((c) => c.slug);
    expect(slugs).toContain("boca-raton");
    expect(slugs).toContain("miami");
  });

  test("GET /api/cafes/:id returns detail with picks", async ({ request }) => {
    const listRes = await request.get("/api/cafes");
    const list = await listRes.json();
    const id = list.cafes[0].id;
    const res = await request.get(`/api/cafes/${id}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.picks).toBeTruthy();
    expect(body.source).toBe("snapshot");
  });

  test("GET /api/cafes/BOGUS returns 404", async ({ request }) => {
    const res = await request.get("/api/cafes/BOGUS_PLACE_ID");
    expect(res.status()).toBe(404);
  });
});

test.describe("PWA assets", () => {
  test("manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toContain("JoeQuest");
  });

  test("service worker is served", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBeTruthy();
  });
});
