# FeedFlow

**AI use:** Used Claude Sonnet 5 (Claude Code) for the Sprint 3 RBAC implementation (Supabase
Auth + RLS policies in `supabase_rbac.sql`), the CI/CD pipeline (`lib.js` extraction,
`lib.test.js`, `.github/workflows/ci.yml`), and the structured logging in `app.js`. Prior sprints'
work (PWA/offline, Sheets webhook, dashboard/balance math, brand pass) was also built with Claude
Code — see git log for the commit-by-commit breakdown.

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

## Role-based access control (RBAC)
Real Supabase Auth (email/password), not a role picker. Each account has a row in a `profiles`
table (`id, role, name`) where `role` is one of `tech | manager | cfo`. Row Level Security is
enabled on `movements` and `opening_balances` (see [`supabase_rbac.sql`](supabase_rbac.sql)),
enforced at the database layer regardless of what the client sends:
- **`tech`** (Food Production) — can only `INSERT` `to_mix` movements.
- **`manager`** (Plant Manager) — can `INSERT` any movement type, and write `opening_balances`.
- **`cfo`** (GM) — read-only; no insert policy exists for that role at all.

The client mirrors these boundaries in the UI (hiding tabs a role can't use), but the RLS
policies are what actually stop a request — a `cfo` account can't write a movement even by
calling the API directly, since there's no INSERT policy granting it. See `current_role_id()` in
the migration for how a policy resolves a request's role from `auth.uid()`.

## Live demo
- **App:** https://feedflow-murex.vercel.app/ (auto-deploys on every push to `main`)
- **Repo:** https://github.com/Tanner-Mascaro/feedflow

Install it on a phone: open the URL → Safari (iOS) or Chrome (Android) → **Add to Home
Screen** (or tap the Chrome install banner). It launches full-screen like a native app.

## Roles
- **Food Production** (Paige) — Log batch only. Fast, mixer-side "To Mix" entry.
- **Plant Manager** (Todd) — Log batch + Transactions (Received/Sold-Raw/Transferred/Adjusted) + Dashboard.
- **GM** (Jamey) — Dashboard only.

Each signs in with their own email/password (Supabase Auth) — see [RBAC](#role-based-access-control-rbac) above.

## Observability
`log(level, event, context)` in `app.js` writes structured JSON lines (`{ts, level, event, ...}`)
for every auth attempt, sign-in/sign-out, load failure, save failure, and Sheets-push failure —
e.g. `{"ts":"...","level":"warn","event":"sign_in_failed","email":"...","message":"..."}`. Grep-able
in the browser console today; ready to pipe into a log drain (Vercel log drains, Logflare, etc.)
without touching any call site, since they all go through the one `log()` function.

## CI/CD
- **CI (test on PR):** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `node --test`
  on every pull request into `main` (and on push to `main`, as a safety net). Pure business logic
  — balance math, ticket numbering, movement validation — lives in [`lib.js`](lib.js), free of
  DOM/Supabase dependencies, so it's testable with Node's built-in test runner with zero
  dependencies to install. Tests live in [`lib.test.js`](lib.test.js); run them locally with
  `npm test`.
- **CD (deploy on merge):** Vercel's GitHub integration auto-deploys on every push to `main` —
  no separate workflow needed for that half.

## Vernacular — patterns in this codebase
**Gang-of-Four:**
- **Singleton** — [`app.js:15`](app.js#L15), `const db = supabase.createClient(...)`. One Supabase
  client instance created at module load and reused by every read/write/auth call in the app,
  rather than each function constructing its own.
- **Adapter** — [`app.js:72`](app.js#L72) `rowToMovement()` and [`app.js:86`](app.js#L86)
  `movementToRow()`. Supabase's row shape (`snake_case`, `truck_no`, `logged_by`) is incompatible
  with the app's `Movement` shape (`camelCase`, `truckNo`, `by`); these two functions adapt
  between them in both directions so the rest of the app never sees a raw DB row.
- **Observer** — [`app.js:109`](app.js#L109) `subscribeRealtime()`. The app subscribes to Postgres
  change events on `movements`; every connected client (any role, any device) is a subscriber that
  reacts to the same INSERT event by re-rendering its own view — none of them polls for changes.

**Enterprise Integration Patterns:**
- **Wire Tap** — [`app.js:28`](app.js#L28) `pushToSheet()`, called right after every successful
  `movements` insert. It taps a copy of the movement onto a secondary channel (the Google Sheets
  webhook) without affecting or blocking the primary flow — fire-and-forget, `.catch()` only logs.
- **Publish-Subscribe Channel** — the same Supabase realtime channel from the Observer entry
  above, described at the messaging-architecture level rather than the OO level: one INSERT event
  is broadcast to every subscribed client, not routed to a single consumer (contrast with the
  Point-to-Point Channel the Sheets webhook uses).

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
- **Auth** → Microsoft Entra ID (their existing work logins) via OAuth, instead of standalone
  Supabase email/password accounts. RLS policies stay the same either way.
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
- Locations/roles: `ROLES` in `app.js`. Per-account role/name: the `profiles` table in Supabase.
- Movements live in the Supabase `movements` table — edit/delete rows there directly.
- Opening balances live in the Supabase `opening_balances` table.
- Brand colors live as CSS variables at the top of `styles.css`.
