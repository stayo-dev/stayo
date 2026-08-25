/**
 * Whether a tenancy has finished the ACCOUNT step of activation.
 *
 * ## Why this is its own function
 *
 * It was three lines inside `computeState`, and it broke in production on
 * 2026-08-25 in a way no unit test could see, because the rule silently changed
 * meaning when something *else* changed.
 *
 * The rule used to read "the profile or the tenancy has a verified number".
 * That worked only because, before [[ADR-110]], `profile` was **null** for a
 * tenancy nobody had bound yet — so it fell through to `tenant.mobile_verified`,
 * which only `saveAccount` ever sets, and was therefore false until the ACCOUNT
 * step genuinely ran.
 *
 * ADR-110 then made activation resolve the invitee's existing account. A Stayo
 * Discover seeker verified their phone at enquiry time, so the resolved profile
 * arrives with `phone_verified: true` already. The same three lines now reported
 * account setup as complete **before it had happened**, and the damage was
 * entirely downstream: the wizard jumped to ACTIVATE, `startActivation` — the
 * only code that writes `tenants.profile_id` — never ran, and `activate()`,
 * which finds the tenancy *through* the profile, found nothing and threw
 * "Activation link expired or already used" at a tenant holding a valid link.
 *
 * So the test that matters is not "is there a verified number" but "is this
 * tenancy actually bound to an account". Matching a profile is a guess until it
 * is written down.
 */
export function isAccountSetupComplete(input: {
  tenant: { profile_id?: string | null; phone_1?: string | null; mobile_verified?: boolean | null } | null;
  profile: { phone?: string | null; mobile_verified?: boolean | null; phone_verified?: boolean | null } | null;
}): boolean {
  const { tenant, profile } = input;
  if (!tenant?.profile_id) return false;

  const verified = Boolean(profile?.mobile_verified || profile?.phone_verified || tenant?.mobile_verified);
  const hasNumber = Boolean(tenant?.phone_1 || profile?.phone);
  return verified && hasNumber;
}
