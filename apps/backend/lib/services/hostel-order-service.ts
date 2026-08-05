import { prisma } from "../db";
import { eventLog } from "./event-log-service";

/**
 * HostelOrderService
 *
 * Owns `hostels.display_order` — the owner-controlled position of each hostel
 * in the Home "Property" list. See ADR-042.
 *
 * `display_order` is nullable and is never backfilled. NULL means "the owner
 * has never reordered this hostel"; the read path
 * (`PortfolioService.getPortfolioSummary`) sorts NULLs last and then by name,
 * which is exactly the order the list had before this column existed.
 *
 * Reorder rewrites **every** position for the owner in one transaction rather
 * than patching individual rows. Patching one row at a time cannot express
 * "move to position 2" without either renumbering neighbours anyway or
 * leaving duplicate positions, and two concurrent single-row patches can
 * interleave into an order the owner never asked for.
 */

export class HostelOrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostelOrderError";
  }
}

/** Hostels an owner can order — the same set the Home list renders. */
const ORDERABLE_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export class HostelOrderService {
  /**
   * Persist a new order for every hostel the owner can see.
   *
   * `orderedIds` must be exactly the owner's orderable hostels — same members,
   * no duplicates, nothing missing, nothing foreign. A partial list is
   * rejected rather than best-effort applied: if the client's view of the
   * portfolio is stale (a hostel was added or archived in another tab), the
   * positions it computed are meaningless, and silently applying them would
   * scramble the order the owner is looking at.
   */
  async reorder(ownerId: string, orderedIds: string[]): Promise<{ order: { id: string; display_order: number }[] }> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new HostelOrderError("VALIDATION_ERROR", "order must be a non-empty array of hostel ids");
    }

    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new HostelOrderError("VALIDATION_ERROR", "order contains duplicate hostel ids");
    }

    const owned = await prisma.hostels.findMany({
      where: { owner_id: ownerId, status: { in: [...ORDERABLE_STATUSES] } },
      select: { id: true },
    });
    const ownedIds = new Set<string>(owned.map((h: { id: string }) => h.id));

    const foreign = orderedIds.filter((id) => !ownedIds.has(id));
    if (foreign.length > 0) {
      // Same treatment the hostel-scope guards use — an id the owner doesn't
      // own is a scope violation, not a validation nit.
      await eventLog.log("HOSTEL_SCOPE_VIOLATION", ownerId, { hostel_ids: foreign, source: "hostel_reorder" });
      throw new HostelOrderError("FORBIDDEN", "One or more hostels are not owned by the authenticated owner");
    }

    // Array.from rather than spread — this tsconfig targets below es2015 for
    // downlevelIteration, so `[...set]` doesn't compile.
    const missing = Array.from(ownedIds).filter((id) => !unique.has(id));
    if (missing.length > 0) {
      throw new HostelOrderError(
        "STALE_ORDER",
        "order must include every hostel in the portfolio; refresh and try again"
      );
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.hostels.update({
          where: { id },
          data: { display_order: index, updated_at: new Date() },
        })
      )
    );

    return { order: orderedIds.map((id, index) => ({ id, display_order: index })) };
  }
}

export const hostelOrderService = new HostelOrderService();
