---
tags: [performance, backend]
---

# Performance

Related: [[Architecture]] · [[Backend]] · [[Database]] · [[Decisions]] · [[Changelog]] · [[Bugs]]

Measured backend latency baselines. **Every number on this page is a measured value.** Where something has not been measured it is listed under [Not yet measured](#not-yet-measured) rather than estimated — do not fill these gaps with projections.

## Method

- All HTTP figures are `curl` TTFB (`%{time_starttransfer}`) against production `https://api.yourstayo.com`, taken from a client in India.
- Two endpoints are used as a matched pair, so the database cost can be isolated by subtraction:
  - `GET /api/tenants?hostelId=x` **unauthenticated** → 401 from middleware, **touches no database**. Measures edge + function + middleware overhead.
  - `GET /api/health` → the same path **plus a single `SELECT 1`**. The difference between the two is the cost of one database round-trip.
- Query counts come from a read-only script using Prisma's `query` event (`prisma.$on('query')`) against the production database. **Query counts are location-independent**; the engine durations beside them are not (see the caveat below).

> [!warning] Measurement caveat — local DNS
> One measurement round produced a uniform ~15.1s on *both* endpoints, including the no-database path. This was **not** a server regression: `curl` attributed the full delay to `time_namelookup`, and an unrelated host (`vercel.com`) showed the identical 15.01s. The local resolver was timing out.
> Measurements on this page bypass DNS with `curl --resolve api.yourstayo.com:443:<ip>`. If a future run shows a large uniform jump across unrelated endpoints, check `time_namelookup` before concluding anything about the backend.

## Baselines

Three states, in the order they shipped. See [[Decisions#ADR-041]] for why each change was made.

### 1. Before region pin — functions in `iad1`

`x-vercel-id: bom1::iad1::…` — request entered the Mumbai edge, function executed in Washington DC, database in `ap-south-1` (Mumbai).

| Measurement | Value |
|---|---|
| No-DB path (401) | **117ms** median (n=3) |
| `GET /api/health` | **1388ms** median (n=3), range 1349–1587ms |
| Cost of one DB round-trip (derived) | **~1271ms** |

### 2. After region pin — functions in `bom1`

`x-vercel-id: bom1::bom1::…`. Change: `"regions": ["bom1"]` in `apps/backend/vercel.json`. No code changes.

| Measurement | Value |
|---|---|
| No-DB path (401) | **158ms** median (n=10) |
| `GET /api/health` | **186ms** median (n=10), range 135–1460ms |
| Cost of one DB round-trip (derived) | **~28ms** |

The 1460ms maximum in that sample is a fresh Postgres connection being established. It became rare rather than universal; it did not disappear.

### 3. After `relationJoins` — Prisma `join` load strategy

Change: `previewFeatures = ["relationJoins"]` in `apps/backend/prisma/schema.prisma`. No service or business-logic changes. Enabling the flag is sufficient — **`join` is the default relation load strategy** on PostgreSQL once the preview feature is on, confirmed by measurement (an unspecified strategy emits the same 4 queries as an explicit `join`).

HTTP endpoints, re-measured with DNS bypassed:

| Measurement | Value |
|---|---|
| No-DB path (401) | **126ms** median (n=12), range 100–713ms |
| `GET /api/health` | **146ms** median (n=12), range 112–326ms |

`/api/health` runs `SELECT 1` and loads no relations, so `relationJoins` cannot affect it. The difference from state 2 is sampling noise, not an improvement — it is recorded only to show the endpoint did not regress.

The relevant measurement is the `findMany` in `tenantService.getAllTenants`, whose `include` covers 10 relations:

| Relation load strategy | SQL queries | Engine time (3 runs) |
|---|---|---|
| `query` (behaviour before this change) | **14** | 844 / 562 / 1055 ms |
| `join` (default after this change) | **4** | 448 / 189 / 299 ms |
| unspecified | **4** | 289 / 144 / 286 ms |

Query count was identical on every run. **The engine durations were measured from a local machine, not from the function**, so they carry that client's network latency to Mumbai and are not production figures — the 14 → 4 count is the reliable result here.

Result equivalence was verified before deploying: `query` and `join` return identical rows for this `include` across every hostel in the database.

## Not yet measured

- **`GET /api/tenants` end-to-end HTTP latency**, in any of the three states. The endpoint requires an authenticated owner session; measuring it needs either a browser-side timing run while logged in, or a minted session token. No before/after comparison exists for this endpoint.
- **Request-level query count for `GET /api/tenants`.** The 14 → 4 figure covers only the `getAllTenants` `findMany`. The full request additionally issues the `requireHostelBelongsToOwner` check and one `getReservationStatus` call per `INVITED` tenant (each of which itself makes a tenant lookup followed by an awaited `getActivationFinancialStatus`). `relationJoins` does not affect either. The request-level total is therefore higher than 4 and has not been measured.
- **Query timings as executed from the function.** Would require Vercel runtime logs (`vercel logs`) or in-request instrumentation; neither the Vercel CLI nor an authorized Vercel MCP connection was available.

## Known remaining cost centres

Identified by reading the code, **not measured**, and deliberately left untouched so far:

- `rent_obligations` is fetched with status `PAID` included and all nested `payments`, with no date bound ([`tenant-service.ts`](../../apps/backend/src/services/tenants/tenant-service.ts)). Paid obligations accumulate permanently, so this row set grows every month per tenant.
- `getReservationStatus` runs per `INVITED` tenant, sequentially within each call.
- `requireHostelBelongsToOwner` is awaited before the list query it guards, rather than concurrently.
- The "All Hostels" view fans out one request per hostel ([`useRealTenantList.ts`](../../apps/frontend/src/features/owner-tenants/hooks/useRealTenantList.ts)). This is deliberate — it exists to satisfy the no-`hostels[0]` invariant in [[Architecture]] — but it multiplies concurrent load.
