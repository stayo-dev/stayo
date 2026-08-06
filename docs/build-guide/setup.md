# Setup

## Prerequisites

- Node.js 20 or newer.
- npm.
- A Postgres database.
- Provider accounts for Razorpay, Resend, ImageKit, and WhatsApp if those features are enabled.

**How this works:**
1. The frontend runs as a Vite app.
2. The backend runs as a Next.js app.
3. Prisma connects the backend to Postgres.

## Install backend

```bash
cd apps/backend
npm install
npm run prisma:generate
npm run dev
```

**How this works:**
1. `npm install` installs Next.js, Prisma, and service dependencies.
2. `prisma:generate` creates Prisma Client from the schema.
3. `npm run dev` starts the API and backend admin pages.

## Install frontend v2

```bash
cd apps/frontend
npm install
npm run dev
```

**How this works:**
1. Vite starts the React app.
2. Local API calls use `/api`.
3. Non-local hosts use the hardcoded production API URL.

## Database

Apply Prisma and SQL migration strategy before real data import.
The repo contains Prisma schema and raw SQL migrations.

**How this works:**
1. Prisma describes the current model shape.
2. SQL migrations include database hardening and historical changes.
3. A rebuild must align both before production use.

> **Needs clarification:** There is no root `.env.example` in the repo. Environment values must be reconstructed from code references.

