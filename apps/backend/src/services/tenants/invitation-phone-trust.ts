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
  if (!submittedPhone) return false;

  const verifiedOnAccount = Boolean(
    (profile?.phone_verified || profile?.mobile_verified || tenant?.mobile_verified) &&
    (profile?.phone === submittedPhone || tenant?.phone_1 === submittedPhone)
  );
  if (verifiedOnAccount) return true;

  // Delivery only vouches for the number it was actually sent to. Editing the
  // number on the Identity screen therefore drops this proof, which is the
  // intended behaviour: a changed number has to be verified.
  return Boolean(whatsappDeliveredAt && invitationPhone && invitationPhone === submittedPhone);
}
