import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * A push subscription belongs to a **browser install, not a person**, so
 * `endpoint` is the key: re-subscribing the same browser updates rather than
 * duplicates, and one person signing in on a second device simply adds a row.
 *
 * `session.sub` is the profile id in this codebase — the same value every
 * `profile_id: session.sub` query in `app/api/` uses.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";

  if (!endpoint || !p256dh || !auth) {
    return apiError("endpoint and keys are required", "VALIDATION_ERROR", 400);
  }

  await prisma.push_subscriptions.upsert({
    where: { endpoint },
    /*
     * Re-subscribing can hand the same endpoint to a *different* profile — a
     * shared or handed-down phone, or simply someone signing out and a
     * colleague signing in. The row is reassigned rather than left pointing at
     * the previous account, which would send that person's rent reminders to
     * whoever now holds the device.
     */
    update: {
      profile_id: session.sub,
      p256dh,
      auth,
      failure_count: 0,
      last_used_at: new Date(),
    },
    create: {
      profile_id: session.sub,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
    },
  });

  return apiResponse({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return apiError("endpoint is required", "VALIDATION_ERROR", 400);

  // Scoped to the session's own profile, so one account cannot unsubscribe
  // another's device by guessing an endpoint.
  await prisma.push_subscriptions.deleteMany({
    where: { endpoint, profile_id: session.sub },
  });

  return apiResponse({ ok: true });
}
