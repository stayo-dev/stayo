import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { hasOwnLogin } from "@/src/services/tenants/activation-workflow-service";

/**
 * The onboarding an email-code request belongs to, from its activation token.
 *
 * Token only: a tenant with a session is already set up, and their address is
 * their login — there is nothing for this flow to prove. Someone who already
 * signs in with a real address is refused for the same reason, so these
 * endpoints can never be used to change an existing login.
 */
export async function resolveOnboardingForEmail(token: unknown): Promise<
  | { ok: true; invitationId: string; profileId: string | null; tenantName: string | null; hostelName: string | null }
  | { ok: false; status: number; code: string; message: string }
> {
  const value = String(token ?? "").trim();
  if (!value) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "token is required" };

  let resolved: any;
  try {
    resolved = await tenantInvitationLifecycleService.resolveByToken(value);
  } catch {
    resolved = null;
  }
  if (!resolved?.invitation?.id || !resolved?.tenant) {
    return { ok: false, status: 410, code: "INVALID", message: "This invitation link has expired or isn't valid any more" };
  }
  if (hasOwnLogin(resolved.profile)) {
    return {
      ok: false,
      status: 409,
      code: "EMAIL_ALREADY_SET",
      message: "Your account already has an email — you don't need to confirm another one",
    };
  }
  return {
    ok: true,
    invitationId: resolved.invitation.id,
    profileId: resolved.profile?.id ?? null,
    tenantName: resolved.invitation.name ?? null,
    hostelName: resolved.tenant.hostels?.name ?? null,
  };
}

export function requestIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}
