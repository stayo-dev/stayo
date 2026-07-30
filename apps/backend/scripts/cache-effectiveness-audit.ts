import { NextRequest } from "next/server";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import { del } from "@/lib/redis/cache";
import { redisKeys, hashKey } from "@/lib/redis/keys";
import { getDateRange } from "@/lib/services/analytics-service";

type AuditEndpoint = {
  name: string;
  url: string;
  cacheKey: string;
  call: () => Promise<Response>;
};

type AuditResult = {
  endpoint: string;
  uncached_ms: number;
  cached_ms: number;
  improvement_pct: number;
  uncached_db_queries: number;
  cached_db_queries: number;
  db_queries_avoided: number;
  estimated_hit_rate_pct: number;
  worth_keeping: "YES" | "NO" | "MAYBE";
};

let queryCount = 0;

function patchPrismaQueryCounter() {
  const delegates = [
    "hostels", "tenants", "rooms", "payments", "expenses", "rent_obligations",
    "move_out_requests", "reminder_logs", "visitorLead", "leadActivity", "roomReservation",
  ];
  const methods = ["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"];

  for (const delegateName of delegates) {
    const delegate = (prisma as any)[delegateName];
    if (!delegate) continue;
    for (const method of methods) {
      if (typeof delegate[method] !== "function" || delegate[method].__cacheAuditWrapped) continue;
      const original = delegate[method].bind(delegate);
      const wrapped = (...args: any[]) => {
        queryCount += 1;
        return original(...args);
      };
      wrapped.__cacheAuditWrapped = true;
      delegate[method] = wrapped;
    }
  }

  for (const method of ["$queryRaw", "$queryRawUnsafe"]) {
    const fn = (prisma as any)[method];
    if (typeof fn !== "function" || fn.__cacheAuditWrapped) continue;
    const original = fn.bind(prisma);
    const wrapped = (...args: any[]) => {
      queryCount += 1;
      return original(...args);
    };
    wrapped.__cacheAuditWrapped = true;
    (prisma as any)[method] = wrapped;
  }
}

function ownerRequest(url: string, owner: { id: string; email: string | null }) {
  return new NextRequest(url, {
    headers: {
      "x-user-id": owner.id,
      "x-user-role": "OWNER",
      "x-user-email": owner.email || "",
      "x-owner-id": owner.id,
    },
  });
}

function tenantRequest(url: string, tenantProfile: { id: string; email: string | null }, tenantId: string) {
  return new NextRequest(url, {
    headers: {
      "x-user-id": tenantProfile.id,
      "x-user-role": "TENANT",
      "x-user-email": tenantProfile.email || "",
      "x-tenant-id": tenantId,
    },
  });
}

async function timedCall(call: () => Promise<Response>) {
  queryCount = 0;
  const start = performance.now();
  const response = await call();
  await response.text();
  const elapsed = Math.round(performance.now() - start);
  return { elapsed, queries: queryCount, status: response.status };
}

function worthKeeping(uncachedMs: number, cachedMs: number, dbAvoided: number): "YES" | "NO" | "MAYBE" {
  const saved = uncachedMs - cachedMs;
  if (saved >= 100 || dbAvoided >= 5) return "YES";
  if (saved >= 30 || dbAvoided >= 2) return "MAYBE";
  return "NO";
}

async function measure(endpoint: AuditEndpoint): Promise<AuditResult> {
  await del(endpoint.cacheKey);
  const cold = await timedCall(endpoint.call);
  const warm = await timedCall(endpoint.call);
  if (cold.status >= 400 || warm.status >= 400) {
    throw new Error(`${endpoint.name} returned ${cold.status}/${warm.status}`);
  }

  const improvement = cold.elapsed > 0
    ? Math.round(((cold.elapsed - warm.elapsed) / cold.elapsed) * 1000) / 10
    : 0;
  const avoided = Math.max(0, cold.queries - warm.queries);

  return {
    endpoint: endpoint.name,
    uncached_ms: cold.elapsed,
    cached_ms: warm.elapsed,
    improvement_pct: improvement,
    uncached_db_queries: cold.queries,
    cached_db_queries: warm.queries,
    db_queries_avoided: avoided,
    estimated_hit_rate_pct: 50,
    worth_keeping: worthKeeping(cold.elapsed, warm.elapsed, avoided),
  };
}

