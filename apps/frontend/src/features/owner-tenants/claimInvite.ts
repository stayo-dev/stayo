import { sanitizeIndianPhone } from './invite/validation';

/**
 * Getting an owner-managed tenant onto the app.
 *
 * An owner who has been keeping someone's records themselves had no way to
 * hand that account over. The only affordance on screen was **+ Invite**,
 * which means *create a new tenancy* and is correctly refused with
 * `TENANT_HAS_ACTIVE_TENANCY` — the person already has one. So the owner hit a
 * dead end doing exactly the right thing, and the claim flow that exists to
 * solve this was unreachable because nothing ever pointed at it.
 *
 * The link is plain `/claim` and carries no token on purpose: the claim flow
 * proves possession with an OTP to the tenant's own number
 * ([[Decisions#ADR-134]]), so a link that leaked would still get a stranger
 * nowhere. That is what makes it safe to send over WhatsApp, paste into a
 * group, or read out over the phone.
 *
 * See ADR-150.
 */

/** The claim flow's entry point. No token — possession is proved by OTP. */
export function claimLink(origin: string): string {
  return `${String(origin ?? '').replace(/\/+$/, '')}/claim`;
}

export interface ClaimInviteMessageInput {
  tenantName: string;
  hostelName: string;
  link: string;
}

/**
 * The message the owner sends.
 *
 * Written to be read by someone who has never heard of Stayo and is being
 * asked to tap a link about their own money: it says who it is from, what
 * they will see, and that nothing changes if they ignore it. It does not say
 * "claim your tenancy" — that is our word for it, not theirs.
 */
export function claimInviteMessage({ tenantName, hostelName, link }: ClaimInviteMessageInput): string {
  const first = String(tenantName ?? '').trim().split(/\s+/)[0];
  const hostel = String(hostelName ?? '').trim() || 'the hostel';
  // No name on file means no name in the greeting — "Hi Hi," is worse than
  // simply not using one.
  const greeting = first ? `Hi ${first}, this is ${hostel}.` : `Hi, this is ${hostel}.`;

  return [
    greeting,
    '',
    `We keep your rent and payment records on Stayo. You can see them yourself — what's paid, what's due, and your receipts — and pay from your phone.`,
    '',
    `Open this and enter your number: ${link}`,
    '',
    `Nothing changes if you'd rather not. Your records stay exactly as they are.`,
  ].join('\n');
}

/**
 * Opens WhatsApp on a chat with **this tenant**, message pre-filled.
 *
 * `wa.me/<number>` rather than a bare share sheet: the owner should not have
 * to find the person in their contacts when the app already knows the number
 * it is about. Returns null when the number is unusable, so a dead button is
 * never drawn.
 */
export function claimWhatsappUrl(phone: string, message: string): string | null {
  const digits = sanitizeIndianPhone(phone);
  if (digits.length !== 10) return null;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
}
