/**
 * The pure rule, extracted so it can be tested without a database.
 *
 * A number is trusted when the account attached to this tenancy has already
 * verified *that same number*, or when the invitation link was delivered to it
 * over WhatsApp. Both are independent proofs; either is sufficient.
 *
 * The first arm is what covers a Stayo Discover seeker: they OTP-verified their
 * number at enquiry time, long before the owner invited them, so their proof
 * does not depend on how the invitation happened to travel.
 */
/**
 * Compare two Indian numbers by their last 10 digits.
 *
 * Formats are genuinely mixed in the live data: `profiles.phone` holds bare
 * 10-digit numbers (`7013216327`), `tenant_invitations.phone` holds E.164
 * (`+917013216327`), and `normalizeIndianPhone` returns E.164. An `===`
 * comparison across those is false for the *same* number — which would have
 * made every one of these checks fail closed and asked for an OTP anyway,
 * silently defeating the whole change.
 *
 * Last-10 is the right key because every one of these is an Indian mobile and
 * the country code is the only part that varies.
 */
export function samePhone(a: unknown, b: unknown): boolean {
  const left = String(a ?? "").replace(/\D/g, "").slice(-10);
  const right = String(b ?? "").replace(/\D/g, "").slice(-10);
  return left.length === 10 && left === right;
}

export function isPhoneAlreadyProven(input: {
  /** The number being submitted on the Identity screen, normalized. */
  submittedPhone: string;
  /** The linked account, when this tenancy has one. */
  profile: { phone: string | null; phone_verified?: boolean | null; mobile_verified?: boolean | null } | null;
  /** The tenancy row's own copy of the number and its verification flag. */
  tenant: { phone_1: string | null; mobile_verified?: boolean | null } | null;
  /** The number the invitation was addressed to, normalized. */
  invitationPhone: string | null;
  /** When the invitation was delivered over WhatsApp, if it was. */
  whatsappDeliveredAt: Date | null;
}): boolean {
  const { submittedPhone, profile, tenant, invitationPhone, whatsappDeliveredAt } = input;
  if (String(submittedPhone ?? "").replace(/\D/g, "").length < 10) return false;

  const verifiedOnAccount = Boolean(
    (profile?.phone_verified || profile?.mobile_verified || tenant?.mobile_verified) &&
    (samePhone(profile?.phone, submittedPhone) || samePhone(tenant?.phone_1, submittedPhone))
  );
  if (verifiedOnAccount) return true;

  // Delivery only vouches for the number it was actually sent to. Editing the
  // number on the Identity screen therefore drops this proof, which is the
  // intended behaviour: a changed number has to be verified.
  return Boolean(whatsappDeliveredAt && invitationPhone && samePhone(invitationPhone, submittedPhone));
}
