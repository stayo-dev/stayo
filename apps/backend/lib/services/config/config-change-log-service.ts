import { ActivityService } from "../activity.service";
import { describeConfigChange, moduleForDomain } from "./config-change-labels";

/**
 * Records configuration changes so the Configuration hub's Recent Changes
 * timeline has something true to show.
 *
 * Reuses `activity_logs` through the existing `ActivityService` — no migration,
 * and the same table `move-out-service` already writes to. Fire-and-forget by
 * inheritance: `ActivityService.log()` swallows its own failures, so a logging
 * problem can never fail the policy write the owner actually asked for.
 *
 * Only leaves are diffed, and only the domains an owner can see. A field with
 * no phrasing degrades to "<Field> updated" rather than being skipped, so the
 * feed stays complete as new policy fields appear.
 */
export const CONFIG_CHANGED_ACTION = "CONFIG_CHANGED";
export const CONFIG_ENTITY_TYPE = "hostel_policy";

const activity = new ActivityService();

/** Leaf-level diff, `a.b.c` paths. Arrays compare whole rather than per index. */
function diffLeaves(
  before: unknown,
  after: unknown,
  prefix = "",
): Array<{ field: string; from: unknown; to: unknown }> {
  if (after === null || typeof after !== "object" || Array.isArray(after)) {
    const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
    return changed && prefix ? [{ field: prefix, from: before, to: after }] : [];
  }

  const beforeObject = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  return Object.entries(after as Record<string, unknown>).flatMap(([key, value]) =>
    diffLeaves(beforeObject[key], value, prefix ? `${prefix}.${key}` : key),
  );
}

export interface PolicyChangeContext {
  hostelId: string;
  ownerId: string | null;
  userId: string;
  /** The stored policy before the write, and the patch that was applied. */
  before: Record<string, unknown>;
  patch: Record<string, unknown>;
}

/**
 * One log entry per changed leaf. The patch drives the walk, so untouched
 * domains cost nothing and a partial PATCH never looks like a full rewrite.
 */
export async function recordPolicyChanges(context: PolicyChangeContext): Promise<number> {
  const { hostelId, ownerId, userId, before, patch } = context;

  const entries = Object.entries(patch).flatMap(([domain, domainPatch]) => {
    const module = moduleForDomain(domain);
    return diffLeaves((before ?? {})[domain], domainPatch).map((change) => ({
      domain,
      module,
      field: change.field,
      label: describeConfigChange({ domain, field: change.field, from: change.from, to: change.to }),
    }));
  });

  for (const entry of entries) {
    await activity.log({
      userId,
      ownerId,
      actionType: CONFIG_CHANGED_ACTION,
      entityType: CONFIG_ENTITY_TYPE,
      entityId: hostelId,
      metadata: { module: entry.module, domain: entry.domain, field: entry.field, label: entry.label },
    });
  }

  return entries.length;
}
