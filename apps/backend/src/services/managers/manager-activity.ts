/**
 * Automatic activity recording for manager (and admin) actions on
 * hostel-scoped entities — spec: managers never write these themselves,
 * the service layer records them.
 *
 * Reuses the existing generic writer (`lib/services/activity.service.ts`,
 * already the writer behind the owner-facing hostel activity feed — see
 * `lib/services/hostel-activity-feed-service.ts`) rather than introducing a
 * second audit table. Every entry MUST carry `metadata.hostel_id` — that is
 * the established convention (migrations/082_activity_logs_hostel_index.sql)
 * that read paths (including the new Super Admin activity feed) filter on.
 */
import { activityService } from "@/lib/services/activity.service";

function diffLeaves(before: unknown, after: unknown, prefix = ""): Array<{ field: string; from: unknown; to: unknown }> {
  if (after === null || typeof after !== "object" || Array.isArray(after)) {
    const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
    return changed && prefix ? [{ field: prefix, from: before ?? null, to: after ?? null }] : [];
  }
  const beforeObject = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  return Object.entries(after as Record<string, unknown>).flatMap(([key, value]) =>
    diffLeaves(beforeObject[key], value, prefix ? `${prefix}.${key}` : key),
  );
}

export interface RecordManagerActivityInput {
  actorProfileId: string;
  actorRole: string;
  actorName?: string;
  hostelId?: string | null;
  ownerId?: string | null;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/**
 * One row per call, diffing before/after into `changed_fields` when both are
 * given. Only fires for MANAGER-attributed actions by default — pass
 * `actorRole: "ADMIN"` explicitly if an admin action should also appear in
 * the feed (e.g. an admin performing the same hostel edit a manager could).
 */
export async function recordManagerActivity(input: RecordManagerActivityInput): Promise<void> {
  const changed_fields =
    input.before && input.after ? diffLeaves(input.before, input.after) : undefined;

  await activityService.log({
    userId: input.actorProfileId,
    ownerId: input.ownerId ?? null,
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: {
      hostel_id: input.hostelId ?? null,
      actor_role: input.actorRole,
      actor_name: input.actorName,
      changed_fields,
      ...input.extra,
    },
  });
}
