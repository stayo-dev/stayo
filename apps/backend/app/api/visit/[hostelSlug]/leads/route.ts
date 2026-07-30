export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const LeadCaptureSchema = z.object({
  student_name: z.string().min(2).max(120),
  student_phone: z.string().max(20).optional().or(z.literal("")),
  student_email: z.string().email().max(180).optional().or(z.literal("")),
  parent_name: z.string().max(120).optional().or(z.literal("")),
  parent_phone: z.string().max(20).optional().or(z.literal("")),
  decision_maker_type: z.enum(["STUDENT", "PARENT", "BOTH"]).optional(),
  source: z.enum(["QR", "DIRECT", "WALKIN"]).optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
  website: z.string().max(50).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { hostelSlug: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = LeadCaptureSchema.safeParse(body);
    if (!parsed.success) {
      return ApiResponse.error(ApiError.validationError("Please check the visitor details", { issues: parsed.error.errors }));
    }
    const lead = await admissionsService.createLead(
      params.hostelSlug,
      parsed.data,
      req.headers.get("x-forwarded-for") || req.ip || "unknown",
    );
    return ApiResponse.success(lead, "Lead captured", { status: 201 });
  } catch (error) {
    return ApiResponse.error(error);
  }
}
