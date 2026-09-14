import { prisma } from "@/lib/db";
import { addDaysIso, daysBetweenIso, istDateOf } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE } from "@/lib/services/room-capacity-service";
import { headcountOn, type HeadcountLeave } from "@/src/services/stay/stay-board";
import { fromDbDate, toDbDate } from "@/src/services/stay/stay-rows";
import {
  forecastMeal,
  isMealType,
  mealRatio,
  MEAL_TYPES,
  RATIO_WINDOW_DAYS,
  type MealBasis,
  type MealType,
  type ServedLog,
} from "./meal-ratio";
import { invalidRequest } from "./meal-errors";

/**
 * The meal forecast (ADR-195). Composes Stay's residents and leaves with this
 * hostel's own service history; it never recalculates occupancy and never
 * touches `stay_events`. Composition with Stay runs one way only — meals may
 * read Stay, Stay never reads meals — so the Stay surfaces borrow tonight's
 * dinner in their route rather than through a service dependency.
 */

export interface ForecastMealEntry {
  mealType: MealType;
  expected: number;
  basis: MealBasis;
  samples: number;
  ratio: number;
  headcount: number;
  /** What was actually served that day, once someone has logged it. */
  served: number | null;
}

export interface ForecastDay {
  date: string;
  meals: ForecastMealEntry[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Enough to cover the ratio window with room for unlogged days. */
const HISTORY_DAYS = 60;
/** A range longer than this is a mistake, not a question. */
const MAX_RANGE_DAYS = 14;
/** Above this multiple of the headcount, it is a slipped keypad. */
const IMPLAUSIBLE_MULTIPLE = 3;

function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw invalidRequest(`${field} must be a date as YYYY-MM-DD`);
  }
  return value;
}

