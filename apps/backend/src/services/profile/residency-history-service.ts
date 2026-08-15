import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";

/**
 * Residency history — where someone has stayed, for how long, in what room, at
 * what rent.
 *
 * The history itself needed no new storage: since migration 062 a `tenants` row
 * **is** one tenancy, and `room_allocations` + `move_out_requests` carry the
 * rest. What was missing was a reader and a disclosure rule.
 *
 * ── Why disclosure is careful ──────────────────────────────────────────────
 *
 * [[ADR-053]] deliberately refuses to name another owner's hostel when an
 * invite is blocked, because otherwise "any owner could enumerate a
 * competitor's roster, and a person's address, by typing the right email".
 * That protection is a stalking control, not just a competitive one, and this
 * feature does not remove it.
 *
 * Instead, disclosure is **earned by engagement**: a hostel sees a person's
 * history because that person enquired to them or holds a tenancy there. An
 * owner who merely types an email still gets nothing. Where an owner genuinely
 * needs to look before the person has engaged — the invite flow — they must
 * *ask*, and the tenant approves (`residency_history_disclosures`).
 *
 * ── Facts, not judgements ──────────────────────────────────────────────────
 *
 * `exit_reason`, `exit_notes` and `tenant_behavior_scores` are deliberately
 * **never** projected. They are one owner's unreviewed opinion; letting them
 * travel between owners means a single bad exit follows someone across every
 * hostel on Stayo with no right of reply. Everything disclosed here is a
 * checkable fact the tenant already knows about themselves.
 */

export type DisclosureStatus = "REQUESTED" | "APPROVED" | "DECLINED" | "REVOKED";

/** Enquiry statuses that still count as the tenant engaging that hostel. */
const OPEN_LEAD_STATUSES = ["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN", "INVITED"];

const TENANCY_SELECT = {
  id: true,
  status: true,
  joined_on: true,
  exit_date: true,
  monthly_rent: true,
  activation_completed_at: true,
  created_at: true,
  hostels: { select: { id: true, name: true, city: true } },
  room_allocations: {
    orderBy: { start_date: "desc" as const },
    take: 1,
    select: {
      start_date: true,
      end_date: true,
      room: { select: { room_no: true, capacity: true, room_type: true } },
    },
  },
  move_out_requests: {
    where: { status: "COMPLETED" },
    select: { id: true },
    take: 1,
  },
} as const;

function monthsBetween(from: Date | null, to: Date | null): number | null {
  if (!from) return null;
  const end = to ?? new Date();
  const months = (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth());
  // A stay that started and ended inside one calendar month is one month of
  // living somewhere, not zero.
  return Math.max(1, months);
}

/**
 * One stay, reduced to checkable facts.
 *
 * Note what is absent: exit_reason, exit_notes, behaviour score, and any
 * owner-authored note. See the file header.
 */
function toStay(tenancy: any) {
  const allocation = tenancy.room_allocations?.[0] ?? null;
  const isLive = tenancy.status === "ACTIVE" || tenancy.status === "INVITED";

  return {
    id: tenancy.id,
    hostel: {
      id: tenancy.hostels?.id ?? null,
      name: tenancy.hostels?.name ?? null,
      city: tenancy.hostels?.city ?? null,
    },
    joined_on: tenancy.joined_on,
    exit_date: tenancy.exit_date,
    is_current: isLive,
    duration_months: monthsBetween(tenancy.joined_on, tenancy.exit_date),
    room_no: allocation?.room?.room_no ?? null,
    /** Capacity reads as sharing type: 4 → "4-bed". */
    sharing: allocation?.room?.capacity ?? null,
    room_type: allocation?.room?.room_type ?? null,
    monthly_rent: tenancy.monthly_rent != null ? Number(tenancy.monthly_rent) : null,
    /** Whether the stay was closed out properly — the fact an owner most wants. */
    settled: (tenancy.move_out_requests?.length ?? 0) > 0,
    /**
     * An invitation that expired or was cancelled before the person ever moved
     * in is not a stay. Kept in the payload rather than filtered silently, so
     * a reader can tell "never arrived" from "left".
     */
    ever_moved_in: Boolean(tenancy.activation_completed_at),
  };
}

