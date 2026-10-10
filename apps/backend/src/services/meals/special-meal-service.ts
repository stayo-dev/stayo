import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { addDaysIso, istDateOf, weekdayOfIso } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE } from "@/lib/services/room-capacity-service";
import { normalizeMealTimings } from "@/lib/services/food/meal-timings";
import { whatsAppTemplateDeliveryService, type WhatsAppTemplateDeliveryInput } from "@/lib/services/notifications/whatsapp-template-delivery";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp";
import type { SenderIdentity } from "@/lib/services/notifications/routing/types";
import {
  MEAL_READY_TEMPLATES,
  SPECIAL_MEAL_QUESTION_TEMPLATE,
  answeredReply,
  buildQuestionParameters,
  buildReadyParameters,
  decodeReadyPayload,
  encodeReadyPayload,
  onMyWayReply,
  readyTemplateFor,
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
  readyRecipients,
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
/** Parallel sends per batch for the ready alert: quick enough for 50+ residents, gentle on Meta's rate limit. */
const READY_BATCH = 5;

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

  async function mealStartFor(occasion: any): Promise<string> {
    const hostel = await db.hostels.findUnique({ where: { id: occasion.hostel_id }, select: { preferences_config: true } });
    return normalizeMealTimings(hostel?.preferences_config)[occasion.meal_type as MealType].start;
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
    if ("weekday" in (input ?? {})) {
      const w = input.weekday;
      if (typeof w !== "number" || !Number.isInteger(w) || w < 0 || w > 6) throw invalidRequest("weekday must be 0 (Sunday) to 6 (Saturday)");
      data.weekday = w;
    }
    if ("mealType" in (input ?? {})) {
      if (!isMealType(input.mealType)) throw invalidRequest("mealType must be BREAKFAST, LUNCH, SNACKS or DINNER");
      data.meal_type = input.mealType;
    }
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
    try {
      const row = await db.special_meal_occasions.update({ where: { id: occasionId }, data });
      return viewOf(row, istDateOf(now));
    } catch (error: any) {
      if (error?.code === "P2002") throw conflict("This hostel already has a special meal on that day");
      throw error;
    }
  }

  /** Deletes the special meal with its answers and ready alerts (FK cascade in migration 096). */
  async function deleteOccasion(hostelId: string, occasionId: string) {
    await occasionOf(hostelId, occasionId);
    await db.special_meal_occasions.delete({ where: { id: occasionId } });
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
    const [readyAlerts, contacted, mealStart] = await Promise.all([readyAlertsFor(occasionId, serveDate), contactedFor(occasionId, serveDate), mealStartFor(occasion)]);
    const audience = askAudience({ serveDate, residents, leaves, answered: new Set(answers.keys()) });
    const reached = new Set(Array.from(contacted.askOk).concat(Array.from(contacted.remindOk)));
    const outreach = {
      asked: contacted.askOk.size,
      reminded: contacted.remindOk.size,
      unreachable: Array.from(contacted.failed).filter((t) => !reached.has(t)).length,
      toAsk: audience.filter((p) => !contacted.anyAsk.has(p.tenantId) && !contacted.anyRemind.has(p.tenantId)).length,
      toRemind: audience.filter((p) => contacted.anyAsk.has(p.tenantId) && !contacted.anyRemind.has(p.tenantId)).length,
    };
    return {
      occasion: viewOf(occasion, today),
      serveDate,
      /** The meal's serving start, "HH:mm" IST, from Meal Plan or the defaults. */
      mealStart,
      cutoffAt: cutoffAt.toISOString(),
      isOpen: now < cutoffAt,
      isToday: serveDate === today,
      count,
      readyAlerts,
      outreach,
    };
  }

  async function readyAlertsFor(occasionId: string, serveDate: string) {
    const rows = await db.special_meal_ready_alerts.findMany({
      where: { occasion_id: occasionId, serve_date: toDbDate(serveDate) },
      select: { choice: true, created_at: true, recipients: true },
    });
    return (rows as any[]).map((r) => ({ choice: r.choice as "VEG" | "NON_VEG", sentAt: new Date(r.created_at).toISOString(), recipients: r.recipients }));
  }

  /** Meta's "template name does not exist / not approved" — the cue to fall back to the first wording. */
  function isMissingTemplate(error: any): boolean {
    return String(error?.providerCode ?? error?.code ?? "") === "132001" || String(error?.message ?? "").includes("132001");
  }

  /**
   * "Food's ready" (the cook's button). Only on the day it is served, at most
   * once per choice per serving (the row is inserted before any send, so its
   * unique key wins a double tap), and only to residents it was cooked for.
   */
  async function sendReadyAlert(
    input: { hostelId: string; occasionId: string; choice: unknown; sentBy: string },
    now: Date = new Date(),
  ) {
    if (input.choice !== "VEG" && input.choice !== "NON_VEG" && input.choice !== "BOTH") {
      throw invalidRequest("choice must be VEG, NON_VEG or BOTH");
    }
    const occasion = await occasionOf(input.hostelId, input.occasionId);
    const today = istDateOf(now);
    if (nextServeDate(occasion.weekday, today) !== today) throw invalidRequest("This special meal isn't being served today");
    const serveDate = today;
    const choices: Array<"VEG" | "NON_VEG"> = input.choice === "BOTH" ? ["NON_VEG", "VEG"] : [input.choice];

    const [residents, leaves, answers, lastChoices, hostel] = await Promise.all([
      residentsOf(input.hostelId),
      leavesAround(input.hostelId, serveDate),
      answersFor(occasion.id, serveDate),
      lastChoicesBefore(occasion.id, serveDate),
      db.hostels.findUnique({ where: { id: input.hostelId }, select: { name: true } }),
    ]);
    const count = buildMealCount({ serveDate, policy: occasion.no_answer_policy, residents, leaves, answers, lastChoices });
    const template = readyTemplateFor(serveDate);
    const fallback = MEAL_READY_TEMPLATES[0];

    const alerts: Array<{ choice: "VEG" | "NON_VEG"; sent: number; failed: number; alreadySent: boolean }> = [];
    for (const choice of choices) {
      let alert: any;
      try {
        alert = await db.special_meal_ready_alerts.create({
          data: { occasion_id: occasion.id, hostel_id: input.hostelId, serve_date: toDbDate(serveDate), choice, sent_by: input.sentBy },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          alerts.push({ choice, sent: 0, failed: 0, alreadySent: true });
          continue;
        }
        throw error;
      }

      const dish = choice === "VEG" ? occasion.veg_dish : occasion.non_veg_dish;
      const recipients = readyRecipients(count.people, residents, choice);
      let sent = 0;
      let failed = 0;
      for (let i = 0; i < recipients.length; i += READY_BATCH) {
        await Promise.all(
          recipients.slice(i, i + READY_BATCH).map(async (person) => {
            const base = {
              phone: person.phone,
              bodyParameters: buildReadyParameters({ tenantName: person.name, dish, choice, hostelName: hostel?.name }),
              quickReplyPayloads: [encodeReadyPayload({ occasionId: occasion.id, serveDate, tenantId: person.tenantId })],
              tenantId: person.tenantId,
              hostelId: input.hostelId,
              ownerId: occasion.owner_id,
            };
            const key = `special_meal_ready:${occasion.id}:${serveDate}:${choice}:${person.tenantId}`;
            try {
              const outcome = await sendTemplate({ ...base, templateName: template.name, languageCode: template.language, idempotencyKey: key });
              if (outcome.sent) sent += 1;
            } catch (error: any) {
              if (template.name !== fallback.name && isMissingTemplate(error)) {
                try {
                  const outcome = await sendTemplate({ ...base, templateName: fallback.name, languageCode: fallback.language, idempotencyKey: `${key}:fallback` });
                  if (outcome.sent) sent += 1;
                  return;
                } catch (retryError: any) {
                  error = retryError;
                }
              }
              failed += 1;
              logger.warn("special_meal.ready_send_failed", { occasion_id: occasion.id, tenant_id: person.tenantId, error: error?.message || String(error) });
            }
          }),
        );
      }
      await db.special_meal_ready_alerts.update({ where: { id: alert.id }, data: { recipients: sent } });
      alerts.push({ choice, sent, failed, alreadySent: false });
    }

    if (alerts.every((a) => a.alreadySent)) throw conflict("Residents were already told it's ready");
    return { alerts };
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

    const onMyWay = decodeReadyPayload(body);
    if (onMyWay) {
      const mine = own.find((r) => r.tenantId === onMyWay.tenantId);
      if (!mine) return { handled: false };
      await sendText(phone, onMyWayReply(mine.name, mine.tenantId));
      return { handled: true, outcome: "ON_MY_WAY" };
    }

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
   * Who has already been messaged for one serving, read from the delivery
   * log's idempotency keys (`special_meal_{ask|remind}:{occasion}:{date}:{tenant}`).
   * The keys are shared by the crons and the owner's buttons, which is what
   * stops either from repeating the other. A key is final even when the send
   * FAILED (the reservation insert is ON CONFLICT DO NOTHING), so a failed
   * ask is reported as unreachable rather than offered again; a reminder is
   * its one second try.
   */
  async function contactedFor(occasionId: string, serveDate: string) {
    const prefix = (kind: string) => `special_meal_${kind}:${occasionId}:${serveDate}:`;
    const rows = await db.whatsapp_logs.findMany({
      where: { OR: [{ idempotency_key: { startsWith: prefix("ask") } }, { idempotency_key: { startsWith: prefix("remind") } }] },
      select: { idempotency_key: true, status: true },
    });
    const out = { anyAsk: new Set<string>(), anyRemind: new Set<string>(), askOk: new Set<string>(), remindOk: new Set<string>(), failed: new Set<string>() };
    for (const r of (rows ?? []) as any[]) {
      const key = String(r.idempotency_key || "");
      const tenantId = key.split(":").pop() || "";
      const ok = String(r.status || "").toUpperCase() !== "FAILED";
      if (key.startsWith(prefix("ask"))) {
        out.anyAsk.add(tenantId);
        if (ok) out.askOk.add(tenantId);
      } else {
        out.anyRemind.add(tenantId);
        if (ok) out.remindOk.add(tenantId);
      }
      if (!ok) out.failed.add(tenantId);
    }
    return out;
  }

  /**
   * Send the question for one serving. ASK reaches residents nobody has
   * messaged yet; REMIND reaches every resident still silent who hasn't had a
   * reminder. Both skip the away, the moved out and the already answered.
   */
  async function sendRoundFor(occasion: any, serveDate: string, kind: "ASK" | "REMIND", cutoffAt: Date) {
    const [residents, leaves, answers, contacted] = await Promise.all([
      residentsOf(occasion.hostel_id),
      leavesAround(occasion.hostel_id, serveDate),
      answersFor(occasion.id, serveDate),
      contactedFor(occasion.id, serveDate),
    ]);
    const audience = askAudience({ serveDate, residents, leaves, answered: new Set(answers.keys()) }).filter((p) =>
      kind === "ASK" ? !contacted.anyAsk.has(p.tenantId) && !contacted.anyRemind.has(p.tenantId) : !contacted.anyRemind.has(p.tenantId),
    );
    const result = { sent: 0, skipped: 0, failed: 0 };
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
    return result;
  }

  /**
   * One daily round. ASK (≈18:00 IST) covers tomorrow's servings, REMIND
   * (≈08:00 IST) covers today's. Vercel Hobby fires each anywhere in its hour,
   * so a serving whose cutoff has already passed is skipped, never asked.
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
      const r = await sendRoundFor(occasion, serveDate, kind, cutoffAt);
      result.sent += r.sent;
      result.skipped += r.skipped;
      result.failed += r.failed;
    }
    logger.info("special_meal.round_done", { kind, serve_date: serveDate, ...result });
    return result;
  }

  /**
   * The owner's "Ask now" / "Remind now" — the same send as the crons, for the
   * occasion's next serving, whenever the owner chooses, while answers are open.
   */
  async function sendNow(input: { hostelId: string; occasionId: string; kind: unknown }, now: Date = new Date()) {
    if (input.kind !== "ASK" && input.kind !== "REMIND") throw invalidRequest("kind must be ASK or REMIND");
    const occasion = await occasionOf(input.hostelId, input.occasionId);
    const serveDate = nextServeDate(occasion.weekday, istDateOf(now));
    const cutoffAt = await cutoffFor(occasion, serveDate);
    if (now >= cutoffAt) throw invalidRequest("Answers for this meal have closed");
    const r = await sendRoundFor(occasion, serveDate, input.kind, cutoffAt);
    logger.info("special_meal.send_now", { kind: input.kind, occasion_id: occasion.id, serve_date: serveDate, ...r });
    return { serveDate, ...r };
  }

  return { listOccasions, createOccasion, updateOccasion, getCount, setOwnerAnswer, handleWhatsAppReply, runRound, sendReadyAlert, sendNow, deleteOccasion };
}

export const specialMealService = createSpecialMealService();
