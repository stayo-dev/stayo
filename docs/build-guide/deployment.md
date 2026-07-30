# Deployment

## Frontend v2

`apps/frontend/vercel.json` builds the Vite app and serves `dist`.
It rewrites SPA paths to `index.html`.
It redirects the apex Sri Adithya domain to the `www` domain.

**How this works:**
1. Vercel runs `npm install`.
2. Vercel runs `vite build`.
3. Browser routes are served by the SPA rewrite.

## Backend

`apps/backend` deploys as a Next.js app.
It exposes API routes, admin pages, and cron endpoints.
`apps/backend/vercel.json` defines scheduled cron calls.

**How this works:**
1. Vercel builds the Next.js app.
2. API routes become serverless functions.
3. Cron schedules call backend endpoints.

## Database

Postgres stores all product data.
Prisma schema and raw SQL migrations must be aligned before launch.

**How this works:**
1. Apply migrations in a controlled environment.
2. Generate Prisma Client for the deployed schema.
3. Run smoke tests before handing over.

## Production checks

- Confirm frontend and backend domains.
- Confirm CORS origins.
- Confirm PhonePe environment is production only when ready.
- Confirm webhook URLs point to the production backend.
- Confirm cron secret is configured.
- Confirm hardcoded Sri Adithya strings are replaced.
- Confirm receipt and legal content match the client.

**How this works:**
1. Domain config protects redirects and callbacks.
2. Provider config protects money movement.
3. Branding checks protect client-facing trust.

