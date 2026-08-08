export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { CONFIG_CHANGED_ACTION, CONFIG_ENTITY_TYPE } from "@/lib/services/config/config-change-log-service";

/**
 * Recent configuration changes for the Configuration hub's timeline.
 *
 * Owner-scoped through `resolveOwnerScope`, and filtered on `owner_id` in the
 * query itself rather than after the fact — `activity_logs` holds every owner's
 * rows, so scoping is the only thing keeping one workspace's change history out
 * of another's feed.
 *
 * Returns an empty list rather than an error when nothing has been logged: no
 * historical backfill is possible, since nothing wrote config changes before
 * this shipped. The timeline fills as changes are made.
 */
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const requested = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(1, requested), MAX_LIMIT) : DEFAULT_LIMIT;

    const rows = await prisma.activity_logs.findMany({
      where: {
        owner_id: scope.owner_id,
        action_type: CONFIG_CHANGED_ACTION,
        entity_type: CONFIG_ENTITY_TYPE,
      },
      orderBy: { timestamp: "desc" },
      take: limit,
      select: { id: true, user_id: true, metadata: true, timestamp: true },
    });

    // One lookup for the distinct actors rather than a join per row — these
    // feeds are short, and the actor is only ever a name here.
    type LogRow = { id: string; user_id: string; metadata: unknown; timestamp: Date };
    const logRows = rows as LogRow[];
    const actorIds = Array.from(new Set(logRows.map((row) => row.user_id)));
    const actors = actorIds.length
      ? await prisma.profile.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const actorNames = new Map(
      (actors as Array<{ id: string; name: string }>).map((actor) => [actor.id, actor.name]),
    );

    return apiResponse({
      changes: logRows.map((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          label: typeof metadata.label === "string" ? metadata.label : "Configuration updated",
          module: typeof metadata.module === "string" ? metadata.module : "Configuration",
          at: row.timestamp,
          actor: {
            name: actorNames.get(row.user_id) ?? "Someone",
            // Lets the UI say "You" without the client having to know who it is.
            is_you: row.user_id === scope.actor_id,
          },
        };
      }),
    });
  } catch (error: any) {
    const message = String(error?.message || "Could not load configuration changes");
    if (message.startsWith("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    console.error("[owner.config-changes] failed", { error: message });
    return apiError("Could not load configuration changes", "CONFIG_CHANGES_ERROR", 500);
  }
}