export function createMealForecastService(deps: { db?: any } = {}) {
  const db = deps.db ?? prisma;

  async function residentIds(hostelId: string): Promise<Array<{ tenantId: string }>> {
    const allocations = await db.roomAllocation.findMany({
      where: { hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
      select: { tenant_id: true },
    });
    const seen = new Set<string>();
    for (const a of allocations as any[]) seen.add(a.tenant_id);
    return Array.from(seen).map((tenantId) => ({ tenantId }));
  }

  /**
   * Leaves as the headcount needs them. A leave that has ended is RETURNED,
   * not ACTIVE, so yesterday's headcount cannot be computed from active rows
   * alone — and when someone came back early, the day they actually returned
   * is the end of the leave, not the day they had planned.
   */
  async function leavesFrom(hostelId: string, earliest: string): Promise<HeadcountLeave[]> {
    const rows = await db.stay_leaves.findMany({
      where: {
        hostel_id: hostelId,
        status: { in: ["ACTIVE", "RETURNED"] },
        expected_return_date: { gte: toDbDate(earliest) },
      },
      select: { tenant_id: true, start_date: true, expected_return_date: true, returned_at: true },
    });
    return (rows as any[]).map((r) => ({
      tenantId: r.tenant_id,
      startDate: fromDbDate(r.start_date),
      expectedReturnDate: r.returned_at ? istDateOf(r.returned_at) : fromDbDate(r.expected_return_date),
    }));
  }

  async function logsSince(hostelId: string, earliest: string) {
    const rows = await db.meal_service_logs.findMany({
      where: { hostel_id: hostelId, serve_date: { gte: toDbDate(earliest) } },
      select: { serve_date: true, meal_type: true, served_count: true, headcount_at_log: true },
    });
    return (rows as any[]).map((r) => ({
      serveDate: fromDbDate(r.serve_date),
      mealType: String(r.meal_type),
      servedCount: r.served_count,
      headcountAtLog: r.headcount_at_log,
    }));
  }

  async function getForecast(hostelId: string, range: { from?: string; to?: string }, now: Date = new Date()) {
    const today = istDateOf(now);
    const from = range.from === undefined ? today : requireIsoDate(range.from, "from");
    const to = range.to === undefined ? addDaysIso(from, 1) : requireIsoDate(range.to, "to");
    const span = daysBetweenIso(from, to);
    if (span < 0) throw invalidRequest("`to` must not be before `from`");
    if (span > MAX_RANGE_DAYS) throw invalidRequest(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);

    const historyStart = addDaysIso(today, -HISTORY_DAYS);
    const [residents, leaves, logs] = await Promise.all([
      residentIds(hostelId),
      leavesFrom(hostelId, historyStart < from ? historyStart : from),
      logsSince(hostelId, historyStart),
    ]);

    const ratios = new Map<MealType, ReturnType<typeof mealRatio>>();
    for (const mealType of MEAL_TYPES) {
      const own: ServedLog[] = logs
        .filter((l) => l.mealType === mealType)
        .map((l) => ({ serveDate: l.serveDate, servedCount: l.servedCount, headcountAtLog: l.headcountAtLog }));
      ratios.set(mealType, mealRatio(own));
    }

    const days: ForecastDay[] = [];
    for (let offset = 0; offset <= span; offset += 1) {
      const date = addDaysIso(from, offset);
      const headcount = headcountOn(residents, leaves, date);
      days.push({
        date,
        meals: MEAL_TYPES.map((mealType) => {
          const ratio = ratios.get(mealType)!;
          const forecast = forecastMeal(headcount, ratio);
          const logged = logs.find((l) => l.serveDate === date && l.mealType === mealType);
          return {
            mealType,
            expected: forecast.expected,
            basis: forecast.basis,
            samples: forecast.samples,
            ratio: ratio.ratio,
            headcount,
            served: logged ? logged.servedCount : null,
          };
        }),
      });
    }
    return { today, days };
  }

  async function recordServed(
    input: { hostelId: string; serveDate: unknown; mealType: unknown; servedCount: unknown; recordedBy: string | null },
    now: Date = new Date(),
  ): Promise<ForecastMealEntry> {
    const today = istDateOf(now);
    const serveDate = requireIsoDate(input.serveDate, "serveDate");
    if (!isMealType(input.mealType)) throw invalidRequest("mealType must be BREAKFAST, LUNCH, SNACKS or DINNER");
    const servedCount = input.servedCount;
    if (typeof servedCount !== "number" || !Number.isInteger(servedCount) || servedCount < 0) {
      throw invalidRequest("servedCount must be a whole number, zero or more");
    }
    if (serveDate > today) throw invalidRequest("That meal has not been served yet");
    if (daysBetweenIso(serveDate, today) > RATIO_WINDOW_DAYS * 2) {
      throw invalidRequest("That day is too long ago to log");
    }

    const [residents, leaves] = await Promise.all([residentIds(input.hostelId), leavesFrom(input.hostelId, serveDate)]);
    const headcount = headcountOn(residents, leaves, serveDate);
    if (servedCount > Math.max(headcount, 1) * IMPLAUSIBLE_MULTIPLE) {
      throw invalidRequest(`That is more than ${IMPLAUSIBLE_MULTIPLE}× the ${headcount} people staying — check the number`);
    }

    const row = {
      hostel_id: input.hostelId,
      serve_date: toDbDate(serveDate),
      meal_type: input.mealType,
      served_count: servedCount,
      headcount_at_log: headcount,
      recorded_by: input.recordedBy,
    };
    await db.meal_service_logs.upsert({
      where: {
        hostel_id_serve_date_meal_type: {
          hostel_id: input.hostelId,
          serve_date: toDbDate(serveDate),
          meal_type: input.mealType,
        },
      },
      create: row,
      update: {
        served_count: servedCount,
        headcount_at_log: headcount,
        recorded_by: input.recordedBy,
        updated_at: new Date(),
      },
    });

    const ratio = mealRatio([]);
    return {
      mealType: input.mealType,
      expected: servedCount,
      basis: "headcount",
      samples: ratio.samples,
      ratio: ratio.ratio,
      headcount,
      served: servedCount,
    };
  }

  return { getForecast, recordServed };
}

export const mealForecastService = createMealForecastService();
