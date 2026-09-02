import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { getLogger } from "@/lib/logger";
import { closeUnacceptedTenancy } from "./unaccepted-tenancy-closure";
import { allocationReconciliationService } from "@/lib/services/allocation-reconciliation-service";
import { eventSystem } from "@/lib/events";

const logger = getLogger("tenants.unaccepted-tenancy-expiry");

/**
 * Days past the invitation's own `expires_at` before a live-but-unaccepted
 * tenancy is closed. The invitee already got the day-before-expiry WhatsApp
 * reminder (`invitation-expiry-reminder-service`); this is the grace on top of
 * that. Env-tunable.
 */
export const GRACE_DAYS = Number(process.env.UNACCEPTED_TENANCY_GRACE_DAYS || 7);

export const AUTO_EXPIRED_EVENT = "tenant_invitation_auto_expired";

/**
 * Closes tenancies that went operationally live at invite time
 * (`status = ACTIVE`, `acceptance_status = PENDING`) but whose tenant never
 * personally accepted and whose activation link expired more than `GRACE_DAYS`
 * ago. Frees the room, voids future obligations, keeps past dues + payments for
 * settlement — see `closeUnacceptedTenancy`. See ADR-165.
 */
export class UnacceptedTenancyExpiryService {
  async findDue(now: Date, graceDays = GRACE_DAYS) {
    const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);

    const tenants = await prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        acceptance_status: "PENDING",
        tenant_invitations: {
          some: {
            // Not ACTIVATION_STARTED — the tenant is mid-flow; nudge, don't kill.
            status: { in: ["PENDING", "OPENED", "EXPIRED"] },
            expires_at: { lt: cutoff },
          },
        },
        // ...and no invitation that is still live / in progress.
        NOT: {
          tenant_invitations: {
            some: { status: { in: ["ACTIVATION_STARTED"] } },
          },
        },
      },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        display_name: true,
        phone_1: true,
        personal_email: true,
        hostels: { select: { name: true } },
        tenant_invitations: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { id: true, expires_at: true, status: true },
        },
      },
    });

    // Guard against the `some` matching an old expired invitation while a newer
    // one is still within grace (a resend gives a fresh 7 days).
    return tenants.filter((t: any) => {
      const latest = t.tenant_invitations[0];
      return latest && new Date(latest.expires_at) < cutoff;
    });
  }

  async expireOne(tenant: any, now: Date): Promise<{ ok: boolean; reason?: string }> {
    try {
      let waived = 0;
      await prisma.$transaction(async (tx: any) => {
        const result = await closeUnacceptedTenancy(tx, {
          tenantId: tenant.id,
          actorId: tenant.owner_id,
          terminalStatus: "EXPIRED",
          invitationStatus: "EXPIRED",
          reason:
            "Invitation expired — tenant never accepted; room freed, future obligations voided, past dues kept for settlement",
        });
        waived = result.waivedObligationIds.length;
      });

      await allocationReconciliationService.reconcileTenant(tenant.id).catch((err: any) => {
        logger.error("reconcile_after_auto_expire_failed", {
          tenant_id: tenant.id,
          error: String(err?.message || err),
        });
      });

      await eventLog.log(AUTO_EXPIRED_EVENT, tenant.owner_id || null, {
        tenant_id: tenant.id,
        hostel_id: tenant.hostel_id,
        waived_future_obligations: waived,
      }, tenant.id);

      await eventSystem.trigger("tenant_status_changed", {
        owner_id: tenant.owner_id,
        tenant_id: tenant.id,
        status: "EXPIRED",
      });

      // Best-effort: tell the owner their room is free again.
      await this.notifyOwner(tenant).catch((err: any) =>
        logger.warn("auto_expire_owner_notify_failed", {
          tenant_id: tenant.id,
          error: String(err?.message || err),
        }),
      );

      return { ok: true };
    } catch (error: any) {
      logger.error("unaccepted_tenancy_expire_failed", {
        tenant_id: tenant.id,
        error: String(error?.message || error),
      });
      return { ok: false, reason: error?.message || "expire failed" };
    }
  }

  private async notifyOwner(tenant: any) {
    const owner = await prisma.profile.findUnique({
      where: { id: tenant.owner_id },
      select: { phone: true, email: true, name: true },
    });
    if (!owner) return;

    const who = tenant.display_name || "A tenant you invited";
    const hostelName = tenant.hostels?.name || "your hostel";
    const message =
      `${who}'s invitation to ${hostelName} expired — they never accepted it. ` +
      `Their room is free again. Any payments already recorded and past dues are ` +
      `kept on the books for settlement.`;

    if (owner.phone) {
      try {
        const { MetaWhatsAppProvider } = await import(
          "@/lib/services/notifications/providers/whatsapp/meta-provider"
        );
        await new MetaWhatsAppProvider().sendTextMessage(owner.phone, message);
        return;
      } catch {
        // fall through to email
      }
    }
    if (owner.email) {
      const { EmailService } = await import("@/lib/services/email-service");
      await EmailService.sendEmail(
        owner.email,
        "An invitation expired — room freed",
        `<p>${message}</p>`,
      );
    }
  }

  async run(now: Date, graceDays = GRACE_DAYS) {
    const due = await this.findDue(now, graceDays);
    let expired = 0;
    let failed = 0;
    for (const tenant of due) {
      const result = await this.expireOne(tenant, now);
      if (result.ok) expired += 1;
      else failed += 1;
    }
    return { considered: due.length, expired, failed };
  }
}

export const unacceptedTenancyExpiryService = new UnacceptedTenancyExpiryService();
