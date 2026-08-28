export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { discoveryService } from "@/src/services/discovery/discovery-service";
import { requireSeeker } from "@/src/services/discovery/seeker-session";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { getClientIp } from "@/lib/security/api-guard";

const EnquirySchema = z.object({
  slug: z.string().min(1),
  /** Room capacity the seeker picked, e.g. 4 for a 4-bed room. */
  room_capacity: z.number().int().positive().max(50).optional(),
  move_in_date: z.string().max(40).optional(),
  duration_months: z.number().int().positive().max(60).optional(),
  message: z.string().max(1000).optional(),
  /** Optional floor/room the seeker prefers — a preference, not a booking. */
  preferred_floor_id: z.string().uuid().optional(),
  preferred_room_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const seeker = await requireSeeker(req);
    const enquiries = await discoveryService.listEnquiries(seeker.id);
    return ApiResponse.success(enquiries);
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const seeker = await requireSeeker(req);

    // An authenticated account is not on its own a reason to skip rate
    // limiting: signing up is cheap, and an owner's inbox is the thing being
    // protected. Keyed per account rather than per IP so shared campus wifi
    // does not throttle a whole hostel of students.
    const limit = await checkFixedWindowLimit({
      scope: "discover-enquiry",
      identifier: `${seeker.id}:${getClientIp(req) ?? "unknown"}`,
      maxAttempts: 10,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      throw new ApiError("You've sent a lot of enquiries — try again a bit later", 429, "TOO_MANY_REQUESTS", {
        retry_after_seconds: limit.retryAfterSeconds,
      });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = EnquirySchema.safeParse(body);
    if (!parsed.success) throw ApiError.validationError("Check the enquiry details and try again");

    const enquiry = await discoveryService.createEnquiry(seeker, {
      slug: parsed.data.slug,
      roomCapacity: parsed.data.room_capacity,
      moveInDate: parsed.data.move_in_date,
      durationMonths: parsed.data.duration_months,
      message: parsed.data.message,
      preferredFloorId: parsed.data.preferred_floor_id,
      preferredRoomId: parsed.data.preferred_room_id,
    });

    return ApiResponse.success(enquiry, "Enquiry sent to the owner");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
