/**
 * Contract for `stayo_tenant_invitation_expiry_reminder`.
 *
 * An invitation lasts seven days (`DEFAULT_INVITE_DAYS`) and, until this, went
 * quiet the moment it was sent. A tenant who put it off discovered the deadline
 * by clicking a dead link, and the only route forward was asking the owner to
 * resend — a loss for both sides that one message prevents.
 *
 * The approved template:
 *
 *   Header: Invitation Expiring Soon
 *   Body:   Hello {{1}}, your invitation to join {{2}} on Stayo expires in
 *           {{3}} hours. Activate your account before it closes to secure your
 *           assigned room.
 *   Footer: Stayo Property Management
 *   Button: [Activate Now →]  https://yourstayo.com/activate/{{1}}   (dynamic)
 *
 * The button takes the **token alone**, not the whole link — Meta stores the
 * `/activate/` base and appends what we send, exactly as the invitation
 * template already works. Sending a full URL there produces a doubled path.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export const INVITATION_EXPIRY_REMINDER_TEMPLATE = {
  envVar: "WHATSAPP_INVITATION_EXPIRY_REMINDER_TEMPLATE",
  languageEnvVar: "WHATSAPP_INVITATION_EXPIRY_REMINDER_LANGUAGE",
  defaultName: "stayo_tenant_invitation_expiry_reminder",
  defaultLanguage: "en",
  /** BODY {{1}}, {{2}}, {{3}} in order. */
  bodyParameters: ["tenant_name", "hostel_name", "hours_remaining"] as const,
  /** One dynamic URL button carrying the activation token. */
  buttonParameters: ["activation_token"] as const,
};

export function invitationExpiryReminderTemplateName(): string {
  return process.env[INVITATION_EXPIRY_REMINDER_TEMPLATE.envVar] || INVITATION_EXPIRY_REMINDER_TEMPLATE.defaultName;
}

export function invitationExpiryReminderLanguage(): string {
  return (
    process.env[INVITATION_EXPIRY_REMINDER_TEMPLATE.languageEnvVar] ||
    INVITATION_EXPIRY_REMINDER_TEMPLATE.defaultLanguage
  );
}

/** The token, from either a full activation link or a bare token. */
export function activationTokenFrom(linkOrToken: string): string {
  const raw = String(linkOrToken || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0];
  const last = withoutQuery.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : raw;
}

/**
 * Whole hours remaining, floored, never below 1.
 *
 * Floored because "expires in 23 hours" when 23h59m remain is a promise we can
 * keep, while rounding up to 24 is one we cannot. Never zero, because "expires
 * in 0 hours" on a link that still works reads as already dead — the reminder
 * exists to get someone moving, not to tell them they are too late.
 */
export function hoursRemaining(expiresAt: Date, now: Date): number {
  const ms = expiresAt.getTime() - now.getTime();
  return Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
}

export type InvitationExpiryReminderInput = {
  tenantName: string;
  hostelName: string;
  activationLink: string;
  expiresAt: Date;
  now: Date;
};

export function buildInvitationExpiryReminderPayload(input: InvitationExpiryReminderInput) {
  const tenantName = String(input.tenantName || "").trim() || "there";
  const hostelName = String(input.hostelName || "").trim() || "your hostel";

  return {
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: tenantName },
          { type: "text", text: hostelName },
          { type: "text", text: String(hoursRemaining(input.expiresAt, input.now)) },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: activationTokenFrom(input.activationLink) }],
      },
    ],
  };
}
