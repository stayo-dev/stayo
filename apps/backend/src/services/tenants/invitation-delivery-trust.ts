import { prisma } from "@/lib/db";

/**
 * Whether the invitation link actually reached the phone it names.
 *
 * An invitation is delivered over WhatsApp to `tenant_invitations.phone`, with
 * email used only as a fallback when that send fails
 * (`dispatchInvitationNotification`). So a *successful* WhatsApp delivery is
 * itself proof of control of that number — the token is 32 random bytes and it
 * was handed to that handset and nowhere else. That is why activation does not
 * ask an invitee to re-verify by OTP a number we just messaged them on.
 *
 * The column records **only success**, and everything else — a failed send, the
 * email fallback, an invitation created before the column existed — reads back
 * as "unknown". Activation treats unknown as untrusted, so every uncertain path
 * falls into the safe default of asking for an OTP without needing a branch of
 * its own. That is deliberate: the fallback is rare, and a rare path with no
 * special-case code is a rare path that cannot rot.
 *
 * ## Why raw SQL rather than a Prisma field
 *
 * Declaring a scalar on `tenant_invitations` makes Prisma request it on every
 * read of that table that passes no explicit `select` — about 52 of them here.
 * If the migration has not been applied yet, all 52 start failing at once; that
 * is precisely the 2026-08-22 production outage. Raw SQL both ways keeps this
 * column optional at runtime, so the same codebase runs against a database that
 * has the migration and one that does not.
 */

/** Migration 20260825090000. Absent until it is applied — see the note above. */
const COLUMN = "whatsapp_delivered_at";

/**
 * When the link was delivered over WhatsApp, or null when it was not, could not
 * be, or the column does not exist yet. Never throws: an unreadable answer is
 * reported as "we cannot vouch for it", which is also what an absent column
 * means.
 */
export async function readWhatsAppDeliveredAt(invitationId: string): Promise<Date | null> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT "${COLUMN}" FROM "tenant_invitations" WHERE "id" = $1::uuid LIMIT 1`,
      invitationId,
    )) as Array<{ whatsapp_delivered_at: Date | null }> | null;
    return rows?.[0]?.whatsapp_delivered_at ?? null;
  } catch {
    // Column not yet migrated, or the read failed. Either way we have no proof.
    return null;
  }
}

/**
 * Record the outcome of an invitation send.
 *
 * `delivered: false` explicitly **clears** any previous timestamp rather than
 * leaving it. A resend can change the phone number (`resendInvitation` accepts
 * overrides), and a stale timestamp from the previous number would otherwise
 * vouch for a number nothing was ever sent to.
 */
export async function recordWhatsAppDelivery(invitationId: string, delivered: boolean): Promise<void> {
  try {
    if (delivered) {
      await prisma.$executeRawUnsafe(
        `UPDATE "tenant_invitations" SET "${COLUMN}" = NOW() WHERE "id" = $1::uuid`,
        invitationId,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "tenant_invitations" SET "${COLUMN}" = NULL WHERE "id" = $1::uuid`,
        invitationId,
      );
    }
  } catch {
    // Not fatal. Failing to record delivery costs the invitee an OTP; failing
    // the invitation itself would cost them the tenancy.
  }
}