export class ResidencyHistoryService {
  /** The person's own history. Always fully visible to them — it is theirs. */
  async getOwnHistory(profileId: string) {
    const tenancies = await prisma.tenants.findMany({
      where: { profile_id: profileId },
      orderBy: { created_at: "desc" },
      select: TENANCY_SELECT,
    });

    const stays = tenancies.map(toStay).filter((stay: any) => stay.ever_moved_in || stay.is_current);

    return {
      stays,
      total_stays: stays.filter((stay: any) => !stay.is_current).length,
      total_months: stays.reduce((sum: number, stay: any) => sum + (stay.duration_months ?? 0), 0),
    };
  }

  /**
   * **The single access decision.** Every disclosure of one person's history to
   * one hostel goes through here.
   *
   * Precedence, and the order matters:
   *   1. an explicit REVOKED/DECLINED row — the tenant's "no" beats engagement
   *   2. an explicit APPROVED row
   *   3. engagement: an open enquiry to this hostel, or a tenancy at it
   *   4. otherwise: no
   */
  async resolveAccess(profileId: string, hostelId: string) {
    const disclosure = await prisma.residency_history_disclosures.findUnique({
      where: { profile_id_hostel_id: { profile_id: profileId, hostel_id: hostelId } },
      select: { status: true },
    });

    if (disclosure?.status === "REVOKED" || disclosure?.status === "DECLINED") {
      return { allowed: false as const, reason: "TENANT_DECLINED" as const };
    }
    if (disclosure?.status === "APPROVED") {
      return { allowed: true as const, reason: "TENANT_APPROVED" as const };
    }

    const [tenancy, lead] = await Promise.all([
      prisma.tenants.findFirst({
        where: { profile_id: profileId, hostel_id: hostelId },
        select: { id: true },
      }),
      prisma.visitorLead.findFirst({
        where: {
          seeker_profile_id: profileId,
          hostel_id: hostelId,
          status: { in: OPEN_LEAD_STATUSES },
        },
        select: { id: true },
      }),
    ]);

    if (tenancy) return { allowed: true as const, reason: "TENANCY" as const };
    if (lead) return { allowed: true as const, reason: "OPEN_ENQUIRY" as const };

    return {
      allowed: false as const,
      // Distinguished from a refusal so the owner UI can offer "ask them"
      // rather than implying the person has something to hide.
      reason: (disclosure?.status === "REQUESTED" ? "AWAITING_TENANT" : "NOT_ENGAGED") as
        | "AWAITING_TENANT"
        | "NOT_ENGAGED",
    };
  }

  /**
   * Resolve a tenancy the caller owns into the person behind it.
   *
   * Owner surfaces hold a `tenant_id`, not a `profile_id`, and plumbing a
   * profile id through the UI would put a person-identifier in owner-facing
   * state for no gain. Resolving server-side keeps it out, and the ownership
   * check means an owner can only ever name their own tenancy here.
   */
  async resolveProfileFromTenancy(ownerId: string, tenantId: string) {
    const tenancy = await prisma.tenants.findFirst({
      where: { id: tenantId, hostels: { owner_id: ownerId } },
      select: { profile_id: true, hostel_id: true },
    });
    if (!tenancy) throw ApiError.forbidden("You do not manage this tenant");
    if (!tenancy.profile_id) {
      // An invitation that was never activated has no person attached yet.
      throw ApiError.notFound("This tenant has not activated their account yet");
    }
    return { profileId: tenancy.profile_id, hostelId: tenancy.hostel_id };
  }