async function main() {
  patchPrismaQueryCounter();

  const hostel = await prisma.hostels.findFirst({
    where: { is_active: true },
    select: { id: true, public_slug: true, owner_id: true },
  });
  if (!hostel?.owner_id) throw new Error("No active hostel with owner found");

  const owner = await prisma.profile.findFirst({
    where: { id: hostel.owner_id, role: "OWNER", is_active: true },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error("No active OWNER profile found for active hostel");

  const tenant = await prisma.tenants.findFirst({
    where: { owner_id: owner.id },
    select: { id: true, profile_id: true, profiles: { select: { id: true, email: true } } },
  });

  const months = 6;
  const base = "http://cache-audit.local";
  const { start, end } = getDateRange(null, null);
  const rangeHash = hashKey({ start: start.toISOString(), end: end.toISOString() });

  const [
    dashboardRoute,
    statsRoute,
    summaryRoute,
    monthlyRoute,
    portfolioShellRoute,
    portfolioPerformanceRoute,
    cashflowRoute,
    funnelRoute,
    operationsRoute,
    tenantStatsRoute,
    visitRoute,
    admissionsAnalyticsRoute,
  ] = await Promise.all([
    import("@/app/api/dashboard/route"),
    import("@/app/api/dashboard/stats/route"),
    import("@/app/api/dashboard/summary/route"),
    import("@/app/api/dashboard/monthly-stats/route"),
    import("@/app/api/dashboard/portfolio-shell/route"),
    import("@/app/api/dashboard/portfolio-performance/route"),
    import("@/app/api/dashboard/cashflow/route"),
    import("@/app/api/dashboard/funnel/route"),
    import("@/app/api/dashboard/operations/route"),
    import("@/app/api/dashboard/tenant/stats/route"),
    import("@/app/api/visit/[hostelSlug]/route"),
    import("@/app/api/admissions/leads/analytics/route"),
  ]);

  const endpoints: AuditEndpoint[] = [
    {
      name: "/api/dashboard",
      url: `${base}/api/dashboard?hostelId=${hostel.id}&months=${months}`,
      cacheKey: redisKeys.dashboard.owner(owner.id, hostel.id, months),
      call: () => dashboardRoute.GET(ownerRequest(`${base}/api/dashboard?hostelId=${hostel.id}&months=${months}`, owner)),
    },
    {
      name: "/api/dashboard/stats",
      url: `${base}/api/dashboard/stats?hostelId=${hostel.id}`,
      cacheKey: redisKeys.dashboard.stats(owner.id, hostel.id),
      call: () => statsRoute.GET(ownerRequest(`${base}/api/dashboard/stats?hostelId=${hostel.id}`, owner)),
    },
    {
      name: "/api/dashboard/summary",
      url: `${base}/api/dashboard/summary?hostelId=${hostel.id}`,
      cacheKey: redisKeys.dashboard.stats(owner.id, hostel.id),
      call: () => summaryRoute.GET(ownerRequest(`${base}/api/dashboard/summary?hostelId=${hostel.id}`, owner)),
    },
    {
      name: "/api/dashboard/monthly-stats",
      url: `${base}/api/dashboard/monthly-stats?hostelId=${hostel.id}&months=${months}`,
      cacheKey: redisKeys.dashboard.monthly(owner.id, hostel.id, months),
      call: () => monthlyRoute.GET(ownerRequest(`${base}/api/dashboard/monthly-stats?hostelId=${hostel.id}&months=${months}`, owner)),
    },
    {
      name: "/api/dashboard/portfolio-shell",
      url: `${base}/api/dashboard/portfolio-shell?months=${months}`,
      cacheKey: redisKeys.portfolio.shell(owner.id, months),
      call: () => portfolioShellRoute.GET(ownerRequest(`${base}/api/dashboard/portfolio-shell?months=${months}`, owner)),
    },
    {
      name: "/api/dashboard/portfolio-performance",
      url: `${base}/api/dashboard/portfolio-performance?months=${months}`,
      cacheKey: redisKeys.portfolio.performance(owner.id, months),
      call: () => portfolioPerformanceRoute.GET(ownerRequest(`${base}/api/dashboard/portfolio-performance?months=${months}`, owner)),
    },
    {
      name: "/api/dashboard/cashflow",
      url: `${base}/api/dashboard/cashflow?hostelId=${hostel.id}`,
      cacheKey: redisKeys.analytics.cashflow(owner.id, hostel.id, rangeHash),
      call: () => cashflowRoute.GET(ownerRequest(`${base}/api/dashboard/cashflow?hostelId=${hostel.id}`, owner)),
    },
    {
      name: "/api/dashboard/funnel",
      url: `${base}/api/dashboard/funnel?hostelId=${hostel.id}`,
      cacheKey: redisKeys.analytics.funnel(owner.id, hostel.id, rangeHash),
      call: () => funnelRoute.GET(ownerRequest(`${base}/api/dashboard/funnel?hostelId=${hostel.id}`, owner)),
    },
    {
      name: "/api/dashboard/operations",
      url: `${base}/api/dashboard/operations?hostelId=${hostel.id}`,
      cacheKey: redisKeys.analytics.operations(owner.id, hostel.id, rangeHash),
      call: () => operationsRoute.GET(ownerRequest(`${base}/api/dashboard/operations?hostelId=${hostel.id}`, owner)),
    },
    {
      name: "/api/visit/:hostelSlug",
      url: `${base}/api/visit/${hostel.public_slug}`,
      cacheKey: redisKeys.admissions.publicHostel(hostel.public_slug || ""),
      call: () => visitRoute.GET(new NextRequest(`${base}/api/visit/${hostel.public_slug}`), {
        params: { hostelSlug: hostel.public_slug || "" },
      }),
    },
    {
      name: "/api/admissions/leads/analytics",
      url: `${base}/api/admissions/leads/analytics?hostelId=${hostel.id}`,
      cacheKey: redisKeys.admissions.analytics(owner.id, hostel.id),
      call: () => admissionsAnalyticsRoute.GET(ownerRequest(`${base}/api/admissions/leads/analytics?hostelId=${hostel.id}`, owner)),
    },
  ];

  if (tenant?.profiles) {
    endpoints.push({
      name: "/api/dashboard/tenant/stats",
      url: `${base}/api/dashboard/tenant/stats`,
      cacheKey: redisKeys.dashboard.tenantStats(tenant.profiles.id),
      call: () => tenantStatsRoute.GET(tenantRequest(`${base}/api/dashboard/tenant/stats`, tenant.profiles!, tenant.id)),
    });
  }

  const results: AuditResult[] = [];
  for (const endpoint of endpoints) {
    try {
      results.push(await measure(endpoint));
    } catch (error) {
      results.push({
        endpoint: endpoint.name,
        uncached_ms: -1,
        cached_ms: -1,
        improvement_pct: 0,
        uncached_db_queries: -1,
        cached_db_queries: -1,
        db_queries_avoided: 0,
        estimated_hit_rate_pct: 0,
        worth_keeping: "MAYBE",
      });
      console.error(`[cache-audit] ${endpoint.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(JSON.stringify({
    context: {
      owner_id: owner.id,
      hostel_id: hostel.id,
      has_tenant_context: Boolean(tenant?.profiles),
    },
    results,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
