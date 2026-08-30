export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeMealTimings } from "@/lib/services/food/meal-timings";
import { buildMenuContent, type MenuSlot } from "@/lib/pdf/menu-content";
import { renderMenuPdf } from "@/lib/pdf/menu-template-pdf-lib";

/**
 * GET /api/food/menu-pdf?hostelId=&month=YYYY-MM
 *
 * The weekly menu as an A4 landscape sheet the owner prints and tapes to the
 * kitchen and canteen wall — the paper chart this product is replacing.
 *
 * Returns the PDF bytes directly rather than a URL: this is a document the
 * owner asked for by pressing a button, not an artefact worth storing. It is
 * regenerated from the live schedule every time, so a menu edited five minutes
 * ago prints correctly and no stale copy can exist.
 *
 * Content lives in `lib/pdf/menu-content.ts` (pure, tested) and layout in
 * `menu-template-pdf-lib.ts`, the same split the receipt uses. See ADR-144.
 */

const SLOT_BY_MEAL_TYPE: Record<string, MenuSlot> = {
  BREAKFAST: "breakfast",
  LUNCH: "lunch",
  SNACKS: "snacks",
  DINNER: "dinner",
};

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const url = new URL(req.url);
  const hostelId = url.searchParams.get("hostelId");
  const month = url.searchParams.get("month");

  if (!hostelId) return apiError("hostelId is required", "VALIDATION_ERROR", 400);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return apiError("month must be YYYY-MM", "VALIDATION_ERROR", 400);
  }

  try {
    // Ownership is the guard: an ADMIN passes any hostel, an OWNER only their
    // own. Without the owner_id filter this would print any hostel's menu.
    const hostel = await prisma.hostels.findFirst({
      where: {
        id: hostelId,
        ...(session.role === "ADMIN" ? {} : { owner_id: session.sub }),
      },
      select: {
        id: true,
        name: true,
        logo_url: true,
        address: true,
        city: true,
        phone: true,
        public_slug: true,
        listing_status: true,
        preferences_config: true,
      },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const schedule = await prisma.food_schedules.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId, month } },
      include: {
        food_schedule_meals: {
          include: { food_schedule_meal_items: { orderBy: { display_order: "asc" } } },
        },
      },
    });
    if (!schedule) {
      return apiError("No menu exists for that month yet", "NOT_FOUND", 404);
    }

    const timings = normalizeMealTimings(hostel.preferences_config);

    const content = buildMenuContent({
      hostelName: hostel.name,
      logoUrl: hostel.logo_url,
      address: hostel.address,
      city: hostel.city,
      phone: hostel.phone,
      month,
      status: schedule.status,
      cells: schedule.food_schedule_meals.map((meal: any) => ({
        day: String(meal.day_of_week),
        slot: SLOT_BY_MEAL_TYPE[String(meal.meal_type)] ?? String(meal.meal_type).toLowerCase(),
        items: meal.food_schedule_meal_items.map((item: any) => ({ name: item.item_name })),
      })),
      timings: {
        // A meal the hostel has switched off has no window to print, and
        // printing yesterday's disabled hours would be worse than printing none.
        breakfast: timings.BREAKFAST.enabled ? timings.BREAKFAST : null,
        lunch: timings.LUNCH.enabled ? timings.LUNCH : null,
        snacks: timings.SNACKS.enabled ? timings.SNACKS : null,
        dinner: timings.DINNER.enabled ? timings.DINNER : null,
      },
      // Only a hostel with a live listing gets a QR — see `menu-content.ts`.
      publicSlug: String(hostel.listing_status ?? "").toUpperCase() === "PUBLISHED" ? hostel.public_slug : null,
      publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || null,
    });

    const bytes = await renderMenuPdf(content);
    const safeName = String(hostel.name || "hostel").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}-menu-${month}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to build the menu PDF");
  }
}
