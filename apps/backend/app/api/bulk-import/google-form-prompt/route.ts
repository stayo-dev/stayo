export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { googleFormPromptService } from "@/lib/services/google-form-prompt-service";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Only owners can generate onboarding prompts", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const hostelId = typeof body?.hostel_id === "string" ? body.hostel_id.trim() : "";

    if (!hostelId) {
      return apiError("hostel_id is required", "VALIDATION_ERROR", 400);
    }

    const result = await googleFormPromptService.generateTenantOnboardingPrompt({
      ownerId: session.sub,
      hostelId,
      notes: body?.notes,
    });

    return apiResponse(result);
  } catch (error: any) {
    const rawMessage = String(error?.message || "Failed to generate Google Form prompt");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      VALIDATION_ERROR: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      INTERNAL_ERROR: 500,
    };

    const status = statusMap[normalizedCode] || 500;
    return apiError(normalizedMessage, normalizedCode || "PROMPT_GENERATION_ERROR", status);
  }
}
