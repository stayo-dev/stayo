import { prisma } from "@/lib/db";
import { samePhone } from "./invitation-phone-trust";

/**
 * Which existing Stayo account, if any, this invitation belongs to.
 *
 * ## The bug this exists to fix
 *
 * A Stayo Discover seeker already has an account: they signed up, verified a
 * phone at enquiry time, and their enquiry *is* a `visitor_leads` row carrying
 * `seeker_profile_id`. When the owner accepted and invited them,
 * `convertToInvitation` recorded `converted_tenant_id` on that lead but nothing
 * carried the person's identity onto the tenancy — `createInvitation` writes
 * `profile_id: null`.
 *
 * Activation therefore met them as a stranger. It asked them to OTP a number we
 * had just WhatsApp'd the invitation to, then asked for their email and refused
 * it as "already registered" — because it *was*, by their own account, which was
 * sitting right there unlinked.
 *
 * ## Why the link is resolved here and not written at invite time
 *
 * Setting `tenants.profile_id` when the invitation is created would look
 * simpler, but binding a profile to a tenancy is what makes a person "taken":
 * `tenants_one_live_tenancy_per_profile` and `assertCanStartNewTenancy` both key
 * off it, and the product deliberately allows a person to hold invitations from
 * competing hostels until they activate one. Binding early would make the first
 * owner to send an invite win by default. So the link is *resolved* on demand
 * and still *bound* at activation, exactly when it was before.
 *
 * No new column: `visitor_leads.converted_tenant_id` is already written and
 * already indexed.
 */

export type InvitedProfileSource = "bound" | "lead" | "contact" | "none";

export type InvitedProfileResolution = {
  profile: any | null;
  source: InvitedProfileSource;
  /**
   * Set when an existing account matched the invitation's email but could not
   * be adopted. The invitation cannot proceed as a new account either — the
   * email is unique — so the owner has to fix the contact details.
   */
  conflict?: { email: string };
};

/**
 * Whether an account found purely by email may be adopted into this tenancy.
 *
 * Email alone is not enough. An owner typing a walk-in's details can mistype an
 * address that belongs to a real Stayo user, and adopting on that basis would
 * hand a stranger's account — their login, their documents, their residency
 * history — to whoever holds the invitation link.
 *
 * So a second, independent signal is required: the invitation must have been
 * addressed to the number that account has already verified. Two contact points
 * agreeing is not proof, but a single mistyped field can no longer do damage.
 *
 * Pure, and tested directly.
 */
export function canAdoptByContact(
  profile: { phone: string | null; phone_verified?: boolean | null; mobile_verified?: boolean | null } | null,
  invitationPhone: string | null,
): boolean {
  if (!profile || !invitationPhone) return false;
  // Last-10 comparison: these two columns store different formats. See samePhone.
  if (!profile.phone || !samePhone(profile.phone, invitationPhone)) return false;
  return Boolean(profile.phone_verified || profile.mobile_verified);
}

/**
 * The address this activation should use, without asking the invitee for it.
 *
 * The Identity screen used to require a `@gmail.com` address and write it over
 * `profiles.email` — which is the person's *login*. So the screen quietly
 * offered to change how they sign in, and rejected them when they left it as it
 * was. We already hold the address in every case, so it is no longer asked for:
 *
 * 1. the linked account's own address — it is their login, and onboarding has
 *    no business changing it;
 * 2. otherwise the address the owner invited them at, which is also where the
 *    invitation email would have gone;
 * 3. otherwise a placeholder derived from the phone. `profiles.email` is unique
 *    and NOT NULL, and an owner may invite by phone alone
 *    (`createInvitation` requires a phone and treats email as optional), so
 *    there has to be *something*. `@hms.temp` is the convention already used
 *    for this elsewhere in the product.
 *
 * The Gmail-only rule is gone with the field. It rejected perfectly good
 * addresses people had already signed up with.
 */
export function resolveActivationEmail(input: {
  profile: { email?: string | null } | null;
  invitation: { email?: string | null } | null;
  phone: string | null;
}): string | null {
  const fromProfile = String(input.profile?.email || "").trim().toLowerCase();
  if (fromProfile) return fromProfile;

  const fromInvitation = String(input.invitation?.email || "").trim().toLowerCase();
  if (fromInvitation) return fromInvitation;

  const phone = String(input.phone || "").trim();
  return phone ? `${phone}@hms.temp` : null;
}

/**
 * Resolve in order of how much the source actually knows:
 *
 * 1. **bound** — the tenancy already names a profile (a resend, or a
 *    part-finished activation). Authoritative, nothing to work out.
 * 2. **lead** — the enquiry this invitation came from names its sender.
 *    Authoritative: the person explicitly signed in and enquired as that account.
 * 3. **contact** — no explicit link, so fall back to matching the invitation's
 *    email, and adopt only under `canAdoptByContact` above.
 * 4. **none** — nobody by that email. A genuinely new person; activation creates
 *    the account as it always did.
 */
export async function resolveInvitedProfile(
  tenant: { id: string; profile_id?: string | null; profiles?: any },
  invitation: { email?: string | null; phone?: string | null } | null,
): Promise<InvitedProfileResolution> {
  if (tenant?.profiles) return { profile: tenant.profiles, source: "bound" };
  if (tenant?.profile_id) {
    const bound = await prisma.profile.findUnique({ where: { id: tenant.profile_id } });
    if (bound) return { profile: bound, source: "bound" };
  }

  const lead = await prisma.visitorLead.findFirst({
    where: { converted_tenant_id: tenant.id, seeker_profile_id: { not: null } },
    orderBy: { converted_at: "desc" },
    select: { seeker_profile_id: true },
  });
  if (lead?.seeker_profile_id) {
    const seeker = await prisma.profile.findUnique({ where: { id: lead.seeker_profile_id } });
    if (seeker) return { profile: seeker, source: "lead" };
  }

  const email = String(invitation?.email || "").trim().toLowerCase();
  if (!email) return { profile: null, source: "none" };

  const byEmail = await prisma.profile.findUnique({ where: { email } });
  if (!byEmail) return { profile: null, source: "none" };

  if (canAdoptByContact(byEmail, invitation?.phone ?? null)) {
    return { profile: byEmail, source: "contact" };
  }

  // Someone else owns this address. Say so rather than guessing in either
  // direction — adopting would be dangerous, and creating would hit the unique
  // constraint as an opaque 500.
  return { profile: null, source: "none", conflict: { email } };
}
