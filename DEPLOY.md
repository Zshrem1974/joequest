# Deploying JoeQuest to a live URL

This gets JoeQuest off your laptop and onto a real, shareable web address.
Primary path is **Render** (cleanest for this Node + Express app, free tier to start).
Fly.io alternative is at the bottom.

---

## Before you start

You need:
- A **GitHub account** (free) — to hold the code.
- A **Render account** (free) — sign up at render.com with your GitHub.
- Your two **API keys**, rotated if they've ever been pasted anywhere:
  - `GOOGLE_PLACES_API_KEY`
  - `ANTHROPIC_API_KEY`

Security note: the keys go into Render's secret env-var settings, never into the
code or GitHub. The `.gitignore` already prevents `.env` from being committed.

---

## Step 1 — Put the code on GitHub

From the `joequest` folder:

```bash
git init
git add .
git commit -m "JoeQuest live MVP"
```

Then create an empty repo on github.com (call it `joequest`), and:

```bash
git remote add origin https://github.com/YOUR_USERNAME/joequest.git
git branch -M main
git push -u origin main
```

Double-check: your `.env` file should NOT appear on GitHub. If it does, the
`.gitignore` didn't take — fix before continuing.

---

## Step 2 — Create the Render service

Option A — using the blueprint (easiest):
1. In Render, click **New → Blueprint**.
2. Connect your `joequest` GitHub repo.
3. Render reads `render.yaml` and sets up the service automatically.

Option B — manual:
1. **New → Web Service**, connect the repo.
2. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `node server.js`
   - Health check path: `/api/status`
   - Plan: **Free**

---

## Step 3 — Add your API keys as secrets

In the service's **Environment** tab, add two environment variables:

| Key | Value |
|---|---|
| `GOOGLE_PLACES_API_KEY` | your real Google key |
| `ANTHROPIC_API_KEY` | your real Anthropic key |

Save. Render redeploys automatically.

---

## Step 4 — Open it

Render gives you a URL like `https://joequest.onrender.com`.
Open it — you should see live Boca cafés with AI picks.

If you see the "Setup needed" banner, the keys aren't set right — recheck Step 3.

---

## Step 5 (optional) — Custom domain

If you bought `joequest.app`:
1. Render service → **Settings → Custom Domains → Add**.
2. Render shows you a DNS record (a CNAME) to add at your domain registrar.
3. Add it; HTTPS is issued automatically. DNS can take up to an hour.

---

## Important notes for a live deployment

- **Free tier sleeps.** Render's free web services spin down after ~15 min of
  inactivity and take ~30s to wake on the next visit. Fine for sharing with a
  few people; upgrade to a paid instance (~$7/mo) when you want it always-on.
- **The in-memory cache resets on every deploy and every sleep.** That means the
  first café view after a wake re-pays the Google + Claude cost. This is the #1
  reason to do the Supabase persistence step next — it makes the cache (and later,
  user favourites) durable.
- **Restrict your Google key** to the Places API and, ideally, to HTTP referrers
  from your Render domain — so a leaked key can't be abused.
- **Watch your Google billing** the first few days. The $300 trial credit covers a
  lot, but set a budget alert in Google Cloud just in case.

---

## Fly.io alternative

If you prefer Fly (keeps the server always-on cheaply, no cold-start sleep):

```bash
# install flyctl, then:
fly launch --no-deploy        # reads fly.toml
fly secrets set GOOGLE_PLACES_API_KEY=xxx ANTHROPIC_API_KEY=yyy
fly deploy
```

Your app lands at `https://joequest.fly.dev`.
