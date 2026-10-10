import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { addDaysIso, istDateOf, weekdayOfIso } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE } from "@/lib/services/room-capacity-service";
import { normalizeMealTimings } from "@/lib/services/food/meal-timings";
import { whatsAppTemplateDeliveryService, type WhatsAppTemplateDeliveryInput } from "@/lib/services/notifications/whatsapp-template-delivery";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp";
import type { HeadcountLeave } from "@/src/services/stay/stay-board";
import { fromDbDate, toDbDate } from "@/src/services/stay/stay-rows";
import { isMealType, type MealType } from "./meal-ratio";
import { conflict, invalidRequest, notFound } from "./meal-errors";
import {
  buildMealCount,
  cutoffInstant,
  isMealChoice,
  isNoAnswerPolicy,
  nextServeDate,
  type MealChoice,
  type MealResident,
  type NoAnswerPolicy,
} from "./special-meal-rules";

const logger = getLogger("meals.special");

/**
 * Special-meal choices, Phase 1 (spec 2026-10-10). Composes Stay's residents
 * and leaves exactly as the ADR-195 forecast does: it reads Stay and never
 * writes it. "I'm away" stays a meal answer and never becomes a leave.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DISH_MAX = 60;

export interface OccasionView {
  id: string;
  weekday: number;
  mealType: MealType;
  vegDish: string | null;
  nonVegDish: string | null;
  cutoffMinutesBefore: number;
  noAnswerPolicy: NoAnswerPolicy;
  isActive: boolean;
  nextServeDate: string;
}

function viewOf(row: any, today: string): OccasionView {
  return {
    id: row.id,
    weekday: row.weekday,
    mealType: row.meal_type,
    vegDish: row.veg_dish ?? null,
    nonVegDish: row.non_veg_dish ?? null,
    cutoffMinutesBefore: row.cutoff_minutes_before,
    noAnswerPolicy: row.no_answer_policy,
    isActive: row.is_active,
    nextServeDate: nextServeDate(row.weekday, today),
  };
}

function cleanDish(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalidRequest(`${field} must be text`);
  const v = value.trim();
  if (v.length > DISH_MAX) throw invalidRequest(`${field} must be ${DISH_MAX} characters or fewer`);
  return v || null;
}

function cleanCutoff(value: unknown): number {
  if (value === undefined) return 180;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1440) {
    throw invalidRequest("cutoffMinutesBefore must be a whole number of minutes between 0 and 1440");
  }
  return value;
}

export function createSpecialMealService(deps: {
  db?: any;
  sendTemplate?: (input: WhatsAppTemplateDeliveryInput) => Promise<{ sent: boolean; skipped: boolean }>;
  sendText?: (phone: string, text: string) => Promise<unknown>;
} = {}) {
  const db = deps.db ?? prisma;
  const sendTemplate = deps.sendTemplate ?? ((input) => whatsAppTemplateDeliveryService.send(input));
  const sendText = deps.sendText ?? ((phone, text) => new MetaWhatsAppProvider().sendTextMessage(phone, text));

  async function occasionOf(hostelId: string, occasionId: string) {
    const row = await db.special_meal_occasions.findFirst({ where: { id: occasionId, hostel_id: hostelId } });
    if (!row) throw notFound("Special meal not found");
    return row;
  }

  async function residentsOf(hostelId: string): Promise<MealResident[]> {
    const rows = await db.roomAllocation.findMany({
      where: { hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
      select: {
        tenant_id: true,
        room: { select: { room_no: true } },
        tenant: { select: { display_name: true, exit_date: true, phone_1: true, profiles: { select: { name: true, phone: true } } } },
      },
    });
    const seen = new Set<string>();
    const out: MealResident[] = [];
    for (const a of rows as any[]) {
      if (seen.has(a.tenant_id)) continue;
      seen.add(a.tenant_id);
      out.push({
        tenantId: a.tenant_id,
        name: a.tenant?.display_name || a.tenant?.profiles?.name || "Resident",
        roomNo: a.room?.room_no ?? "—",
        exitDate: a.tenant?.exit_date ? fromDbDate(a.tenant.exit_date) : null,
        phone: (a.tenant?.phone_1 || a.tenant?.profiles?.phone || "").trim() || null,
      });
    }
    return out;
  }

  /** Leaves that can touch `serveDate`. A returned leave ends on the day they came back. */
  async function leavesAround(hostelId: string, serveDate: string): Promise<HeadcountLeave[]> {
    const rows = await db.stay_leaves.findMany({
      where: { hostel_id: hostelId, status: { in: ["ACTIVE", "RETURNED"] }, expected_return_date: { gte: toDbDate(serveDate) } },
      select: { tenant_id: true, start_date: true, expected_return_date: true, returned_at: true },
    });
    return (rows as any[]).map((r) => ({
      tenantId: r.tenant_id,
      startDate: fromDbDate(r.start_date),
      expectedReturnDate: r.returned_at ? istDateOf(r.returned_at) : fromDbDate(r.expected_return_date),
    }));
  }

  async function cutoffFor(occasion: any, serveDate: string): Promise<Date> {
    const hostel = await db.hostels.findUnique({ where: { id: occasion.hostel_id }, select: { name: true, preferences_config: true } });
    const timings = normalizeMealTimings(hostel?.preferences_config);
    return cutoffInstant(serveDate, timings[occasion.meal_type as MealType].start, occasion.cutoff_minutes_before);
  }

  async function answersFor(occasionId: string, serveDate: string) {
    const rows = await db.special_meal_answers.findMany({
      where: { occasion_id: occasionId, serve_date: toDbDate(serveDate) },
      select: { tenant_id: true, choice: true, source: true },
    });
    return new Map<string, { choice: MealChoice; source: "WHATSAPP" | "OWNER" }>(
      (rows as any[]).map((r) => [r.tenant_id, { choice: r.choice, source: r.source }]),
    );
  }

  async function lastChoicesBefore(occasionId: string, serveDate: string) {
    const rows = await db.special_meal_answers.findMany({
      where: { occasion_id: occasionId, serve_date: { lt: toDbDate(serveDate) }, choice: { in: ["VEG", "NON_VEG"] } },
      orderBy: { serve_date: "desc" },
      select: { tenant_id: true, choice: true },
    });
    const out = new Map<string, "VEG" | "NON_VEG">();
    for (const r of rows as any[]) if (!out.has(r.tenant_id)) out.set(r.tenant_id, r.choice);
    return out;
  }

  function requireServeDate(occasion: any, value: unknown, today: string): string {
    if (value === undefined || value === null || value === "") return nextServeDate(occasion.weekday, today);
    if (typeof value !== "string" || !ISO_DATE.test(value)) throw invalidRequest("date must be YYYY-MM-DD");
    if (weekdayOfIso(value) !== occasion.weekday) throw invalidRequest("That date is not this special meal's day");
    return value;
  }

  async function listOccasions(hostelId: string, now: Date = new Date()): Promise<OccasionView[]> {
    const rows = await db.special_meal_occasions.findMany({ where: { hostel_id: hostelId }, orderBy: [{ weekday: "asc" }, { meal_type: "asc" }] });
    const today = istDateOf(now);
    return (rows as any[]).map((r) => viewOf(r, today));
  }

  async function createOccasion(hostelId: string, ownerId: string, input: any, now: Date = new Date()): Promise<OccasionView> {
    const weekday = input?.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw invalidRequest("weekday must be 0 (Sunday) to 6 (Saturday)");
    if (!isMealType(input?.mealType)) throw invalidRequest("mealType must be BREAKFAST, LUNCH, SNACKS or DINNER");
    const policy = input?.noAnswerPolicy ?? "LAST_CHOICE";
    if (!isNoAnswerPolicy(policy)) throw invalidRequest("noAnswerPolicy must be LAST_CHOICE or LEAVE_OUT");
    try {
      const row = await db.special_meal_occasions.create({
        data: {
          hostel_id: hostelId,
          owner_id: ownerId,
          weekday,
          meal_type: input.mealType,
          veg_dish: cleanDish(input.vegDish, "vegDish"),
          non_veg_dish: cleanDish(input.nonVegDish, "nonVegDish"),
          cutoff_minutes_before: cleanCutoff(input.cutoffMinutesBefore),
          no_answer_policy: policy,
        },
      });
      return viewOf(row, istDateOf(now));
    } catch (error: any) {
      if (error?.code === "P2002") throw conflict("This hostel already has a special meal on that day");
      throw error;
    }
  }

  async function updateOccasion(hostelId: string, occasionId: string, input: any, now: Date = new Date()): Promise<OccasionView> {
    await occasionOf(hostelId, occasionId);
    const data: Record<string, unknown> = { updated_at: new Date() };
    if ("vegDish" in (input ?? {})) data.veg_dish = cleanDish(input.vegDish, "vegDish");
    if ("nonVegDish" in (input ?? {})) data.non_veg_dish = cleanDish(input.nonVegDish, "nonVegDish");
    if ("cutoffMinutesBefore" in (input ?? {})) data.cutoff_minutes_before = cleanCutoff(input.cutoffMinutesBefore);
    if ("noAnswerPolicy" in (input ?? {})) {
      if (!isNoAnswerPolicy(input.noAnswerPolicy)) throw invalidRequest("noAnswerPolicy must be LAST_CHOICE or LEAVE_OUT");
      data.no_answer_policy = input.noAnswerPolicy;
    }
    if ("isActive" in (input ?? {})) {
      if (typeof input.isActive !== "boolean") throw invalidRequest("isActive must be true or false");
      data.is_active = input.isActive;
    }
    const row = await db.special_meal_occasions.update({ where: { id: occasionId }, data });
    return viewOf(row, istDateOf(now));
  }

  async function getCount(hostelId: string, occasionId: string, date?: string, now: Date = new Date()) {
    const occasion = await occasionOf(hostelId, occasionId);
    const today = istDateOf(now);
    const serveDate = requireServeDate(occasion, date, today);
    const [residents, leaves, answers, lastChoices, cutoffAt] = await Promise.all([
      residentsOf(hostelId),
      leavesAround(hostelId, serveDate),
      answersFor(occasionId, serveDate),
      lastChoicesBefore(occasionId, serveDate),
      cutoffFor(occasion, serveDate),
    ]);
    const count = buildMealCount({ serveDate, policy: occasion.no_answer_policy, residents, leaves, answers, lastChoices });
    return { occasion: viewOf(occasion, today), serveDate, cutoffAt: cutoffAt.toISOString(), isOpen: now < cutoffAt, count };
  }

  /** The warden's correction. Allowed after the cutoff, and labelled OWNER. */
  async function setOwnerAnswer(
    input: { hostelId: string; occasionId: string; tenantId: string; serveDate: unknown; choice: unknown; recordedBy: string },
    now: Date = new Date(),
  ) {
    const occasion = await occasionOf(input.hostelId, input.occasionId);
    const serveDate = requireServeDate(occasion, input.serveDate, istDateOf(now));
    if (input.choice !== null && !isMealChoice(input.choice)) throw invalidRequest("choice must be VEG, NON_VEG, AWAY, SKIP or null");
    const residents = await residentsOf(input.hostelId);
    if (!residents.some((r) => r.tenantId === input.tenantId)) throw notFound("That resident does not live in this hostel");

    const key = { occasion_id: input.occasionId, serve_date: toDbDate(serveDate), tenant_id: input.tenantId };
    if (input.choice === null) {
      await db.special_meal_answers.deleteMany({ where: key });
      return;
    }
    await db.special_meal_answers.upsert({
      where: { occasion_id_serve_date_tenant_id: key },
      create: { ...key, hostel_id: input.hostelId, choice: input.choice, source: "OWNER", recorded_by: input.recordedBy },
      update: { choice: input.choice, source: "OWNER", recorded_by: input.recordedBy, updated_at: new Date() },
    });
  }

  // handleWhatsAppReply — Task 6. runRound — Task 7.

  return { listOccasions, createOccasion, updateOccasion, getCount, setOwnerAnswer };
}

export const specialMealService = createSpecialMealService();
