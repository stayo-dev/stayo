import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { redisKeys } from "@/lib/redis/keys";
import { getOrSetJson, invalidateTag } from "@/lib/redis/cache";
import { invitationService } from "@/src/services/tenants/invitation-service";
import { canTransitionLeadStatus } from "@/src/services/admissions/lead-transition-guards";
import { whatsAppTemplateDeliveryService } from "@/lib/services/notifications/whatsapp-template-delivery";
import {
  buildTenantEnquiryRejected,
  rejectionReasonText,
  resolveEnquiryTemplateName,
} from "@/lib/services/notifications/providers/whatsapp/enquiry-template-contracts";
import { getLogger } from "@/lib/logger";

const logger = getLogger("admissions.lead-actions");

export const LEAD_STATUSES = [
  "NEW",
  "INTERESTED",
  "ROOM_VISITED",
  "DECISION_PENDING",
  "READY_TO_JOIN",
  "ACCEPTED",
  "ON_HOLD",
  "REJECTED",
  "INVITED",
  "JOINED",
  "LOST",
] as const;

/** The owner Leads tab's three primary actions on a lead. */
export const LEAD_ACTION_STATUSES = ["ACCEPTED", "ON_HOLD", "REJECTED"] as const;

export const LOST_REASONS = [
  "PRICE_HIGH",
  "LOCATION_UNSUITABLE",
  "FOOD_QUALITY",
  "PARENT_REJECTED",
  "JOINED_COMPETITOR",
  "NO_RESPONSE",
  "OTHER",
] as const;

export const ACTIVITY_SCORES: Record<string, number> = {
  VIEW_HOSTEL: 0,
  VIEW_ROOM: 5,
  VIEW_PRICING: 10,
  VIEW_RULES: 5,
  VIEW_FACILITIES: 0,
  VIEW_FOOD: 0,
  MARK_INTEREST: 20,
  SHARE_LINK: 0,
  REQUEST_JOIN: 30,
  RESERVE_ROOM: 50,
  VISIT_COMPLETED: 25,
  PARENT_CALL_LOGGED: 15,
  SCHEDULE_VISIT: 10,
};

/**
 * Exported so Stayo Discover's enquiry de-duplication uses the same definition
 * of "this lead is still open" as the microsite does. Two definitions would
 * mean an enquiry looked closed to one surface and open to the other.
 */
export const ACTIVE_LEAD_STATUSES = [
  "NEW",
  "INTERESTED",
  "ROOM_VISITED",
  "DECISION_PENDING",
  "READY_TO_JOIN",
  "ACCEPTED",
  "ON_HOLD",
  "INVITED",
];
const RESERVATION_COOLDOWN_HOURS = 12;

function cleanString(value: unknown, max = 200) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function leadTemperature(score: number) {
  if (score >= 70) return "Hot";
  if (score >= 30) return "Warm";
  return "Cold";
}

function readinessForHostel(hostel: any, rooms: any[]) {
  const hostelPhotoCount = asArray(hostel.admission_photos).length + (hostel.logo_url ? 1 : 0);
  const roomCategories = new Map<string, number>();
  for (const room of rooms) {
    const category = room.room_type || "Standard";
    roomCategories.set(category, Math.max(roomCategories.get(category) || 0, asArray(room.admission_photos).length));
  }

  const checks = {
    hostel_information: Boolean(hostel.name && hostel.phone && hostel.address),
    pricing: rooms.some((room) => Number(room.base_rent || 0) > 0),
    facilities: Boolean(hostel.preferences_config),
    hostel_photos: hostelPhotoCount >= 5,
    room_photos: roomCategories.size > 0 && Array.from(roomCategories.values()).every((count) => count >= 2),
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    missing: Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
  };
}

function publicRoom(room: any) {
  const activeAllocations = room.room_allocations || [];
  const activeReservations = room.room_reservations || [];
  const activeInvitationReservations = room.tenant_invitation_reservations || [];
  const occupied = activeAllocations.length;
  const reserved = activeReservations.length + activeInvitationReservations.length;
  const availableBeds = Math.max(0, Number(room.capacity || 0) - occupied - reserved);
  return {
    id: room.id,
    room_no: room.room_no,
    floor: room.floor,
    floor_name: room.floor_ref?.name || null,
    room_type: room.room_type || "Standard",
    capacity: room.capacity,
    occupied_count: occupied,
    reserved_count: reserved,
    available_beds: availableBeds,
    pricing: {
      monthly_rent: Number(room.base_rent || 0),
      deposit: null,
      maintenance: null,
    },
    notes: room.notes || null,
    /**
     * What the room is like to live in (migration 073). Passed through raw —
     * the listing turns it into per-bed area and storage lines via
     * `room-space.ts`, so one place decides how it reads.
     */
    space: {
      length_ft: room.length_ft == null ? null : Number(room.length_ft),
      width_ft: room.width_ft == null ? null : Number(room.width_ft),
      cupboard_per_bed: room.cupboard_per_bed ?? null,
      under_bed_storage: room.under_bed_storage ?? null,
      study_desk: room.study_desk ?? null,
      windows: room.windows ?? null,
    },
    photos: asArray(room.admission_photos),
    roommate_preview: activeAllocations
      .map((allocation: any) => allocation.tenant)
      .filter(Boolean)
      .map((tenant: any) => ({
        college: tenant.college_name || null,
        course: tenant.course || null,
        year: tenant.year_of_study || null,
      }))
      .filter((item: any) => item.college || item.course || item.year),
  };
}

async function ensureHostelSlug(hostel: any) {
  if (hostel.public_slug) return hostel.public_slug;
  const slug = `${slugify(hostel.name || "hostel")}-${String(hostel.id).slice(0, 8)}`;
  await prisma.hostels.update({ where: { id: hostel.id }, data: { public_slug: slug } });
  return slug;
}

