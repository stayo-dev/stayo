import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { addDaysIso, istDateOf, weekdayOfIso } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE } from "@/lib/services/room-capacity-service";
import { normalizeMealTimings } from "@/lib/services/food/meal-timings";
import { whatsAppTemplateDeliveryService, type WhatsAppTemplateDeliveryInput } from "@/lib/services/notifications/whatsapp-template-delivery";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp";
import type { SenderIdentity } from "@/lib/services/notifications/routing/types";
import {
  SPECIAL_MEAL_QUESTION_TEMPLATE,
  answeredReply,
  buildQuestionParameters,
  closedReply,
  decodeMealPayload,
  encodeMealPayload,
  parseTypedChoice,
} from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";
import type { HeadcountLeave } from "@/src/services/stay/stay-board";
import { fromDbDate, toDbDate } from "@/src/services/stay/stay-rows";
import { isMealType, type MealType } from "./meal-ratio";
import { conflict, invalidRequest, notFound } from "./meal-errors";
import {
  askAudience,
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

  async function recordWhatsApp(occasion: any, tenantId: string, serveDate: string, choice: MealChoice) {
    const key = { occasion_id: occasion.id, serve_date: toDbDate(serveDate), tenant_id: tenantId };
    await db.special_meal_answers.upsert({
      where: { occasion_id_serve_date_tenant_id: key },
      create: { ...key, hostel_id: occasion.hostel_id, choice, source: "WHATSAPP", recorded_by: null },
      update: { choice, source: "WHATSAPP", recorded_by: null, updated_at: new Date() },
    });
  }

  async function handleWhatsAppReply(phone: string, body: string, identity: SenderIdentity, now: Date = new Date()) {
    const guardianOf = new Set(identity.guardianResidents.map((g) => g.tenantId));
    const own = identity.residents.filter((r) => !guardianOf.has(r.tenantId));
    if (own.length === 0) return { handled: false };

    const decoded = decodeMealPayload(body);
    if (decoded) {
      const mine = own.find((r) => r.tenantId === decoded.tenantId);
      if (!mine) {
        logger.warn("special_meal.payload_tenant_not_own", { tenant_id: decoded.tenantId });
        return { handled: false };
      }
      const occasion = await db.special_meal_occasions.findFirst({ where: { id: decoded.occasionId, hostel_id: mine.hostelId } });
      // A button payload arrives as plain text and can be typed by hand, so its
      // date is untrusted: only the occasion's own weekday is a real serving.
      if (!occasion || weekdayOfIso(decoded.serveDate) !== occasion.weekday) return { handled: false };
      const cutoffAt = await cutoffFor(occasion, decoded.serveDate);
      const copy = { serveDate: decoded.serveDate, mealType: occasion.meal_type, cutoffAt };
      if (now >= cutoffAt) {
        await sendText(phone, closedReply(copy));
        return { handled: true, outcome: "CLOSED" };
      }
      await recordWhatsApp(occasion, decoded.tenantId, decoded.serveDate, decoded.choice);
      await sendText(phone, answeredReply({ ...copy, choice: decoded.choice }));
      return { handled: true, outcome: "ANSWERED" };
    }

    const choice = parseTypedChoice(body);
    if (!choice) return { handled: false };

    const today = istDateOf(now);
    const dates = [today, addDaysIso(today, 1)];
    if (own.length > 1) {
      await sendText(phone, "Please tap a button in the meal message so we know who it's for.");
      return { handled: true, outcome: "AMBIGUOUS" };
    }
    const resident = own[0];
    const occasions = await db.special_meal_occasions.findMany({
      where: { hostel_id: resident.hostelId, is_active: true, weekday: { in: dates.map(weekdayOfIso) } },
    });
    const candidates: Array<{ occasion: any; serveDate: string; cutoffAt: Date }> = [];
    for (const occasion of occasions as any[]) {
      for (const serveDate of dates) {
        if (weekdayOfIso(serveDate) !== occasion.weekday) continue;
        candidates.push({ occasion, serveDate, cutoffAt: await cutoffFor(occasion, serveDate) });
      }
    }
    if (candidates.length === 0) return { handled: false };

    const open = candidates.filter((c) => now < c.cutoffAt).sort((a, b) => a.cutoffAt.getTime() - b.cutoffAt.getTime());
    if (open.length === 0) {
      const latest = candidates.sort((a, b) => b.cutoffAt.getTime() - a.cutoffAt.getTime())[0];
      await sendText(phone, closedReply({ serveDate: latest.serveDate, mealType: latest.occasion.meal_type, cutoffAt: latest.cutoffAt }));
      return { handled: true, outcome: "CLOSED" };
    }
    const target = open[0];
    await recordWhatsApp(target.occasion, resident.tenantId, target.serveDate, choice);
    await sendText(phone, answeredReply({ choice, serveDate: target.serveDate, mealType: target.occasion.meal_type, cutoffAt: target.cutoffAt }));
    return { handled: true, outcome: "ANSWERED" };
  }

  /**
   * One daily round. ASK (≈18:00 IST) covers tomorrow's servings, REMIND
   * (≈08:00 IST) covers today's. Vercel Hobby fires each anywhere in its hour,
   * so a serving whose cutoff has already passed is skipped, never asked.
   * Idempotent per tenant per serving per kind via whatsapp_logs.idempotency_key.
   */
  async function runRound(kind: "ASK" | "REMIND", now: Date = new Date()) {
    const today = istDateOf(now);
    const serveDate = kind === "ASK" ? addDaysIso(today, 1) : today;
    const occasions = await db.special_meal_occasions.findMany({ where: { weekday: weekdayOfIso(serveDate), is_active: true } });
    const result = { occasions: (occasions as any[]).length, sent: 0, skipped: 0, failed: 0, closed: 0 };

    for (const occasion of occasions as any[]) {
      const cutoffAt = await cutoffFor(occasion, serveDate);
      if (now >= cutoffAt) {
        result.closed += 1;
        continue;
      }
      const [residents, leaves, answers] = await Promise.all([
        residentsOf(occasion.hostel_id),
        leavesAround(occasion.hostel_id, serveDate),
        answersFor(occasion.id, serveDate),
      ]);
      const audience = askAudience({ serveDate, residents, leaves, answered: new Set(answers.keys()) });
      for (const person of audience) {
        try {
          const outcome = await sendTemplate({
            phone: person.phone,
            templateName: SPECIAL_MEAL_QUESTION_TEMPLATE.name,
            languageCode: SPECIAL_MEAL_QUESTION_TEMPLATE.language,
            bodyParameters: buildQuestionParameters({
              tenantName: person.name, serveDate, mealType: occasion.meal_type,
              vegDish: occasion.veg_dish, nonVegDish: occasion.non_veg_dish, cutoffAt,
            }),
            quickReplyPayloads: SPECIAL_MEAL_QUESTION_TEMPLATE.quickReplies.map((q) =>
              encodeMealPayload({ occasionId: occasion.id, serveDate, tenantId: person.tenantId, choice: q.choice }),
            ),
            idempotencyKey: `special_meal_${kind.toLowerCase()}:${occasion.id}:${serveDate}:${person.tenantId}`,
            tenantId: person.tenantId,
            hostelId: occasion.hostel_id,
            ownerId: occasion.owner_id,
          });
          if (outcome.sent) result.sent += 1;
          else result.skipped += 1;
        } catch (error: any) {
          result.failed += 1;
          logger.warn("special_meal.send_failed", { kind, occasion_id: occasion.id, tenant_id: person.tenantId, error: error?.message || String(error) });
        }
      }
    }
    logger.info("special_meal.round_done", { kind, serve_date: serveDate, ...result });
    return result;
  }

  return { listOccasions, createOccasion, updateOccasion, getCount, setOwnerAnswer, handleWhatsAppReply, runRound };
}

export const specialMealService = createSpecialMealService();
