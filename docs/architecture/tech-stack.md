# Tech Stack

## Frontend

| Library | Why it exists |
|---|---|
| React 19 | Renders the canonical `apps/frontend` app. |
| Vite | Builds and serves the SPA quickly. |
| React Router 7 | Defines public, owner, and tenant routes. |
| TanStack Query | Fetches, caches, retries, and invalidates API data. |
| Axios | Centralizes API base URL, auth headers, refresh, and retries. |
| Tailwind CSS 4 | Provides utility styling and design tokens. |
| Radix-style UI components | Supplies accessible primitives for dialogs, sheets, selects, tabs, and menus. |
| lucide-react | Provides consistent interface icons. |
| Recharts | Renders portfolio and finance charts. |
| zustand | Exists in dependencies for state patterns. |

**How this works:**
1. Pages call hooks and feature services.
2. Services call the Axios client.
3. Query keys decide which cached data updates after mutations.

## Backend

| Library | Why it exists |
|---|---|
| Next.js 14 App Router | Hosts API routes, cron endpoints, and admin pages. |
| Prisma 5 | Maps Postgres tables to typed models. |
| Postgres | Stores owners, tenants, rooms, payments, ledgers, and logs. |
| Upstash Redis REST | Accelerates safe reads, distributed rate limits, and queue coordination. |
| Supabase client | Accesses Supabase services with server credentials. |
| Zod | Validates request bodies in selected routes and services. |
| jose and jsonwebtoken | Handle JWT verification and token flows. |
| bcryptjs | Hashes passwords. |
| pdf-lib | Generates receipt PDFs. |
| xlsx | Parses bulk import spreadsheets. |
| Vitest | Runs service and invariant tests. |

**How this works:**
1. Route handlers accept HTTP requests.
2. Service modules validate and execute business rules.
3. Redis serves optional acceleration paths when data is safe to cache.
4. Prisma persists source-of-truth records and returns normalized data.

## Redis acceleration

| Use | Why it exists |
|---|---|
| Rate limiting | Shares login, OTP, payment, and webhook abuse counters across serverless instances. |
| Dashboard cache | Reuses short-lived owner, hostel, tenant, and analytics read responses. |
| Queue primitives | Coordinates future reminder, receipt, rent, and late-fee background work. |
| OTP replay lock | Prevents simultaneous verification attempts for the same OTP. |

**How this works:**
1. Backend code uses centralized helpers in `lib/redis`.
2. Redis failures log warnings and fall back to slower safe behavior.
3. PostgreSQL remains the source of truth for financial and authorization data.

## Provider integrations

| Provider | Why it exists |
|---|---|
| Razorpay | Creates payment attempts and receives payment webhooks. |
| Resend | Sends email notifications and reminders. |
| ImageKit | Stores tenant photos, identity documents, and logos. |
| WhatsApp Cloud API | Sends OTPs and reminder messages. |

**How this works:**
1. Provider credentials live in environment variables.
2. Backend adapters hide provider payload details.
3. Business services record provider results in local tables.

## Testing and checks

| Tool | Why it exists |
|---|---|
| Vitest | Tests billing, financial reconciliation, payments, and service invariants. |
| Custom scripts | Check activation, payment safety, production readiness, and data repair. |
| Vercel cron | Runs periodic backend jobs. |

**How this works:**
1. Tests exercise isolated service rules.
2. Scripts verify production invariants before deployment.
3. Cron endpoints repeat operational tasks on schedule.