export class AdmissionsService {
  async getPublicHostel(slug: string) {
    const cacheKey = redisKeys.admissions.publicHostel(slug);
    return getOrSetJson(cacheKey, 180, async () => {
      const hostel = await prisma.hostels.findFirst({
        where: { public_slug: slug, status: "ACTIVE" },
        include: {
          rooms: {
            where: { is_active: true },
            include: {
              floor_ref: { select: { name: true } },
              room_reservations: { where: { status: "ACTIVE", reserved_until: { gt: new Date() } }, select: { id: true } },
              tenant_invitation_reservations: { where: { status: "ACTIVE", expires_at: { gt: new Date() } }, select: { id: true } },
              room_allocations: {
                where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" } },
                include: {
                  tenant: {
                    select: {
                      college_name: true,
                      course: true,
                      year_of_study: true,
                    },
                  },
                },
              },
            },
            orderBy: [{ floor: "asc" }, { room_no: "asc" }],
          },
        },
      });
      if (!hostel || !hostel.admissions_enabled) throw ApiError.notFound("This admissions link is not active");

      const rooms = hostel.rooms || [];
      const safeRooms = rooms.map(publicRoom);
      const currentStartingPrice = safeRooms
        .map((room: any) => room.pricing.monthly_rent)
        .filter((value: number) => value > 0)
        .sort((a: number, b: number) => a - b)[0] || null;
      const currentVacancyCount = safeRooms.reduce((sum: number, room: any) => sum + Number(room.available_beds || 0), 0);

      const siblingHostels = await prisma.hostels.findMany({
        where: { owner_id: hostel.owner_id, status: "ACTIVE", admissions_enabled: true, id: { not: hostel.id } },
        include: {
          rooms: {
            where: { is_active: true },
            include: {
              room_allocations: { where: { is_active: true, end_date: null }, select: { id: true } },
              room_reservations: { where: { status: "ACTIVE", reserved_until: { gt: new Date() } }, select: { id: true } },
              tenant_invitation_reservations: { where: { status: "ACTIVE", expires_at: { gt: new Date() } }, select: { id: true } },
            },
          },
        },
      });

      const otherHostels = await Promise.all(siblingHostels.map(async (h: any) => {
        const public_slug = await ensureHostelSlug(h);
        const vacancyCount = h.rooms.reduce((sum: number, room: any) => {
          const occupied = room.room_allocations?.length || 0;
          const reserved = (room.room_reservations?.length || 0) + (room.tenant_invitation_reservations?.length || 0);
          return sum + Math.max(0, Number(room.capacity || 0) - occupied - reserved);
        }, 0);
        const startingPrice = h.rooms
          .map((room: any) => Number(room.base_rent || 0))
          .filter((value: number) => value > 0)
          .sort((a: number, b: number) => a - b)[0] || null;
        return {
          id: h.id,
          public_slug,
          name: h.name,
          vacancy_count: vacancyCount,
          starting_price: startingPrice,
          distance: null,
        };
      }));
      const ownerHostels = [
        {
          id: hostel.id,
          public_slug: hostel.public_slug,
          name: hostel.name,
          vacancy_count: currentVacancyCount,
          starting_price: currentStartingPrice,
          distance: null,
          is_current: true,
        },
        ...otherHostels.map((h: any) => ({ ...h, is_current: false })),
      ];

      return {
        hostel: {
          id: hostel.id,
          public_slug: hostel.public_slug,
          name: hostel.name,
          phone: hostel.phone,
          address: hostel.address,
          city: hostel.city,
          state: hostel.state,
          logo_url: hostel.logo_url,
          photos: asArray(hostel.admission_photos),
          starting_price: currentStartingPrice,
          readiness: readinessForHostel(hostel, rooms),
        },
        trust_sections: {
          safety: ["Owner-managed records", "Visitor-friendly admission flow", "Private student data protected"],
          food: ["Food details available from owner", "Ask about menu during visit"],
          rules: ["Hostel rules are shared before activation", "Parent questions can be recorded"],
          curfew: "Contact the hostel for current curfew timing",
          warden_contact: hostel.phone,
          nearby_colleges: [],
        },
        rooms: safeRooms,
        owner_hostels: ownerHostels,
        other_hostels: otherHostels,
      };
    }, [redisKeys.admissions.publicHostelTag(slug)]);
  }

