/**
 * Contracts for the platform-staff ("manager") invitation WhatsApp templates.
 *
 * These address Stayo's own team joining the admin console, not owners or
 * tenants — a separate `stayo_admin_*` namespace from the `stayo_owner_*`
 * acquisition funnel and the `stayo_partner_*` marketplace family, because
 * conflating three audiences in one namespace is how the wrong message gets
 * sent to the wrong person.
 *
 * Both approved in the Stayo WABA on 2026-09-21, both UTILITY.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type AdminInvitationTemplateKey = "INVITATION" | "INVITATION_REMINDER";

export type AdminInvitationTemplateDefinition = {
  envVar: string;
  languageEnvVar: string;
  defaultName: string;
  defaultLanguage: string;
  bodyParameters: readonly string[];
  buttonParameters: readonly string[];
};

export type TemplatePayload = {
  bodyParameters: string[];
  buttonParameters: string[];
};

export const ADMIN_INVITATION_TEMPLATES: Record<
  AdminInvitationTemplateKey,
  AdminInvitationTemplateDefinition
> = {
  INVITATION: {
    envVar: "WHATSAPP_ADMIN_INVITATION_TEMPLATE",
    languageEnvVar: "WHATSAPP_ADMIN_INVITATION_LANGUAGE",
    defaultName: "stayo_admin_invitation",
    defaultLanguage: "en",
    bodyParameters: ["admin_name", "title_label", "inviter_name", "expiry_days"],
    buttonParameters: ["activation_token"],
  },
  INVITATION_REMINDER: {
    envVar: "WHATSAPP_ADMIN_INVITATION_REMINDER_TEMPLATE",
    languageEnvVar: "WHATSAPP_ADMIN_INVITATION_REMINDER_LANGUAGE",
    defaultName: "stayo_admin_invitation_reminder",
    defaultLanguage: "en",
    bodyParameters: ["admin_name", "expiry_human"],
    buttonParameters: ["activation_token"],
  },
};

export function adminInvitationTemplateName(key: AdminInvitationTemplateKey): string {
  const definition = ADMIN_INVITATION_TEMPLATES[key];
  return String(process.env[definition.envVar] || "").trim() || definition.defaultName;
}

export function adminInvitationTemplateLanguage(key: AdminInvitationTemplateKey): string {
  const definition = ADMIN_INVITATION_TEMPLATES[key];
  return String(process.env[definition.languageEnvVar] || "").trim() || definition.defaultLanguage;
}

/** Meta rejects parameters with newlines, tabs or 4+ consecutive spaces (error 132000). */
function sanitizeParameter(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeName(value: unknown): string {
  return sanitizeParameter(value) || "there";
}

function requireToken(value: unknown, label: string): string {
  const token = sanitizeParameter(value);
  if (!token) {
    throw new Error(
      `Cannot build WhatsApp payload: ${label} is empty. Meta rejects a send with a blank URL-button parameter.`
    );
  }
  return token;
}

/**
 * The reminder says how long is left in words. Rounds **down**, so the
 * message never promises more time than the token actually has — an invite
 * that expires earlier than it said is the failure worth avoiding.
 *
 * Below an hour it says "less than an hour" rather than a minute count: a
 * reminder that precise invites the reader to leave it until later.
 */
export function humaniseExpiry(hoursRemaining: number): string {
  const hours = Number(hoursRemaining);
  if (!Number.isFinite(hours) || hours <= 0) return "less than an hour";
  if (hours < 1) return "less than an hour";
  if (hours < 24) {
    const whole = Math.floor(hours);
    return whole === 1 ? "1 hour" : `${whole} hours`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

export function buildAdminInvitationPayload(input: {
  adminName: string;
  titleLabel: string;
  inviterName: string;
  expiryDays: number;
  activationToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [
      safeName(input.adminName),
      sanitizeParameter(input.titleLabel) || "a team member",
      safeName(input.inviterName),
      String(Math.max(1, Math.round(Number(input.expiryDays) || 0) || 1)),
    ],
    buttonParameters: [requireToken(input.activationToken, "activation token")],
  };
}

export function buildAdminInvitationReminderPayload(input: {
  adminName: string;
  hoursRemaining: number;
  activationToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [safeName(input.adminName), humaniseExpiry(input.hoursRemaining)],
    buttonParameters: [requireToken(input.activationToken, "activation token")],
  };
}
