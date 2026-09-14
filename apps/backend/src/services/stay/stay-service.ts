import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { addDaysIso, istDateOf } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE, roomCapacityService } from "@/lib/services/room-capacity-service";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";
import { applyStayEvent, isStayEventType, type ActorRole, type LeaveState, type StayEvent } from "./stay-events";
import {
  deriveStayStatus,
  isStaySource,
  MAX_RETURN_DAYS,
  smartReturnDate,
  type LeaveType,
  type StayStatus,
  type SuggestedReturn,
} from "./stay-status";
import { buildStayBoard, summarizeHostel, summarizePortfolio, type BoardResident, type StayBoard } from "./stay-board";
import { eventToRow, leaveFromRow, leaveToRow, toDbDate } from "./stay-rows";
import { ineligible, invalidRequest, rejection } from "./stay-errors";

/**
 * Stay Status I/O (ADR-194). `recordStayEvent` is the ONE write path — app,
 * QR, owner and (later) WhatsApp all call it. It appends to `stay_events` and
 * moves the `stay_leaves` projection in one transaction, using the pure
 * reducer. Reads compose the existing resident predicate and
 * `roomCapacityService`; nothing here recalculates occupancy.
 */

export interface DateWindow {
  today: string;
  suggestedReturn: SuggestedReturn;
  minReturnDate: string;
  maxReturnDate: string;
}

export interface TenantStay extends DateWindow {
  status: StayStatus;
  leave: { leaveType: LeaveType; startDate: string; expectedReturnDate: string } | null;
}

export interface MyStay {
  tenantId: string | null;
  hostel: { id: string; name: string } | null;
  resident: boolean;
  stay: TenantStay | null;
}

export type StayBoardView = StayBoard & DateWindow;

export interface RecordStayEventInput {
  tenantId: string;
  hostelId: string;
  type: unknown;
  leaveType?: unknown;
  expectedReturnDate?: unknown;
  source: unknown;
  actorProfileId: string | null;
  actorRole: ActorRole;
  idempotencyKey?: unknown;
  now?: Date;
}

const CLIENT_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** Thrown inside the write transaction so it rolls back when another write moved the leave first. */
class LostRace extends Error {}

function dateWindow(today: string): DateWindow {
  return {
    today,
    suggestedReturn: smartReturnDate(today),
    minReturnDate: addDaysIso(today, 1),
    maxReturnDate: addDaysIso(today, MAX_RETURN_DAYS),
  };
}

