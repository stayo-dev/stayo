import { isLeaveType, validateReturnDate, type LeaveType, type StaySource } from "./stay-status";

/**
 * The Stay Status core (ADR-194). `stay_events` is the permanent truth; the
 * `stay_leaves` projection and every screen are derived from it. This reducer
 * is the only place stay semantics live — the write path and replay both call
 * it, so the projection can always be rebuilt and can never disagree.
 *
 * Future modules add event types and read models; they do not change this.
 */

export const STAY_EVENT_TYPES = [
  "LEAVE_STARTED",
  "RETURN_DATE_CHANGED",
  "RETURNED",
  "LEAVE_CANCELLED",
  "PRESENCE_CONFIRMED",
] as const;
export type StayEventType = (typeof STAY_EVENT_TYPES)[number];
export type ActorRole = "TENANT" | "OWNER" | "SYSTEM";

export interface StayEvent {
  id: string;
  tenantId: string;
  hostelId: string;
  /** The resident's room when the event happened — survives room transfers. */
  roomId: string | null;
  type: StayEventType;
  /** IST calendar date the event applies to. */
  effectiveDate: string;
  occurredAt: string;
  leaveType: LeaveType | null;
  expectedReturnDate: string | null;
  source: StaySource;
  actorProfileId: string | null;
  actorRole: ActorRole;
  idempotencyKey: string;
}

export interface LeaveState {
  /** = the id of the LEAVE_STARTED event that opened it. */
  id: string;
  tenantId: string;
  hostelId: string;
  leaveType: LeaveType;
  startDate: string;
  expectedReturnDate: string;
  status: "ACTIVE" | "RETURNED" | "CANCELLED";
  returnedAt: string | null;
  lastEventId: string;
}

export type StayRejectReason =
  | "NO_ACTIVE_LEAVE"
  | "ON_LEAVE"
  | "INVALID_LEAVE_TYPE"
  | "INVALID_DATE"
  | "TOO_SOON"
  | "TOO_FAR"
  | "UNKNOWN_TYPE";

export type ApplyResult =
  | { kind: "record"; before: LeaveState | null; after: LeaveState | null }
  | { kind: "noop" }
  | { kind: "reject"; reason: StayRejectReason };

export function isStayEventType(value: unknown): value is StayEventType {
  return typeof value === "string" && (STAY_EVENT_TYPES as readonly string[]).includes(value);
}

export function applyStayEvent(active: LeaveState | null, event: StayEvent): ApplyResult {
  switch (event.type) {
    case "LEAVE_STARTED": {
      // A second Going Home (double tap, second device) is already true.
      if (active) return { kind: "noop" };
      if (!isLeaveType(event.leaveType)) return { kind: "reject", reason: "INVALID_LEAVE_TYPE" };
      const problem = validateReturnDate(event.expectedReturnDate, event.effectiveDate);
      if (problem) return { kind: "reject", reason: problem };
      return {
        kind: "record",
        before: null,
        after: {
          id: event.id,
          tenantId: event.tenantId,
          hostelId: event.hostelId,
          leaveType: event.leaveType,
          startDate: event.effectiveDate,
          expectedReturnDate: event.expectedReturnDate as string,
          status: "ACTIVE",
          returnedAt: null,
          lastEventId: event.id,
        },
      };
    }
    case "RETURN_DATE_CHANGED": {
      if (!active) return { kind: "reject", reason: "NO_ACTIVE_LEAVE" };
      const problem = validateReturnDate(event.expectedReturnDate, event.effectiveDate);
      if (problem) return { kind: "reject", reason: problem };
      if (event.expectedReturnDate === active.expectedReturnDate) return { kind: "noop" };
      return {
        kind: "record",
        before: active,
        after: { ...active, expectedReturnDate: event.expectedReturnDate as string, lastEventId: event.id },
      };
    }
    case "RETURNED": {
      // I'm Back twice is still back.
      if (!active) return { kind: "noop" };
      return {
        kind: "record",
        before: active,
        after: { ...active, status: "RETURNED", returnedAt: event.occurredAt, lastEventId: event.id },
      };
    }
    case "LEAVE_CANCELLED": {
      if (!active) return { kind: "reject", reason: "NO_ACTIVE_LEAVE" };
      return { kind: "record", before: active, after: { ...active, status: "CANCELLED", lastEventId: event.id } };
    }
    case "PRESENCE_CONFIRMED": {
      if (active) return { kind: "reject", reason: "ON_LEAVE" };
      return { kind: "record", before: null, after: null };
    }
    default:
      return { kind: "reject", reason: "UNKNOWN_TYPE" };
  }
}

/** Every leave, rebuilt from the stream. `events` must be in `seq` order. */
export function replayStayEvents(events: StayEvent[]): LeaveState[] {
  const activeByTenant = new Map<string, LeaveState>();
  const leavesById = new Map<string, LeaveState>();
  for (const event of events) {
    const result = applyStayEvent(activeByTenant.get(event.tenantId) ?? null, event);
    if (result.kind !== "record" || !result.after) continue;
    leavesById.set(result.after.id, result.after);
    if (result.after.status === "ACTIVE") activeByTenant.set(event.tenantId, result.after);
    else activeByTenant.delete(event.tenantId);
  }
  return Array.from(leavesById.values());
}
