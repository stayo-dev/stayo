/**
 * The human role label that goes into `stayo_admin_invitation`'s {{2}}.
 *
 * Exists because that parameter is read by a person: the approved copy is
 * "you have been added to the Stayo admin console as {{2}} by {{3}}", so a
 * raw enum would produce "...as VERIFICATION by Shiva."
 *
 * A manager has permissions, not a title — `manager_permission_grants` is a
 * set, and no single grant names the job. So the label describes the role
 * they were invited into, not what they may do.
 *
 * PURE MODULE — no I/O and no Prisma import, so it runs under
 * vitest.pure.config.ts.
 */

export const INVITABLE_ROLES = ["MANAGER", "ADMIN"] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const LABELS: Record<InvitableRole, string> = {
  MANAGER: "Manager",
  ADMIN: "Admin",
};

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === "string" && (INVITABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Falls back to a neutral phrase rather than echoing an unrecognised value
 * into a WhatsApp template, where the recipient sees it and it cannot be
 * taken back.
 */
export function inviteRoleLabel(role: unknown): string {
  return isInvitableRole(role) ? LABELS[role] : "a team member";
}