export function createStayService(deps: { db?: any; capacity?: typeof roomCapacityService } = {}) {
  const db = deps.db ?? prisma;
  const capacity = deps.capacity ?? roomCapacityService;

  /** The tenant's occupying allocation in this hostel — i.e. "is a resident here". */
  function findResidency(tenantId: string, hostelId: string) {
    return db.roomAllocation.findFirst({
      where: { tenant_id: tenantId, hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
      select: { room_id: true },
    });
  }

  async function activeLeave(tenantId: string): Promise<LeaveState | null> {
    const row = await db.stay_leaves.findFirst({ where: { tenant_id: tenantId, status: "ACTIVE" } });
    return row ? leaveFromRow(row) : null;
  }

  async function tenantStay(tenantId: string, today: string): Promise<TenantStay> {
    const leave = await activeLeave(tenantId);
    return {
      status: deriveStayStatus(leave, today),
      leave: leave
        ? { leaveType: leave.leaveType, startDate: leave.startDate, expectedReturnDate: leave.expectedReturnDate }
        : null,
      ...dateWindow(today),
    };
  }

  async function recordStayEvent(input: RecordStayEventInput): Promise<TenantStay> {
    if (!isStayEventType(input.type)) throw rejection("UNKNOWN_TYPE");
    if (!isStaySource(input.source)) throw invalidRequest("source must be one of QR, APP, OWNER, WHATSAPP");
    const now = input.now ?? new Date();
    const effectiveDate = istDateOf(now);

    let idempotencyKey: string;
    if (input.type === "PRESENCE_CONFIRMED") {
      idempotencyKey = `presence:${input.tenantId}:${effectiveDate}`;
    } else {
      if (typeof input.idempotencyKey !== "string" || !CLIENT_KEY.test(input.idempotencyKey)) {
        throw invalidRequest("idempotencyKey must be 8–100 letters, digits, - or _");
      }
      idempotencyKey = `${input.tenantId}:${input.idempotencyKey}`;
    }

    const residency = await findResidency(input.tenantId, input.hostelId);
    if (!residency) throw ineligible();

    const event: StayEvent = {
      id: randomUUID(),
      tenantId: input.tenantId,
      hostelId: input.hostelId,
      roomId: residency.room_id ?? null,
      type: input.type,
      effectiveDate,
      occurredAt: now.toISOString(),
      // Passed through unvalidated on purpose: the reducer is the validator.
      leaveType: (input.leaveType ?? null) as LeaveType | null,
      expectedReturnDate: typeof input.expectedReturnDate === "string" ? input.expectedReturnDate : null,
      source: input.source,
      actorProfileId: input.actorProfileId,
      actorRole: input.actorRole,
      idempotencyKey,
    };

    const result = applyStayEvent(await activeLeave(input.tenantId), event);
    if (result.kind === "reject") throw rejection(result.reason);

    if (result.kind === "record") {
      const { before, after } = result;
      try {
        await db.$transaction(async (tx: any) => {
          await tx.stay_events.create({ data: eventToRow(event) });
          if (after && !before) {
            await tx.stay_leaves.create({ data: leaveToRow(after) });
          } else if (after && before) {
            const { id: _id, tenant_id: _tenant, hostel_id: _hostel, ...changes } = leaveToRow(after);
            const moved = await tx.stay_leaves.updateMany({
              where: { id: before.id, last_event_id: before.lastEventId },
              data: { ...changes, updated_at: now },
            });
            if (moved.count !== 1) throw new LostRace();
          }
        });
      } catch (error: any) {
        // The same tap arriving twice (idempotency key), or a concurrent write that won
        // the one-active-leave index or moved the leave first. Either way the tenant's
        // intent is already recorded by the other write; this one rolled back whole,
        // so the stream and the projection still agree.
        if (!(error instanceof LostRace) && error?.code !== "P2002") throw error;
      }
    }

    return tenantStay(input.tenantId, effectiveDate);
  }

  async function getMyStay(profileId: string, now: Date = new Date()): Promise<MyStay> {
    const tenancy = await db.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      select: { id: true, hostel_id: true, hostels: { select: { id: true, name: true } } },
    });
    if (!tenancy?.hostel_id || !tenancy.hostels) return { tenantId: null, hostel: null, resident: false, stay: null };
    const hostel = { id: tenancy.hostels.id, name: tenancy.hostels.name };
    const residency = await findResidency(tenancy.id, tenancy.hostel_id);
    if (!residency) return { tenantId: tenancy.id, hostel, resident: false, stay: null };
    return { tenantId: tenancy.id, hostel, resident: true, stay: await tenantStay(tenancy.id, istDateOf(now)) };
  }

  async function getHostelBoard(hostelId: string, now: Date = new Date()): Promise<StayBoardView> {
    const today = istDateOf(now);
    const [allocations, leaves, returnedToday, capacityMap] = await Promise.all([
      db.roomAllocation.findMany({
        where: { hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
        select: {
          tenant_id: true,
          room_id: true,
          room: { select: { room_no: true } },
          tenant: { select: { display_name: true, profiles: { select: { name: true } } } },
        },
      }),
      db.stay_leaves.findMany({ where: { hostel_id: hostelId, status: "ACTIVE" } }),
      db.stay_events.findMany({
        where: { hostel_id: hostelId, type: "RETURNED", effective_date: toDbDate(today) },
        select: { tenant_id: true },
      }),
      capacity.getHostelCapacityMap(hostelId),
    ]);

    // One resident per tenant even if data ever holds two open allocations.
    const residents: BoardResident[] = [];
    const seen = new Set<string>();
    for (const a of allocations as any[]) {
      if (seen.has(a.tenant_id)) continue;
      seen.add(a.tenant_id);
      residents.push({
        tenantId: a.tenant_id,
        roomId: a.room_id,
        roomNo: String(a.room?.room_no ?? "—"),
        name: String(a.tenant?.display_name || a.tenant?.profiles?.name || "Resident"),
      });
    }

    const board = buildStayBoard({
      residents,
      activeLeaves: (leaves as any[]).map(leaveFromRow).map((l) => ({
        tenantId: l.tenantId,
        leaveType: l.leaveType,
        expectedReturnDate: l.expectedReturnDate,
      })),
      returnedTodayTenantIds: (returnedToday as any[]).map((e) => e.tenant_id),
      rooms: Array.from(capacityMap.values()).map((s: any) => ({
        roomId: s.room_id,
        capacity: s.capacity,
        occupied: s.occupied,
        available: s.available,
      })),
      today,
    });
    return { ...board, ...dateWindow(today) };
  }

  /** Portfolio scope: every live hostel of this owner. No hostelId by design, like /api/owner/portfolio/summary. */
  async function getPortfolioSummary(ownerId: string, now: Date = new Date()) {
    const hostels = await db.hostels.findMany({
      where: { owner_id: ownerId, status: "ACTIVE", archived_at: null },
      select: { id: true, name: true },
      orderBy: { created_at: "asc" },
    });
    const summaries = await Promise.all(
      (hostels as Array<{ id: string; name: string }>).map(async (h) =>
        summarizeHostel(h.id, h.name, await getHostelBoard(h.id, now)),
      ),
    );
    return summarizePortfolio(summaries);
  }

  return { recordStayEvent, getMyStay, getHostelBoard, getPortfolioSummary };
}

export type StayService = ReturnType<typeof createStayService>;
export const stayService = createStayService();