  async createLead(slug: string, input: any, ip: string) {
    const trap = cleanString(input.website, 50);
    if (trap) throw ApiError.badRequest("Invalid submission");

    const studentPhone = input.student_phone ? normalizeIndianPhone(input.student_phone) : null;
    if (input.student_phone && !studentPhone) throw ApiError.validationError("Student phone is invalid");
    const parentPhone = normalizeIndianPhone(input.parent_phone) || null;

    const limit = await checkFixedWindowLimit({
      scope: "visit-submit",
      identifier: studentPhone ? `${slug}:${studentPhone}:${ip}` : `${slug}:ip:${ip}`,
      maxAttempts: 6,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) throw new ApiError("Please wait before submitting again", 429, "TOO_MANY_REQUESTS", { retry_after_seconds: limit.retryAfterSeconds });

    const hostel = await prisma.hostels.findFirst({ where: { public_slug: slug, status: "ACTIVE" } });
    if (!hostel || !hostel.admissions_enabled) throw ApiError.notFound("This admissions link is not active");

    const studentName = cleanString(input.student_name, 120);
    if (!studentName) throw ApiError.validationError("Student name is required");
    const studentEmail = cleanString(input.student_email, 180)?.toLowerCase() || null;
    const decisionMaker = ["STUDENT", "PARENT", "BOTH"].includes(input.decision_maker_type)
      ? input.decision_maker_type
      : parentPhone ? "BOTH" : "STUDENT";

    const existing = studentPhone
      ? await prisma.visitorLead.findFirst({
          where: {
            hostel_id: hostel.id,
            student_phone: studentPhone,
            status: { in: ACTIVE_LEAD_STATUSES },
          },
          orderBy: { created_at: "desc" },
        })
      : null;

    const lead = existing
      ? await prisma.visitorLead.update({
          where: { id: existing.id },
          data: {
            student_name: studentName,
            student_email: studentEmail || existing.student_email,
            parent_name: cleanString(input.parent_name, 120) || existing.parent_name,
            parent_phone: parentPhone || existing.parent_phone,
            decision_maker_type: decisionMaker,
            notes: cleanString(input.notes, 1000) || existing.notes,
            last_activity_at: new Date(),
            updated_at: new Date(),
          },
        })
      : await prisma.visitorLead.create({
          data: {
            hostel_id: hostel.id,
            owner_id: hostel.owner_id,
            student_name: studentName,
            student_phone: studentPhone,
            student_email: studentEmail,
            parent_name: cleanString(input.parent_name, 120),
            parent_phone: parentPhone,
            decision_maker_type: decisionMaker,
            source: cleanString(input.source, 20) || "QR",
            notes: cleanString(input.notes, 1000),
          },
        });

    await this.recordActivity(lead.id, "VIEW_HOSTEL", { source: "lead_capture" });
    await invalidateTag(redisKeys.admissions.owner(hostel.owner_id));
    return this.getLeadForOwner(lead.id, hostel.owner_id);
  }

  async createDirectLead(ownerId: string, input: any) {
    const studentPhone = input.student_phone ? normalizeIndianPhone(input.student_phone) : null;
    if (input.student_phone && !studentPhone) throw ApiError.validationError("Student phone is invalid");
    const parentPhone = normalizeIndianPhone(input.parent_phone) || null;

    const studentName = cleanString(input.student_name, 120);
    if (!studentName) throw ApiError.validationError("Student name is required");
    const studentEmail = cleanString(input.student_email, 180)?.toLowerCase() || null;
    
    const hostelId = input.hostel_id;
    if (!hostelId) throw ApiError.validationError("Hostel ID is required");

    // Verify hostel belongs to the owner
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: ownerId, status: "ACTIVE" }
    });
    if (!hostel) throw ApiError.notFound("Hostel not found or access denied");

    const decisionMaker = ["STUDENT", "PARENT", "BOTH"].includes(input.decision_maker_type)
      ? input.decision_maker_type
      : parentPhone ? "BOTH" : "STUDENT";

    const existing = studentPhone
      ? await prisma.visitorLead.findFirst({
          where: {
            hostel_id: hostel.id,
            student_phone: studentPhone,
            status: { in: ACTIVE_LEAD_STATUSES },
          },
          orderBy: { created_at: "desc" },
        })
      : null;

    const lead = existing
      ? await prisma.visitorLead.update({
          where: { id: existing.id },
          data: {
            student_name: studentName,
            student_email: studentEmail || existing.student_email,
            parent_name: cleanString(input.parent_name, 120) || existing.parent_name,
            parent_phone: parentPhone || existing.parent_phone,
            decision_maker_type: decisionMaker,
            notes: cleanString(input.notes, 1000) || existing.notes,
            last_activity_at: new Date(),
            updated_at: new Date(),
            status: input.status || existing.status,
            source: cleanString(input.source, 50) || existing.source || "WALK_IN",
          },
        })
      : await prisma.visitorLead.create({
          data: {
            hostel_id: hostel.id,
            owner_id: ownerId,
            student_name: studentName,
            student_phone: studentPhone,
            student_email: studentEmail,
            parent_name: cleanString(input.parent_name, 120),
            parent_phone: parentPhone,
            decision_maker_type: decisionMaker,
            source: cleanString(input.source, 50) || "WALK_IN",
            status: input.status || "NEW",
            notes: cleanString(input.notes, 1000),
          },
        });

    await this.recordActivity(lead.id, "WALK_IN_LEAD_CREATED", { source: "owner_creation" });
    await invalidateTag(redisKeys.admissions.owner(ownerId));
    return this.getLeadForOwner(lead.id, ownerId);
  }

  async recordActivity(leadId: string, activityType: string, metadata: Record<string, unknown> = {}, hostelSlug?: string) {
    const score = ACTIVITY_SCORES[activityType] ?? 0;
    const lead = await prisma.visitorLead.findUnique({
      where: { id: leadId },
      include: hostelSlug ? { hostel: { select: { public_slug: true } } } : undefined,
    });
    if (!lead) throw ApiError.notFound("Lead not found");
    if (hostelSlug && (lead as any).hostel?.public_slug !== hostelSlug) {
      throw ApiError.forbidden("Lead does not belong to this admissions link");
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.leadActivity.create({
        data: {
          lead_id: leadId,
          activity_type: activityType,
          metadata,
        },
      });
      await tx.visitorLead.update({
        where: { id: leadId },
        data: {
          lead_score: { increment: score },
          status: this.nextStatusForActivity(lead.status, activityType),
          last_activity_at: new Date(),
          updated_at: new Date(),
        },
      });
    });
    await invalidateTag(redisKeys.admissions.owner(lead.owner_id));
    return { ok: true, score_delta: score };
  }

  nextStatusForActivity(status: string, activityType: string) {
    if (["INVITED", "JOINED", "LOST"].includes(status)) return status;
    if (activityType === "REQUEST_JOIN") return "READY_TO_JOIN";
    if (activityType === "RESERVE_ROOM") return "READY_TO_JOIN";
    if (activityType === "VISIT_COMPLETED") {
      if (["NEW", "INTERESTED"].includes(status)) return "ROOM_VISITED";
      return status;
    }
    if (activityType === "PARENT_CALL_LOGGED") {
      if (["NEW", "INTERESTED", "ROOM_VISITED"].includes(status)) return "DECISION_PENDING";
      return status;
    }
    if (activityType === "SCHEDULE_VISIT") {
      if (status === "NEW") return "INTERESTED";
      return status;
    }
    if (activityType === "MARK_INTEREST") return "INTERESTED";
    return status;
  }

  async listLeads(ownerId: string, query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(50, Math.max(5, Number(query.limit || 20)));
    const skip = (page - 1) * limit;
    const where: any = { owner_id: ownerId };
    if (query.hostelId) where.hostel_id = String(query.hostelId);
    if (query.status) where.status = String(query.status);
    if (query.search) {
      const search = String(query.search);
      where.OR = [
        { student_name: { contains: search, mode: "insensitive" } },
        { student_phone: { contains: search } },
        { parent_phone: { contains: search } },
        { student_email: { contains: search, mode: "insensitive" } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.visitorLead.findMany({
        where,
        include: {
          hostel: { select: { id: true, name: true } },
          reservations: { where: { status: "ACTIVE" }, include: { room: { select: { id: true, room_no: true } } } },
          _count: { select: { activities: true, lead_notes: true } },
        },
        orderBy: [{ lead_score: "desc" }, { last_activity_at: "desc" }],
        skip,
        take: limit,
      }),
      prisma.visitorLead.count({ where }),
    ]);

    return {
      items: items.map((lead: any) => this.shapeLead(lead)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getLeadForOwner(leadId: string, ownerId: string) {
    const lead = await prisma.visitorLead.findFirst({
      where: { id: leadId, owner_id: ownerId },
      include: {
        hostel: { select: { id: true, name: true } },
        activities: { orderBy: { created_at: "desc" }, take: 80 },
        lead_notes: { orderBy: { created_at: "desc" }, take: 50 },
        reservations: { include: { room: { select: { id: true, room_no: true, room_type: true } } }, orderBy: { created_at: "desc" } },
      },
    });
    if (!lead) throw ApiError.notFound("Lead not found");
    return this.shapeLead(lead);
  }

  shapeLead(lead: any) {
    const shaped = {
      ...lead,
      notes_list: lead.lead_notes || lead.notes_list || [],
      lead_temperature: leadTemperature(Number(lead.lead_score || 0)),
    };
    if (shaped._count) {
      shaped._count = {
        ...shaped._count,
        notes_list: shaped._count.lead_notes ?? shaped._count.notes_list,
      };
    }
    return shaped;
  }

  async updateStatus(leadId: string, ownerId: string, input: any) {
    if (input.status) {
      if (!LEAD_STATUSES.includes(input.status)) throw ApiError.validationError("Invalid lead status");
      if (input.status === "LOST" && (!input.lost_reason || !LOST_REASONS.includes(input.lost_reason))) {
        throw ApiError.validationError("Invalid or missing lost reason");
      }
    }
    const lead = await prisma.visitorLead.findFirst({ where: { id: leadId, owner_id: ownerId } });
    if (!lead) throw ApiError.notFound("Lead not found");

    // The owner Leads tab's Accept / Hold / Reject actions: a dedicated
    // transition guard (separate from the pre-existing funnel logic below,
    // which these three statuses never trigger) plus, for Hold, a required
    // reason message stored the same way any other lead note is.
    let holdNote: string | null = null;
    const isLeadAction = input.status && (LEAD_ACTION_STATUSES as readonly string[]).includes(input.status);
    if (isLeadAction) {
      const guard = canTransitionLeadStatus(lead.status, input.status);
      if (!guard.ok) throw ApiError.conflict(guard.reason);
      if (input.status === "ON_HOLD") {
        holdNote = cleanString(input.note, 1200);
        if (!holdNote) throw ApiError.validationError("A message is required to put this enquiry on hold");
      }
    }

    // Auto-create activity if status is explicitly changed
    if (input.status && input.status !== lead.status) {
      if (input.status === "ROOM_VISITED") {
        await prisma.leadActivity.create({
          data: {
            lead_id: leadId,
            activity_type: "VISIT_COMPLETED",
            metadata: { source: "status_update" },
          }
        });
      } else if (input.status === "DECISION_PENDING") {
        await prisma.leadActivity.create({
          data: {
            lead_id: leadId,
            activity_type: "PARENT_CALL_LOGGED",
            metadata: { source: "status_update" },
          }
        });
      } else if (isLeadAction) {
        await prisma.leadActivity.create({
          data: {
            lead_id: leadId,
            activity_type: `LEAD_${input.status}`,
            metadata: input.status === "ON_HOLD" ? { note: holdNote } : {},
          }
        });
      }
    }

    // Also support explicit logging of activities via input.activity_type
    if (input.activity_type) {
      await prisma.leadActivity.create({
        data: {
          lead_id: leadId,
          activity_type: input.activity_type,
          metadata: input.activity_metadata || {},
        }
      });
      // Optionally progress status if nextStatusForActivity recommends it
      const currentStatus = input.status || lead.status;
      const progressedStatus = this.nextStatusForActivity(currentStatus, input.activity_type);
      input.status = progressedStatus;
    }

    const updated = await prisma.visitorLead.update({
      where: { id: leadId },
      data: {
        status: input.status !== undefined ? input.status : lead.status,
        lost_reason: input.status === "LOST" ? input.lost_reason : null,
        lost_note: input.status === "LOST" ? cleanString(input.lost_note, 500) : null,
        parent_contacted_at: input.parent_contacted ? new Date() : lead.parent_contacted_at,
        parent_follow_up_required: input.parent_follow_up_required !== undefined ? Boolean(input.parent_follow_up_required) : lead.parent_follow_up_required,
        next_action_at: input.next_action_at !== undefined ? (input.next_action_at ? new Date(input.next_action_at) : null) : lead.next_action_at,
        assigned_to: input.assigned_to !== undefined ? cleanString(input.assigned_to, 100) || "Reception Desk" : lead.assigned_to,
        last_activity_at: (input.activity_type || (input.status && input.status !== lead.status)) ? new Date() : lead.last_activity_at,
        updated_at: new Date(),
      },
      include: { hostel: { select: { name: true } } },
    });

    if (holdNote) {
      await prisma.leadNote.create({ data: { lead_id: leadId, owner_id: ownerId, note: holdNote } });
    }

    /**
     * Tell the applicant their enquiry was turned down.
     *
     * `TENANT_ENQUIRY_REJECTED` has existed as an approved template since the
     * enquiry work shipped and **was never sent by anything** — a Discovery
     * applicant simply heard nothing back, forever. There is deliberately no
     * matching "accepted" message: an approved enquiry is followed by an
     * invitation, and the invitation *is* the acceptance.
     *
     * Only for enquiries that came through Discovery (`seeker_profile_id`):
     * those people have a Stayo account and used the platform to ask. A
     * walk-in lead marked lost never opted into being messaged.
     *
     * Never fatal — the status change is already committed, and losing it
     * because a message failed would be the wrong trade.
     */
    if (input.status === "LOST" && lead.status !== "LOST" && lead.seeker_profile_id) {
      void (async () => {
        const [seeker, hostel] = await Promise.all([
          prisma.profile.findUnique({
            where: { id: lead.seeker_profile_id as string },
            select: { name: true, phone: true },
          }),
          prisma.hostels.findUnique({ where: { id: lead.hostel_id }, select: { name: true } }),
        ]);
        if (!seeker?.phone) return;

        const template = resolveEnquiryTemplateName("TENANT_ENQUIRY_REJECTED");
        await whatsAppTemplateDeliveryService.send({
          phone: seeker.phone,
          templateName: template.name,
          languageCode: template.language,
          ...buildTenantEnquiryRejected({
            tenantName: seeker.name,
            hostelName: hostel?.name ?? null,
            reason: rejectionReasonText(input.lost_reason),
          }),
          // Keyed on the lead: re-opening and re-losing one conversation must
          // not message the same person twice.
          idempotencyKey: `enquiry-rejected:${leadId}`,
          ownerId,
          hostelId: lead.hostel_id,
        });
      })().catch(() => undefined);
    }

    await invalidateTag(redisKeys.admissions.owner(ownerId));

    // Tenant-facing notice. Never fatal — the status change is already
    // committed, and losing it because WhatsApp failed (or the template
    // isn't approved yet in Meta) would be the wrong trade. Reject only:
    // Hold deliberately does not notify — it just saves the owner's note
    // and changes status, per explicit product decision.
    if (input.status === "REJECTED" && lead.status !== "REJECTED") {
      await this.notifyEnquiryRejected(updated);
    }

    return this.shapeLead(updated);
  }

  /** Fire-and-forget-safe: catches internally, never throws into updateStatus's critical path. */
  private async notifyEnquiryRejected(lead: any) {
    if (!lead.student_phone) return;
    try {
      const template = resolveEnquiryTemplateName("TENANT_ENQUIRY_REJECTED");
      await whatsAppTemplateDeliveryService.send({
        phone: lead.student_phone,
        templateName: template.name,
        languageCode: template.language,
        ...buildTenantEnquiryRejected({
          tenantName: lead.student_name,
          hostelName: lead.hostel?.name,
        }),
        idempotencyKey: `lead-rejected:${lead.id}`,
        ownerId: lead.owner_id,
        hostelId: lead.hostel_id,
      });
    } catch (error: any) {
      logger.warn("admissions.lead_rejected.notify_failed", { lead_id: lead.id, error: String(error?.message || error) });
    }
  }

  async addNote(leadId: string, ownerId: string, note: string) {
    const lead = await prisma.visitorLead.findFirst({ where: { id: leadId, owner_id: ownerId } });
    if (!lead) throw ApiError.notFound("Lead not found");
    const cleanNote = cleanString(note, 1200);
    if (!cleanNote) throw ApiError.validationError("Note is required");
    const created = await prisma.leadNote.create({ data: { lead_id: leadId, owner_id: ownerId, note: cleanNote } });
    
    // Auto-progress to DECISION_PENDING if status is NEW, INTERESTED, or ROOM_VISITED
    let newStatus = lead.status;
    if (["NEW", "INTERESTED", "ROOM_VISITED"].includes(lead.status)) {
      newStatus = "DECISION_PENDING";
    }

    await prisma.visitorLead.update({
      where: { id: leadId },
      data: {
        status: newStatus,
        last_activity_at: new Date(),
        updated_at: new Date()
      }
    });
    await invalidateTag(redisKeys.admissions.owner(ownerId));
    return created;
  }

  async reserveRoom(leadId: string, ownerId: string, input: any) {
    const lead = await prisma.visitorLead.findFirst({ where: { id: leadId, owner_id: ownerId } });
    if (!lead) throw ApiError.notFound("Lead not found");
    const roomId = String(input.room_id || "");
    const room = await prisma.rooms.findFirst({
      where: { id: roomId, hostel_id: lead.hostel_id, hostels: { owner_id: ownerId }, is_active: true },
      include: {
        room_allocations: { where: { is_active: true, end_date: null }, select: { id: true } },
        room_reservations: { where: { status: "ACTIVE", reserved_until: { gt: new Date() } }, select: { id: true, lead_id: true } },
        tenant_invitation_reservations: { where: { status: "ACTIVE", expires_at: { gt: new Date() } }, select: { id: true } },
      },
    });
    if (!room) throw ApiError.notFound("Room not found");
    if (room.room_reservations.some((r: any) => r.lead_id === lead.id)) throw ApiError.conflict("This lead already has an active reservation for this room");
    const activeByPhone = await prisma.roomReservation.count({
      where: {
        status: "ACTIVE",
        reserved_until: { gt: new Date() },
        lead: { student_phone: lead.student_phone },
      },
    });
    if (activeByPhone >= 2) throw ApiError.conflict("This phone number already has the maximum active reservations");
    const recentExpired = await prisma.roomReservation.findFirst({
      where: {
        status: "EXPIRED",
        created_at: { gte: new Date(Date.now() - RESERVATION_COOLDOWN_HOURS * 60 * 60 * 1000) },
        lead: { student_phone: lead.student_phone },
      },
    });
    if (recentExpired) throw ApiError.conflict("Please wait before creating another reservation for this phone number");
    const availability = Number(room.capacity || 0)
      - room.room_allocations.length
      - room.room_reservations.length
      - room.tenant_invitation_reservations.length;
    if (availability <= 0) throw ApiError.conflict("Room has no available beds to reserve");

    const hours = Math.min(72, Math.max(1, Number(input.duration_hours || 24)));
    const reservation = await prisma.roomReservation.create({
      data: {
        lead_id: lead.id,
        room_id: room.id,
        hostel_id: lead.hostel_id,
        reserved_until: new Date(Date.now() + hours * 60 * 60 * 1000),
        approved_by: ownerId,
      },
      include: { room: { select: { id: true, room_no: true, room_type: true } } },
    });
    await this.recordActivity(lead.id, "RESERVE_ROOM", { room_id: room.id, reservation_id: reservation.id });
    return reservation;
  }

  async cancelReservation(leadId: string, reservationId: string, ownerId: string) {
    const reservation = await prisma.roomReservation.findFirst({
      where: { id: reservationId, lead_id: leadId, lead: { owner_id: ownerId } },
    });
    if (!reservation) throw ApiError.notFound("Reservation not found");
    return prisma.roomReservation.update({
      where: { id: reservationId },
      data: { status: "CANCELLED", updated_at: new Date() },
    });
  }

  async expireReservations() {
    const result = await prisma.roomReservation.updateMany({
      where: { status: "ACTIVE", reserved_until: { lt: new Date() } },
      data: { status: "EXPIRED", updated_at: new Date() },
    });
    return { expired: result.count };
  }

  async convertToInvitation(leadId: string, ownerId: string, input: any) {
    const lead = await prisma.visitorLead.findFirst({ where: { id: leadId, owner_id: ownerId } });
    if (!lead) throw ApiError.notFound("Lead not found");
    if (lead.converted_tenant_id) throw ApiError.conflict("Lead is already connected to a tenant invitation");
    // Only reachable once the owner has Accepted the enquiry — mirrors
    // canTransitionLeadStatus's ON_HOLD->ACCEPTED/open->ACCEPTED rules, so a
    // lead can't be converted to a tenant while still sitting on hold or
    // before the owner has made a decision.
    if (lead.status !== "ACCEPTED") {
      throw ApiError.conflict("Accept the enquiry before creating an invitation");
    }
    const email = cleanString(input.email || lead.student_email, 180)?.toLowerCase();
    if (!email) throw ApiError.validationError("Email is required before sending an invitation");
    const roomId = String(input.room_id || "");
    if (!roomId) throw ApiError.validationError("Room is required before sending an invitation");
    // Owner-editable in the Add Tenant form, but default to exactly what the
    // tenant supplied at enquiry so nothing is silently dropped either way.
    const name = cleanString(input.name, 200) || lead.student_name;
    const phone = input.phone ? normalizeIndianPhone(input.phone) || lead.student_phone : lead.student_phone;

    const result: any = await invitationService.inviteTenant({
      email,
      name,
      phone,
      room_id: roomId,
      monthly_rent: input.monthly_rent,
      advance_amount: input.advance_amount,
      maintenance_amount: input.maintenance_amount,
      joining_date: input.joining_date,
      maintenance_type: input.maintenance_type,
      agreement_duration_months: input.agreement_duration_months,
      agreement_start_date: input.agreement_start_date,
      payment_frequency: input.payment_frequency,
    }, ownerId);

    const tenantId = result?.tenant_id || result?.tenant?.id || null;
    const updated = await prisma.visitorLead.update({
      where: { id: leadId },
      data: {
        status: "INVITED",
        student_email: email,
        converted_tenant_id: tenantId,
        converted_at: new Date(),
        updated_at: new Date(),
      },
    });
    if (tenantId) {
      await prisma.roomReservation.updateMany({
        where: { lead_id: leadId, status: "ACTIVE" },
        data: { status: "CONVERTED", converted_at: new Date(), updated_at: new Date() },
      });
    }
    await invalidateTag(redisKeys.admissions.owner(ownerId));
    return { invitation: result, lead: this.shapeLead(updated) };
  }

  async markJoinedForTenant(tenantId: string) {
    await prisma.visitorLead.updateMany({
      where: { converted_tenant_id: tenantId },
      data: { status: "JOINED", updated_at: new Date() },
    });
  }

  async analytics(ownerId: string, query: any) {
    const hostelId = query.hostelId ? String(query.hostelId) : "all";
    const key = redisKeys.admissions.analytics(ownerId, hostelId);
    return getOrSetJson(key, 120, async () => {
      const where: any = { owner_id: ownerId };
      if (query.hostelId) where.hostel_id = String(query.hostelId);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // 1. Fetch active rooms & allocations for vacancy
      const roomsWhere: any = { is_active: true };
      if (query.hostelId) {
        roomsWhere.hostel_id = String(query.hostelId);
      } else {
        roomsWhere.hostels = { owner_id: ownerId };
      }
      const activeRooms = await prisma.rooms.findMany({
        where: roomsWhere,
        include: {
          room_allocations: {
            where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" } },
            select: { id: true }
          },
          hostels: {
            select: { name: true }
          }
        }
      });

      // Compute vacant beds, total capacity, occupied beds
      let vacantBeds = 0;
      let vacancyCapacity = 0;
      let totalBeds = 0;
      let occupiedBeds = 0;

      for (const room of activeRooms) {
        const occupied = room.room_allocations.length;
        const vacant = Math.max(0, room.capacity - occupied);
        const rent = Number(room.base_rent || 8500);

        vacantBeds += vacant;
        vacancyCapacity += vacant * rent;
        totalBeds += room.capacity;
        occupiedBeds += occupied;
      }

      const averageRent = activeRooms.length > 0
        ? Math.round(activeRooms.reduce((sum, r) => sum + Number(r.base_rent || 8500), 0) / activeRooms.length)
        : 8500;

      // 2. Fetch active visitor leads
      const activeLeads = await prisma.visitorLead.findMany({
        where: {
          ...where,
          status: { in: ["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN", "INVITED"] }
        },
        include: {
          hostel: { select: { name: true } },
          reservations: {
            where: { status: "ACTIVE" },
            include: {
              room: {
                select: { id: true, room_no: true, base_rent: true }
              }
            }
          }
        }
      });

      // Compute potential revenue & confidence counts
      let potentialRevenue = 0;
      let likelyFillCount = 0;
      let mediumConfidenceCount = 0;
      let lowConfidenceCount = 0;

      for (const lead of activeLeads) {
        const resRoom = lead.reservations[0]?.room;
        const rent = resRoom?.base_rent ? Number(resRoom.base_rent) : averageRent;
        potentialRevenue += rent;

        if (["READY_TO_JOIN", "INVITED"].includes(lead.status)) {
          likelyFillCount++;
        } else if (["ROOM_VISITED", "DECISION_PENDING", "INTERESTED"].includes(lead.status) || lead.reservations.length > 0) {
          mediumConfidenceCount++;
        } else {
          lowConfidenceCount++;
        }
      }

      // Compute expected revenue (actual-match where possible)
      let expectedRevenue = 0;
      let hasEstimatedRent = false;
      for (const lead of activeLeads) {
        const isHigh = ["READY_TO_JOIN", "INVITED"].includes(lead.status);
        const isMedium = ["ROOM_VISITED", "DECISION_PENDING", "INTERESTED"].includes(lead.status) || lead.reservations.length > 0;
        if (isHigh || isMedium) {
          const resRoom = lead.reservations[0]?.room;
          if (resRoom?.base_rent) {
            expectedRevenue += Number(resRoom.base_rent);
          } else {
            expectedRevenue += averageRent;
            hasEstimatedRent = true;
          }
        }
      }

      // 3. Fetch lead activities in the last 30 days for Room-level demand mapping
      const activeLeadsActivities = await prisma.leadActivity.findMany({
        where: {
          activity_type: "VIEW_ROOM",
          created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          lead: where
        },
        select: {
          lead_id: true,
          metadata: true
        }
      });

      const roomInterests = new Map<string, Set<string>>();
      for (const act of activeLeadsActivities as any[]) {
        const roomId = act.metadata?.room_id;
        if (roomId) {
          if (!roomInterests.has(roomId)) {
            roomInterests.set(roomId, new Set());
          }
          roomInterests.get(roomId)!.add(act.lead_id);
        }
      }
      
      const activeRoomReservations = await prisma.roomReservation.findMany({
        where: {
          status: "ACTIVE",
          lead: where
        },
        select: {
          room_id: true,
          lead_id: true
        }
      });
      for (const res of activeRoomReservations) {
        if (!roomInterests.has(res.room_id)) {
          roomInterests.set(res.room_id, new Set());
        }
        roomInterests.get(res.room_id)!.add(res.lead_id);
      }

      const vacancyDemandMap = activeRooms.map((room) => {
        const occupied = room.room_allocations.length;
        const vacant = Math.max(0, room.capacity - occupied);
        const interested = roomInterests.get(room.id)?.size || 0;
        return {
          room_id: room.id,
          room_no: room.room_no,
          vacant_beds: vacant,
          interested_leads: interested,
        };
      })
      .filter((r) => r.vacant_beds > 0 || r.interested_leads > 0)
      .sort((a, b) => b.interested_leads - a.interested_leads || b.vacant_beds - a.vacant_beds)
      .slice(0, 10);

      // 4. Build Today's Admissions tasks (Follow-up queue with priority sorting)
      const queueWithDetails = activeLeads
        .filter((lead) => {
          if (lead.next_action_at && new Date(lead.next_action_at) > new Date()) {
            return false; // Scheduled in the future, hide from Today's Tasks
          }
          return true;
        })
        .map((lead) => {
          const resRoom = lead.reservations[0]?.room;
          const rent = resRoom?.base_rent ? Number(resRoom.base_rent) : averageRent;
          const isEstimated = !resRoom?.base_rent;

          // Priority calculation
          let priority = 50;
          if (lead.status === "READY_TO_JOIN") {
            priority = 100;
          } else if (lead.status === "INVITED") {
            priority = 80;
          } else if (lead.status === "DECISION_PENDING") {
            priority = 70;
          } else if (lead.status === "ROOM_VISITED") {
            priority = 65;
          } else if (lead.status === "INTERESTED") {
            priority = 60;
          }

          const lastAct = new Date(lead.last_activity_at || lead.updated_at || lead.created_at);
          const daysSinceActivity = (Date.now() - lastAct.getTime()) / (24 * 60 * 60 * 1000);
          if (daysSinceActivity >= 4) {
            priority = Math.max(priority, 65);
          }

          if (lead.next_action_at && new Date(lead.next_action_at) < new Date()) {
            priority += 15; // boost priority for overdue tasks
          }

          // Action recommendation
          let action = "Call";
          if (lead.status === "READY_TO_JOIN") {
            action = "Convert";
          } else if (lead.parent_follow_up_required || lead.status === "DECISION_PENDING") {
            action = "Call Parent";
          } else if (lead.status === "INVITED") {
            action = "Call";
          } else if (["NEW", "INTERESTED"].includes(lead.status)) {
            action = "Schedule Visit";
          }

          let last_activity_desc = "Form submitted";
          if (daysSinceActivity >= 4) {
            last_activity_desc = `No contact for ${Math.floor(daysSinceActivity)} days`;
          } else if (lead.status === "READY_TO_JOIN") {
            last_activity_desc = "Ready to join. Convert now!";
          } else if (lead.parent_follow_up_required || lead.status === "DECISION_PENDING") {
            last_activity_desc = "Follow up with parent required";
          } else if (lead.status === "ROOM_VISITED") {
            last_activity_desc = "Room visited. Waiting decision";
          } else if (lead.status === "INTERESTED") {
            last_activity_desc = "Interested in room. Schedule visit";
          }

          return {
            id: lead.id,
            student_name: lead.student_name,
            student_phone: lead.student_phone,
            parent_phone: lead.parent_phone,
            parent_name: lead.parent_name,
            status: lead.status,
            hostel_name: lead.hostel?.name || "Hostel",
            room_no: resRoom?.room_no || null,
            potential_rent: rent,
            is_estimated_rent: isEstimated,
            last_activity_desc,
            urgency: priority >= 100 ? 3 : priority >= 70 ? 2 : 1,
            priority,
            action,
            next_action_at: lead.next_action_at,
            assigned_to: lead.assigned_to,
          };
        })
        .sort((a, b) => b.priority - a.priority);

      // SLA Ignored leads (>24h)
      const ignoredLeadsCount = activeLeads.filter((lead) => {
        const lastAct = new Date(lead.last_activity_at || lead.created_at);
        const hours = (Date.now() - lastAct.getTime()) / (60 * 60 * 1000);
        return hours > 24;
      }).length;

      // 5. Admissions Today Pulse
      const [scansToday, newLeadsToday, roomVisitsToday, joinsToday] = await Promise.all([
        prisma.leadActivity.count({
          where: {
            activity_type: "VIEW_HOSTEL",
            created_at: { gte: startOfToday },
            lead: where
          }
        }),
        prisma.visitorLead.count({
          where: {
            ...where,
            created_at: { gte: startOfToday }
          }
        }),
        prisma.leadActivity.count({
          where: {
            activity_type: "VIEW_ROOM",
            created_at: { gte: startOfToday },
            lead: where
          }
        }),
        prisma.visitorLead.count({
          where: {
            ...where,
            status: "JOINED",
            updated_at: { gte: startOfToday }
          }
        })
      ]);

      // 6. Time-filtered lost reasons
      const getLostReasonsForDays = async (days: number) => {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const result = await prisma.visitorLead.groupBy({
          by: ["lost_reason"],
          where: {
            ...where,
            status: "LOST",
            updated_at: { gte: since }
          },
          _count: true
        });
        return result.map((r: any) => ({
          reason: r.lost_reason || "OTHER",
          count: r._count
        }));
      };
      const [lost30, lost90, lost365] = await Promise.all([
        getLostReasonsForDays(30),
        getLostReasonsForDays(90),
        getLostReasonsForDays(365)
      ]);

      // 7. QR Scan Performance with Human Outcomes
      const qrLeadsWhere = { ...where, source: "QR" };
      const [qrLeadsCount, qrJoinsCount, qrVisitsToday, qrVisitsMonth, qrTotalVisitsMonth] = await Promise.all([
        prisma.visitorLead.count({ where: qrLeadsWhere }),
        prisma.visitorLead.count({ where: { ...qrLeadsWhere, status: "JOINED" } }),
        prisma.leadActivity.count({
          where: {
            activity_type: "VIEW_HOSTEL",
            created_at: { gte: startOfToday },
            lead: qrLeadsWhere
          }
        }),
        prisma.leadActivity.groupBy({
          by: ["lead_id"],
          where: {
            activity_type: "VIEW_HOSTEL",
            created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            lead: qrLeadsWhere
          }
        }).then((rows: any[]) => rows.length),
        prisma.leadActivity.count({
          where: {
            activity_type: "VIEW_HOSTEL",
            created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            lead: qrLeadsWhere
          }
        })
      ]);

      const qrJoinedLeads = await prisma.visitorLead.findMany({
        where: { ...qrLeadsWhere, status: "JOINED" },
        include: {
          reservations: {
            where: { status: "ACTIVE" },
            include: { room: { select: { base_rent: true } } }
          }
        }
      });
      let qrRevenue = 0;
      for (const jl of qrJoinedLeads) {
        const rent = jl.reservations[0]?.room?.base_rent || averageRent;
        qrRevenue += Number(rent);
      }

      const lastQrLead = await prisma.visitorLead.findFirst({
        where: qrLeadsWhere,
        orderBy: { created_at: "desc" },
        select: { student_name: true, created_at: true }
      });
      const lastScanInfo = lastQrLead ? { name: lastQrLead.student_name, timestamp: lastQrLead.created_at } : null;

      // 8. Source performance
      const allLeadsForSource = await prisma.visitorLead.findMany({
        where,
        include: {
          reservations: {
            where: { status: "ACTIVE" },
            include: { room: { select: { base_rent: true } } }
          }
        }
      });

      const sourceMap = new Map<string, { leads: number; joins: number; revenue: number }>();
      for (const lead of allLeadsForSource) {
        const src = lead.source || "Other";
        if (!sourceMap.has(src)) {
          sourceMap.set(src, { leads: 0, joins: 0, revenue: 0 });
        }
        const stats = sourceMap.get(src)!;
        stats.leads++;
        if (lead.status === "JOINED") {
          stats.joins++;
          const rent = lead.reservations[0]?.room?.base_rent || averageRent;
          stats.revenue += Number(rent);
        }
      }
      const sourcePerfList = Array.from(sourceMap.entries()).map(([source, stats]) => ({
        source,
        leads: stats.leads,
        joins: stats.joins,
        revenue: stats.revenue
      })).sort((a, b) => b.leads - a.leads);

      // 9. Count of opportunities per stage
      const stageCounts = {
        NEW: activeLeads.filter(l => l.status === "NEW").length,
        INTERESTED: activeLeads.filter(l => l.status === "INTERESTED").length,
        ROOM_VISITED: activeLeads.filter(l => l.status === "ROOM_VISITED").length,
        DECISION_PENDING: activeLeads.filter(l => l.status === "DECISION_PENDING").length,
        READY_TO_JOIN: activeLeads.filter(l => l.status === "READY_TO_JOIN").length,
        INVITED: activeLeads.filter(l => l.status === "INVITED").length,
      };

      // 10. Build Admissions Inbox alerts
      const inboxAlerts: any[] = [];
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      
      for (const lead of activeLeads) {
        // 1. Pending callback (next action is overdue)
        if (lead.next_action_at && new Date(lead.next_action_at) < new Date()) {
          inboxAlerts.push({
            lead_id: lead.id,
            student_name: lead.student_name,
            student_phone: lead.student_phone,
            type: "PENDING_CALLBACK",
            title: "Pending Callback Overdue",
            description: `Callback was scheduled for ${new Date(lead.next_action_at).toLocaleString()}`,
            severity: "HIGH",
          });
        }
        
        // 2. Expiring invitation
        if (lead.status === "INVITED") {
          const sentDate = lead.updated_at || lead.created_at;
          if (new Date(sentDate) < threeDaysAgo) {
            inboxAlerts.push({
              lead_id: lead.id,
              student_name: lead.student_name,
              student_phone: lead.student_phone,
              type: "EXPIRING_INVITATION",
              title: "Invitation Expiring",
              description: `Invitation was sent ${Math.floor((Date.now() - new Date(sentDate).getTime()) / (24 * 60 * 60 * 1000))} days ago.`,
              severity: "MEDIUM",
            });
          }
        }
        
        // 3. Inactive Lead
        const lastAct = lead.last_activity_at || lead.updated_at || lead.created_at;
        if (["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING"].includes(lead.status) && new Date(lastAct) < fiveDaysAgo) {
          inboxAlerts.push({
            lead_id: lead.id,
            student_name: lead.student_name,
            student_phone: lead.student_phone,
            type: "INACTIVE_LEAD",
            title: "Inactive Lead Alert",
            description: `No activity recorded for ${Math.floor((Date.now() - new Date(lastAct).getTime()) / (24 * 60 * 60 * 1000))} days.`,
            severity: "LOW",
          });
        }
      }
      
      inboxAlerts.sort((a, b) => {
        const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        return severityOrder[a.severity as keyof typeof severityOrder] ? (severityOrder[b.severity as keyof typeof severityOrder] - severityOrder[a.severity as keyof typeof severityOrder]) : 0;
      });

      // Compute visitor/pre-invite metrics
      const [
        visitors,
        viewedRooms,
        interested,
      ] = await Promise.all([
        prisma.visitorLead.count({ where }),
        prisma.leadActivity.groupBy({ by: ["lead_id"], where: { activity_type: "VIEW_ROOM", lead: where } }).then((rows: any[]) => rows.length),
        prisma.visitorLead.count({ where: { ...where, status: { in: ["INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN", "INVITED", "JOINED"] } } }),
      ]);

      // Onboarding funnel counts, straight from the tenants table.
      const funnelTenants = await prisma.tenants.findMany({
        where: {
          owner_id: ownerId,
          ...(query.hostelId ? { hostel_id: String(query.hostelId) } : {}),
          status: { in: ["INVITED", "ACTIVE"] },
        },
        select: {
          id: true,
          status: true,
        },
      });

      // Activating *is* joining now — a tenant gets their room on activation and
      // pays deposit/maintenance afterwards. The old split of activated tenants
      // into payment-pending / reserved / moved-in described a gate that no longer
      // exists, so the funnel ends at "joined".
      let funnelInvited = 0;
      let funnelJoined = 0;

      for (const t of funnelTenants) {
        if (t.status === "INVITED") {
          funnelInvited++;
        } else if (t.status === "ACTIVE") {
          funnelJoined++;
        }
      }

      return {
        // Funnel & Stats
        funnel: {
          visitors,
          viewed_rooms: viewedRooms,
          interested,
          invited: funnelInvited,
          joined: funnelJoined,
          activated: funnelJoined,
          moved_in: funnelJoined,
          expectedRevenue,
          realizedRevenue: qrRevenue,
          hasEstimatedRent,
        },
        conversion_rate: visitors > 0 ? Math.round((funnelJoined / visitors) * 1000) / 10 : 0,

        // Snapshot (No Real Opportunity, replaced by Potential Revenue)
        snapshot: {
          activeLeadsCount: activeLeads.length,
          potentialRevenue,
          vacancyCapacity,
          bedsLikelyToFill: {
            high: likelyFillCount,
            medium: mediumConfidenceCount,
            low: lowConfidenceCount,
          },
        },

        // Bed Fill Forecast & Vacancy
        bedFillForecast: {
          vacantBeds,
          likelyFill: likelyFillCount,
          atRisk: Math.max(0, vacantBeds - likelyFillCount),
          expectedRevenue,
          hasEstimatedRent,
        },

        vacancy: {
          vacantBeds,
          lostRevenue: vacancyCapacity,
          pipelineCoverage: likelyFillCount,
          remainingRisk: Math.max(0, vacantBeds - likelyFillCount),
          estimatedFillDate: likelyFillCount > 0 ? `Estimated fill: ${Math.max(5, Math.round(30 / likelyFillCount))} days` : "No recent activity to forecast",
        },

        // Forecast
        forecast: {
          forecastOccupancy: totalBeds > 0 ? Math.round(((occupiedBeds + likelyFillCount) / totalBeds) * 100) : 0,
          forecastRevenue: (occupiedBeds + likelyFillCount) * averageRent,
          risk: Math.max(0, vacantBeds - likelyFillCount),
        },

        // SLA SLA SLA
        sla: {
          ignoredCount: ignoredLeadsCount,
        },

        // Today Pulse
        todayPulse: {
          scans: scansToday,
          enquiries: newLeadsToday,
          roomVisits: roomVisitsToday,
          joins: joinsToday,
        },

        // Lost Reasons
        lost_reasons: {
          "30D": lost30,
          "90D": lost90,
          "1Y": lost365
        },

        // QR Performance
        qrPerf: {
          uniqueVisitorsToday: qrVisitsToday,
          uniqueVisitorsMonth: qrVisitsMonth,
          totalVisitsMonth: qrTotalVisitsMonth,
          leadsGenerated: qrLeadsCount,
          joinsGenerated: qrJoinsCount,
          revenueGenerated: qrRevenue,
          conversionRate: qrVisitsMonth > 0 ? Math.round((qrLeadsCount / qrVisitsMonth) * 100) : 0,
          lastScan: lastScanInfo,
        },

        // Queue & Maps
        queue: queueWithDetails,
        sourcePerf: sourcePerfList,
        vacancyDemandMap,
        stageCounts,
        inboxAlerts,
      };
    }, [redisKeys.admissions.owner(ownerId)]);
  }
}

export const admissionsService = new AdmissionsService();
