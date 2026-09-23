/**
 * May we send this marketplace partner a WhatsApp message?
 *
 * A partner never signed up. The only thing that makes messaging them
 * legitimate is a recorded offline opt-in, so that record is checked on every
 * send rather than assumed at row creation.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type MessagingGuard = { ok: true } | { ok: false; reason: string };

export type ConsentedPartner = {
  phone?: string | null;
  consent_at?: Date | string | null;
  opted_out_at?: Date | string | null;
};

export function canMessagePartner(partner: ConsentedPartner | null | undefined): MessagingGuard {
  if (!partner) return { ok: false, reason: "No partner record." };

  if (!String(partner.phone ?? "").trim()) {
    return { ok: false, reason: "Partner has no phone number." };
  }

  if (!partner.consent_at) {
    return {
      ok: false,
      reason:
        "No recorded consent for this partner. A Stayo-authored listing's contact number is the business's, not a person who agreed to hear from us.",
    };
  }

  /**
   * Opting out stops **every** partner template, not only the MARKETING ones,
   * even though the enquiry notification is the message they would most want.
   * Someone who taps "Stop promotions" and keeps hearing from us reports us,
   * and one report against the WABA costs more than one lead. If they want
   * enquiries again they can say so, and an admin can clear the flag.
   */
  if (partner.opted_out_at) {
    return { ok: false, reason: "Partner opted out of Stayo messages." };
  }

  return { ok: true };
}
