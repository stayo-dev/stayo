import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { frontendUrl } from "@/lib/config/domains";
import { getLogger } from "@/lib/logger";
import { buildInvitationExpiryReminderPayload } from "@/lib/services/notifications/providers/whatsapp/invitation-expiry-reminder-contract";

const logger = getLogger("tenants.invitation-expiry-reminder");

/** Marks a reminder as sent. Also the de-duplication key — see below. */
export const REMINDER_EVENT = "tenant_invitation_expiry_reminder_sent";

/**
 * Reminds a tenant a day before their activation link dies.
 *
 * An invitation lasts seven days and said nothing in between, so the common
 * failure was silent: someone meant to get to it, didn't, and found a dead link
 * with no way forward except asking the owner to resend. Both sides lose, and
 * one message prevents it.
 *
 * ## Who is eligible, and why each clause is there
 *
 * - **`PENDING` or `OPENED` only.** `ACTIVATION_STARTED` is excluded because
 *   `resolveByToken` stops applying the expiry check once activation begins —
 *   those links are not on a clock, so a "expires in 24 hours" message would be
 *   a deadline that does not exist. `ACTIVATED`, `CANCELLED`, `EXPIRED` and
 *   `SUPERSEDED` have nothing to remind anyone about.
 * - **The tenancy is still `INVITED`.** An invitation row can outlive the
 *   reason for it.
 * - **A phone on file**, since this goes out over WhatsApp.
 * - **Expiring inside the window** — between now and now+24h. Already-expired
 *   links are skipped: telling someone their link died yesterday is not a
 *   reminder, it is a notification of failure, and the fix belongs with the
 *   owner.
 *
 * ## De-duplication without a migration
 *
 * The obvious approach is a `reminder_sent_at` column, but migrations here are
 * applied by hand and an unapplied one would silently re-send daily. Instead the
 * send is recorded in `system_event_logs` and the next run checks for it, so the
 * marker ships with the code that writes it. A cron that runs twice in a day, or
 * is replayed, sends once.
 */
export class InvitationExpiryReminderService {
  /** Invitations whose link dies within `withinHours`, that nobody has reminded yet. */
  async findDue(now: Date, withinHours = 24) {
    const horizon = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

    const candidates = await prisma.tenant_invitations.findMany({
      where: {
        status: { in: ["PENDING", "OPENED"] },
        expires_at: { gt: now, lte: horizon },
        phone: { not: null },
        tenant: { status: "INVITED" },
      },
      include: { tenant: { include: { hostels: { select: { name: true } } } } },
      orderBy: { expires_at: "asc" },
    });

    if (candidates.length === 0) return [];

    // One query for the whole batch rather than one per invitation.
    const alreadySent = await (prisma as any).systemEventLog.findMany({
      where: {
        event_type: REMINDER_EVENT,
        tenant_id: { in: candidates.map((row: any) => row.tenant_id) },
      },
      select: { tenant_id: true, metadata: true },
    });

    const remindedInvitationIds = new Set(
      (alreadySent || [])
        .map((row: any) => row?.metadata?.invitation_id)
        .filter(Boolean),
    );

    // Keyed on the invitation, not the tenancy: a resend issues a new
    // invitation with a fresh seven days, and that new link deserves its own
    // reminder.
    return candidates.filter((row: any) => !remindedInvitationIds.has(row.id));
  }

  /**
   * Send one reminder. Returns what happened rather than throwing, so one bad
   * number cannot abort the batch.
   */
  async remind(invitation: any, now: Date): Promise<{ sent: boolean; reason?: string }> {
    const tenant = invitation.tenant;
    const activationLink = frontendUrl(`/activate/${invitation.token}`);

    try {
      const { MetaWhatsAppProvider } = await import(
        "@/lib/services/notifications/providers/whatsapp/meta-provider"
      );
      const provider = new MetaWhatsAppProvider();
      await provider.sendInvitationExpiryReminder({
        to: invitation.phone,
        payload: buildInvitationExpiryReminderPayload({
          tenantName: invitation.name || tenant?.name || "",
          hostelName: tenant?.hostels?.name || "",
          activationLink,
          expiresAt: new Date(invitation.expires_at),
          now,
        }),
      });
    } catch (error: any) {
      logger.warn("invitation_expiry_reminder.send_failed", {
        invitation_id: invitation.id,
        error: error?.message || String(error),
      });
      return { sent: false, reason: error?.message || "send failed" };
    }

    // Written only after a successful send, so a failure is retried tomorrow
    // rather than silently swallowed by its own marker.
    await eventLog.log(
      REMINDER_EVENT,
      invitation.owner_id || null,
      { invitation_id: invitation.id, expires_at: invitation.expires_at },
      invitation.tenant_id,
    );

    return { sent: true };
  }

  async run(now = new Date()) {
    const due = await this.findDue(now);
    let sent = 0;
    let failed = 0;

    for (const invitation of due) {
      const result = await this.remind(invitation, now);
      if (result.sent) sent += 1;
      else failed += 1;
    }

    logger.info("invitation_expiry_reminder.run_complete", { due: due.length, sent, failed });
    return { due: due.length, sent, failed };
  }
}

export const invitationExpiryReminderService = new InvitationExpiryReminderService();
