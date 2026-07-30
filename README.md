# FeedFlow

Inventory-movement PWA for Fur Breeders Agricultural Cooperative (FBAC), modeled on
their real Excel inventory system. Food Production logs batches at the mixer; the
Plant Manager logs receipts/sales/transfers/adjustments and reviews; the GM sees live
Beg → End balance rollups per location. **From estimates to actuals.**

Vanilla HTML/CSS/JS. No build step. Data lives in Supabase (Postgres):
- `movements` (`id, ts, location, ingredient, type, qty, unit, truck_no, notes, logged_by, created_at`)
  — `type` is one of `to_mix | received | sold_raw | transferred | adjusted`
- `opening_balances` (`location, ingredient, qty`) — the starting balance each ingredient/location
  is measured against

`End Balance = Beg + Received − To Mix − Sold (Raw) + Transferred + Adjusted`, matching the
workbook's Monthly Inventory math. Dashboard updates live via a Supabase realtime subscription
whenever any device logs a movement.

**Note:** RLS is disabled on both tables, so the anon key in `app.js` has open read/write access.
Fine for now with no real auth wired up; tighten with RLS policies (or real auth) before this goes
anywhere production-adjacent.

## Live demo
- **App:** https://feedflow-murex.vercel.app/ (auto-deploys on every push to `main`)
- **Repo:** https://github.com/Tanner-Mascaro/feedflow

Install it on a phone: open the URL → Safari (iOS) or Chrome (Android) → **Add to Home
Screen** (or tap the Chrome install banner). It launches full-screen like a native app.

## Roles
- **Food Production** (Paige) — Log batch only. Fast, mixer-side "To Mix" entry.
- **Plant Manager** (Todd) — Log batch + Transactions (Received/Sold-Raw/Transferred/Adjusted) + Dashboard.
- **GM** (Jamey) — Dashboard only.

No real login yet — this is a role-picker demo. Swap for real auth before production (see below).

## Run it locally
Because of the service worker, open it through a tiny web server (not `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy for the demo (free, ~2 min)
1. Push to the GitHub repo above (or your own fork).
2. Vercel is already connected — pushing to `main` auto-deploys. For a fresh setup: vercel.com
   → New Project → import the repo → Deploy. No build settings needed.
3. Open the live URL on your phone → **Add to Home Screen**.

## Service worker cache-busting
`sw.js` caches the app shell (HTML/CSS/JS/icons) for offline use with a versioned cache name
(`feedflow-vN`). Browsers only re-check for service-worker updates by diffing `sw.js` itself —
**editing `styles.css` or `app.js` alone will not push to already-installed devices.** Whenever
you change any cached file, bump the `CACHE` constant in `sw.js` (e.g. `v9` → `v10`) so installed
PWAs actually detect the update and refetch. After deploying, fully quit and reopen the installed
app on the phone to pick it up (it self-activates via `skipWaiting`/`clients.claim`, no waiting
period, but still needs a relaunch to trigger the check).

## Google Sheets live push
Every movement fires a fire-and-forget webhook to a Google Apps Script Web App
(`SHEETS_WEBHOOK_URL` in `app.js`), which appends to one of two tabs in the target sheet:
**Log** (To Mix entries) or **Transactions** (Received/Sold/Transferred/Adjusted) — the Apps
Script `doPost` auto-creates both tabs with headers if they don't exist yet.

## What to swap for production
- **Auth** → Microsoft Entra ID (their existing work logins) via OAuth. Also means turning on
  RLS policies on `movements`/`opening_balances` scoped to authenticated users/roles.
- **Live spreadsheet** → demo pushes to Google Sheets via the Apps Script webhook above.
  Production pushes into their existing Excel workbook via the Microsoft Graph API. The DB is
  the source of truth either way, so this is only the final "push" step changing.
- **Scheduled end-of-day export** → a cron job on the server.
- **Month-end close** — not built yet. The real workbook has a formal close process (readiness
  checklist, `CloseMonth` macro, balance rollover, Snapshots archive); this app currently just
  accumulates against a single seeded opening balance with no month boundary.

## Brand
Colors, typography, and logo usage follow FBAC's Brand Standards Manual (FBAC Blue #1B3A6B,
Heritage Gold #C9A227, Inter for body text, Roboto Slab standing in for the unavailable western
display typeface). The manual itself and the internal `.xlsm` inventory workbook are gitignored —
confidential, not for public distribution. Logo assets (`logo-primary.png`, `logo-white.png`, and
the mink mark composited into the app icons) were extracted from the manual's embedded images.

## Edit the data
- Ingredient list: `INGREDIENTS` array in `app.js`.
- Locations, roles, names: `ROLES` / `NAMES` in `app.js`.
- Movements live in the Supabase `movements` table — edit/delete rows there directly.
- Opening balances live in the Supabase `opening_balances` table.
- Brand colors live as CSS variables at the top of `styles.css`.
