# FeedFlow — demo

Batch-logging PWA for Fur Breeders Agricultural Cooperative. Techs log raw-ingredient
usage at the mixer; managers and leadership see it live and export to Excel.
**From estimates to actuals.**

Vanilla HTML/CSS/JS. No build step. Data lives in Supabase (Postgres), table `entries`
(`id, ts, plant, ingredient, qty, unit, logged_by, notes, created_at`). Dashboard updates
live via a Supabase realtime subscription when any device logs a batch.

**Note:** RLS is currently disabled on `entries`, so the anon key in `app.js` has open
read/write access to the table. Fine for the demo with no auth wired up yet; tighten with
RLS policies (or real auth) before this goes anywhere production-adjacent.

## Run it locally
Because of the service worker, open it through a tiny web server (not `file://`):

```bash
cd feedflow
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy for the demo (free, ~2 min)
1. Push this folder to a GitHub repo.
2. Go to vercel.com → New Project → import the repo → Deploy. No settings needed.
3. Open the live URL on your phone → browser menu → **Add to Home Screen**. It installs like an app.

## Demo flow (the pitch)
1. **Log batch** as *Inventory technician* on a phone: pick plant, ingredient, amount → **Log batch**. Under 15 seconds, captured with time + name automatically.
2. **Dashboard** as *CFO / leadership*: KPIs, usage-by-ingredient, daily volume, full batch log.
3. **Export to Excel**: real `.xlsx` file, opens in his workbook.

Three logins show the role-based access: tech = logging only, manager = both, CFO = dashboard only.

## What to swap for production
- **Auth** → Microsoft Entra ID (their existing work logins) via OAuth. Also means turning on
  RLS policies on `entries` scoped to authenticated users/roles, since it's currently wide open.
- **Live spreadsheet** → demo pushes to Google Sheets via an Apps Script webhook (easy API).
  Production pushes into his existing Excel workbook via the Microsoft Graph API. The DB is the
  source of truth either way, so this is only the final "push" step changing.
- **Scheduled end-of-day export** → a cron job on the server.

## Edit the data
- Ingredient list: `INGREDIENTS` array in `app.js`.
- Plants, roles, names: `ROLES` / `NAMES` in `app.js`.
- Batch entries live in the Supabase `entries` table now — edit/delete rows there directly.
- Brand colors live as CSS variables at the top of `styles.css`.