  /**
   * A person's history as one hostel may see it.
   *
   * Ownership of the hostel is verified here rather than trusted from the
   * caller — this is the boundary that keeps ADR-053's protection intact.
   */
  async getDisclosedHistory(ownerId: string, hostelId: string, profileId: string) {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: ownerId },
      select: { id: true },
    });
    if (!hostel) throw ApiError.forbidden("You do not manage this hostel");

    const access = await this.resolveAccess(profileId, hostelId);
    if (!access.allowed) {
      // Deliberately not a 403 with detail: an owner who has not earned access
      // learns only that they have not earned it, never whether the person has
      // a history at all.
      return { allowed: false, reason: access.reason, stays: [], total_stays: 0, total_months: 0 };
    }

    const history = await this.getOwnHistory(profileId);
    return { allowed: true, reason: access.reason, ...history };
  }

  // ── Tenant-side control ────────────────────────────────────────────────────

  /** Who can see this person's history right now, and why. */
  async listDisclosures(profileId: string) {
    const [explicit, tenancies, leads] = await Promise.all([
      prisma.residency_history_disclosures.findMany({
        where: { profile_id: profileId },
        select: {
          status: true,
          requested_at: true,
          decided_at: true,
          hostel: { select: { id: true, name: true } },
        },
      }),
      prisma.tenants.findMany({
        where: { profile_id: profileId },
        select: { hostels: { select: { id: true, name: true } } },
      }),
      prisma.visitorLead.findMany({
        where: { seeker_profile_id: profileId, status: { in: OPEN_LEAD_STATUSES } },
        select: { hostel: { select: { id: true, name: true } } },
      }),
    ]);

    const byHostel = new Map<string, any>();

    // Engagement first, so an explicit row can override it below.
    for (const tenancy of tenancies as any[]) {
      if (!tenancy.hostels) continue;
      byHostel.set(tenancy.hostels.id, {
        hostel_id: tenancy.hostels.id,
        hostel_name: tenancy.hostels.name,
        can_see: true,
        source: "TENANCY",
      });
    }
    for (const lead of leads as any[]) {
      if (!lead.hostel || byHostel.has(lead.hostel.id)) continue;
      byHostel.set(lead.hostel.id, {
        hostel_id: lead.hostel.id,
        hostel_name: lead.hostel.name,
        can_see: true,
        source: "OPEN_ENQUIRY",
      });
    }
    for (const row of explicit as any[]) {
      byHostel.set(row.hostel.id, {
        hostel_id: row.hostel.id,
        hostel_name: row.hostel.name,
        can_see: row.status === "APPROVED",
        source: row.status,
        requested_at: row.requested_at,
        decided_at: row.decided_at,
      });
    }

    const all = Array.from(byHostel.values());
    return {
      shared_with: all.filter((entry) => entry.can_see),
      pending_requests: all.filter((entry) => entry.source === "REQUESTED"),
      blocked: all.filter((entry) => !entry.can_see && entry.source !== "REQUESTED"),
    };
  }

  /** The tenant's answer to a request, or an unprompted grant/withdrawal. */
  async setDisclosure(profileId: string, hostelId: string, status: "APPROVED" | "DECLINED" | "REVOKED") {
    const hostel = await prisma.hostels.findUnique({ where: { id: hostelId }, select: { id: true } });
    if (!hostel) throw ApiError.notFound("Hostel not found");

    const now = new Date();
    await prisma.residency_history_disclosures.upsert({
      where: { profile_id_hostel_id: { profile_id: profileId, hostel_id: hostelId } },
      create: { profile_id: profileId, hostel_id: hostelId, status, decided_at: now },
      update: { status, decided_at: now, updated_at: now },
    });

    return this.listDisclosures(profileId);
  }

  /**
   * An owner asking to see the history of someone who has not engaged them —
   * the invite flow. Creates a request the tenant answers; it grants nothing
   * by itself.
   */
  async requestAccess(ownerId: string, hostelId: string, profileId: string) {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: ownerId },
      select: { id: true },
    });
    if (!hostel) throw ApiError.forbidden("You do not manage this hostel");

    const existing = await prisma.residency_history_disclosures.findUnique({
      where: { profile_id_hostel_id: { profile_id: profileId, hostel_id: hostelId } },
      select: { status: true },
    });

    // A declined or revoked answer stands until the tenant changes it. Letting
    // an owner re-request would turn "no" into a nag, and a repeated request is
    // itself a signal the tenant did not consent to receiving.
    if (existing?.status === "DECLINED" || existing?.status === "REVOKED") {
      return { requested: false as const, status: existing.status };
    }
    if (existing?.status === "APPROVED") {
      return { requested: false as const, status: "APPROVED" as const };
    }

    const now = new Date();
    await prisma.residency_history_disclosures.upsert({
      where: { profile_id_hostel_id: { profile_id: profileId, hostel_id: hostelId } },
      create: {
        profile_id: profileId,
        hostel_id: hostelId,
        status: "REQUESTED",
        requested_by: ownerId,
        requested_at: now,
      },
      update: { status: "REQUESTED", requested_by: ownerId, requested_at: now, updated_at: now },
    });

    return { requested: true as const, status: "REQUESTED" as const };
  }
}

export const residencyHistoryService = new ResidencyHistoryService();
