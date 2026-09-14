import type { LeaveState, StayEvent } from "./stay-events";

/** `@db.Date` columns travel as UTC-midnight Dates; the domain uses YYYY-MM-DD. */
export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function fromDbDate(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function eventToRow(e: StayEvent) {
  return {
    id: e.id,
    tenant_id: e.tenantId,
    hostel_id: e.hostelId,
    room_id: e.roomId,
    type: e.type,
    effective_date: toDbDate(e.effectiveDate),
    occurred_at: new Date(e.occurredAt),
    leave_type: e.leaveType,
    expected_return_date: e.expectedReturnDate ? toDbDate(e.expectedReturnDate) : null,
    source: e.source,
    actor_profile_id: e.actorProfileId,
    actor_role: e.actorRole,
    idempotency_key: e.idempotencyKey,
  };
}

export function eventFromRow(r: any): StayEvent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    hostelId: r.hostel_id,
    roomId: r.room_id ?? null,
    type: r.type,
    effectiveDate: fromDbDate(r.effective_date),
    occurredAt: new Date(r.occurred_at).toISOString(),
    leaveType: r.leave_type ?? null,
    expectedReturnDate: r.expected_return_date ? fromDbDate(r.expected_return_date) : null,
    source: r.source,
    actorProfileId: r.actor_profile_id ?? null,
    actorRole: r.actor_role,
    idempotencyKey: r.idempotency_key,
  };
}

export function leaveToRow(l: LeaveState) {
  return {
    id: l.id,
    tenant_id: l.tenantId,
    hostel_id: l.hostelId,
    leave_type: l.leaveType,
    start_date: toDbDate(l.startDate),
    expected_return_date: toDbDate(l.expectedReturnDate),
    status: l.status,
    returned_at: l.returnedAt ? new Date(l.returnedAt) : null,
    last_event_id: l.lastEventId,
  };
}

export function leaveFromRow(r: any): LeaveState {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    hostelId: r.hostel_id,
    leaveType: r.leave_type,
    startDate: fromDbDate(r.start_date),
    expectedReturnDate: fromDbDate(r.expected_return_date),
    status: r.status,
    returnedAt: r.returned_at ? new Date(r.returned_at).toISOString() : null,
    lastEventId: r.last_event_id,
  };
}
