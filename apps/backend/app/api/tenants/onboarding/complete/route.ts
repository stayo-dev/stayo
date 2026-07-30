import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { tenantOnboardingService } from "@/src/services/tenants/tenant-onboarding-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    // user.id is the profile ID. We need to find the tenant ID.
    // However, maybe tenantOnboardingService can just take the profile ID? Let's check tenantOnboardingService.
    const payload = await req.json();

    const result = await tenantOnboardingService.completeOnboarding(user.id, payload, {
      ip_address: req.headers.get("x-forwarded-for") || req.ip || "unknown",
      user_agent: req.headers.get("user-agent") || "unknown",
    });

    return apiResponse(result, 200);
  } catch (error: any) {
    return apiError(error.message || "Failed to complete onboarding", "ONBOARDING_ERROR", 400);
  }
}
