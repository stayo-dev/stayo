export const runtime = "edge";
export const dynamic = "force-dynamic";

import { getEdgeRedisClientForDiagnostics } from "@/lib/redis/session-revocation-edge";

/**
 * 🩺 EDGE REDIS DIAGNOSTIC
 *
 * Answers one question that nothing else can: **can the Edge Runtime reach
 * Redis?**
 *
 * Why it needs its own route: `/api/health` is `runtime = "nodejs"`, so it
 * structurally cannot test the Edge client. `middleware.ts` — which enforces
 * logout revocation and the 30-minute idle timeout — runs on Edge with a
 * *separate* client (`getEdgeRedisClient`) resolving env independently, and
 * every Redis call it makes happens only *after* a token verifies. So no
 * unauthenticated request reaches the Edge client, and a successful
 * Node-side probe (e.g. a rate-limit 429) proves nothing about it. Both Edge
 * controls fail **open** when Redis is unreachable, silently.
 *
 * Deliberately NOT a security dependency: nothing imports this, no code path
 * branches on its output, and its failure changes no behavior. It is an
 * observability tool for a human, and removing it would break nothing.
 *
 * Never returns the Redis URL or token — only a status, and the resolved key
 * prefix, which is a namespace string (default `hms`, documented in
 * `.env.example`), not a credential.
 */
type Status = "ok" | "unreachable" | "not_configured" | "roundtrip_mismatch";

/**
 * Per-instance throttle. This route is public (it sits under the
 * `/api/health` prefix that `middleware.ts` treats as public), and each call
 * costs 3 Upstash commands against a free-tier quota. Repeat callers get the
 * last result instead of new traffic. Not a security control — just
 * politeness toward the quota.
 */
const RESULT_TTL_MS = 10_000;
let cached: { at: number; body: Record<string, unknown> } | null = null;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function GET() {
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) {
    return json({ ...cached.body, cached: true });
  }

  const keyPrefix = process.env.REDIS_KEY_PREFIX || "hms";
  const redis = getEdgeRedisClientForDiagnostics();

  if (!redis) {
    // Either REDIS_ENABLED=false, or the URL/token are absent in the Edge
    // runtime's env — which is exactly the failure this route exists to make
    // visible, since the app would otherwise just fail open.
    const body = {
      status: "not_configured" as Status,
      runtime: "edge",
      key_prefix: keyPrefix,
      redis_enabled: process.env.REDIS_ENABLED !== "false",
      note: "Edge runtime has no Redis client: logout revocation and idle timeout are failing open.",
    };
    cached = { at: Date.now(), body };
    return json(body);
  }

  // A `diagnostic` segment under the normal prefix/version namespace: it
  // shares the prefix so it respects per-environment separation, but no
  // application key builder in lib/redis/keys.ts ever emits `diagnostic`, so
  // it cannot collide with real data. The UUID makes each run unique, and the
  // 30s TTL means an abandoned key disappears even if the DEL below fails.
  const key = `${keyPrefix}:v1:diagnostic:edge:${crypto.randomUUID()}`;
  const token = crypto.randomUUID();

  try {
    await redis.set(key, token, { ex: 30 });
    const readBack = await redis.get<string>(key);
    await redis.del(key);

    const status: Status = readBack === token ? "ok" : "roundtrip_mismatch";
    const body = {
      status,
      runtime: "edge",
      key_prefix: keyPrefix,
      checks: { set: true, get: readBack !== null, del: true },
      note:
        status === "ok"
          ? "Edge runtime reached Redis: logout revocation and idle timeout have a working backing store."
          : "Edge runtime wrote a key but read back a different value — investigate before trusting revocation.",
    };
    cached = { at: Date.now(), body };
    return json(body);
  } catch (error) {
    const body = {
      status: "unreachable" as Status,
      runtime: "edge",
      key_prefix: keyPrefix,
      // Message only, never the client config — a connection error can
      // otherwise echo the URL back.
      error: error instanceof Error ? error.name : "UnknownError",
      note: "Edge runtime could not complete a Redis round-trip: logout revocation and idle timeout are failing open.",
    };
    cached = { at: Date.now(), body };
    return json(body, 503);
  }
}
