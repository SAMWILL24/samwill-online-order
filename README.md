# SAMWILL Online Order

Online ordering system for SAMWILL's restaurant — separate product from the
`server`/`android-player` digital-signage system, sharing only the company name.

## Structure

- `server/` — Node + Express + SQLite API, Stripe integration, EJS admin dashboard, socket.io (port **4000**)
- `web/` — React + Vite customer ordering site (port **5173**)
- `mobile/` — Expo/React Native customer ordering app (Metro on port **8081**)

## Running it

```bash
# 1. Backend (start first, both clients depend on it)
cd server
npm install
npm run seed   # only needed once, or after deleting data/online-order.sqlite
npm start      # http://localhost:4000

# 2. Web app
cd web
npm install
npm run dev    # http://localhost:5173

# 3. Mobile app
cd mobile
npm install
npm start      # then press "w" for web preview, or scan the QR code with Expo Go
```

## Admin dashboard

`http://localhost:4000/admin/login`

Default credentials (from `server/.env` `ADMIN_EMAIL` / `ADMIN_PASSWORD`, seeded on first `npm run seed`):
`admin@samwill.local` / `change-me-on-first-login` — **change this in `server/.env` before any real deployment.**

Manage categories/items/sizes/extras under **Menu**, restaurant hours/fees under **Settings**, and watch orders arrive live under **Orders**.

## Menu data

Seeded with a demo pizza-shop menu (`server/db/seed.js`) as a placeholder. Replace it either by:
- Editing menu items directly in the admin dashboard once real menu data is available, or
- Editing `server/db/seed.js` and re-seeding against a fresh database.

## Stripe payments

Code is fully wired (PaymentIntent creation in `server/routes/orders.js`, webhook handling in
`server/routes/webhooks.js`, Stripe Elements on web, Payment Sheet on mobile). Without a key configured,
orders are still created normally but skip payment processing — useful for testing the rest of the flow.

To enable real payments:
1. Create a Stripe account and grab test keys from the Stripe dashboard.
2. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `server/.env`.
3. Set `VITE_STRIPE_PUBLISHABLE_KEY` in `web/.env.development`.
4. Set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `mobile/.env`.
5. For local webhook testing: `stripe listen --forward-to localhost:4000/api/webhooks/stripe`.

## Dev-only notes

- `server/.env` `CORS_ORIGIN` is a comma-separated list — add any new local dev origin (e.g. a different
  Expo/Vite port) to it, or the browser will silently fail to reach the API.
- The mobile app's web preview (`npm run web` / pressing "w") is for local dev convenience only — the
  `@stripe/stripe-react-native` module doesn't support web, so `metro.config.js` aliases it to a stub
  (`src/lib/stripeWebStub.js`) on that platform only. Real payments on mobile only work on iOS/Android.
- SQLite database lives at `server/data/online-order.sqlite` (gitignored). Delete it and re-run `npm run seed`
  to start fresh.
