import { prisma } from "@/lib/db";
import { groupIntoItems, istDayBounds, type GatewayTxn } from "./settlement-computation";
import {
  canStart, canMarkPaid, canMarkFailed, validatePayout,
} from "./settlement-transitions";
import { expectedPayoutDate } from "./payout-promise";

/** Tagged-template raw SQL — Prisma parameterises every interpolated value. */
const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> =>
  (prisma as any).$queryRaw(strings, ...values);

import {
  notifyPayoutOnItsWay, notifyPayoutPaid, notifyPayoutFailed,
} from "./payout-notifications";

/**
 * Builds and progresses the nightly settlement run.
 *
 * Stayo pools tenant rent in its own Razorpay account and passes it through to
 * owners IN FULL — no commission is ever taken here. Every amount in this
 * service is computed from captured gateway transactions; an admin can record
 * what they transferred, never edit what is owed.
 */
export class SettlementRunService {
  private async log(action: string, detail: Record<string, unknown>, actorId: string | null, ids: { runId?: string; itemId?: string } = {}) {
    // Never fatal: losing an audit line must not roll back a real transfer
    // that already happened in a bank.
    await prisma.settlement_audit_log
      .create({
        data: {
          action,
          detail: detail as any,
          actor_id: actorId,
          run_id: ids.runId ?? null,
          item_id: ids.itemId ?? null,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Create the run for a date, or return the existing one.
   *
   * Idempotent per date by construction (`run_date` is unique), so pressing
   * "create tonight's run" twice cannot split one day across two runs.
   *
   * Only transactions not already attached to ANY run are eligible — the
   * unique index on `settlement_item_transactions.transaction_id` enforces
   * that at the database level, and this query avoids relying on the error.
   */
  async createOrGetRun(isoDate: string, actorId: string | null) {
    const existing = await prisma.settlement_runs.findUnique({
      where: { run_date: new Date(`${isoDate}T00:00:00.000Z`) },
    });
    if (existing) return this.getRun(isoDate);

    const { from, to } = istDayBounds(isoDate);

    const transactions = (await prisma.gateway_transactions.findMany({
      where: {
        purpose: "TENANT_RENT",
        status: "CAPTURED",
        captured_at: { gte: from, lt: to },
        settlement: null, // never settled before
      },
      select: {
        id: true, purpose: true, status: true, amount: true,
        owner_id: true, hostel_id: true, captured_at: true,
      },
    })) as unknown as GatewayTxn[];

    const drafts = groupIntoItems(transactions);
    const gross = drafts.reduce((sum, d) => sum + d.amount, 0);
    // Every transaction in a run was captured on the same IST day, so one
    // promise covers the whole run. Midday avoids any midnight-boundary
    // ambiguity when the date string is read back as an instant.
    const promisedDate = expectedPayoutDate(`${isoDate}T12:00:00.000Z`);

    const run = await prisma.$transaction(async (tx: any) => {
      const created = await tx.settlement_runs.create({
        data: {
          run_date: new Date(`${isoDate}T00:00:00.000Z`),
          status: drafts.length > 0 ? "IN_PROGRESS" : "COMPLETED",
          gross_collected: gross,
          owner_count: drafts.length,
          created_by: actorId,
          // A day with nothing captured is a completed run with no work, not
          // an error — before the gateway is live this is every night.
          completed_at: drafts.length === 0 ? new Date() : null,
        },
      });

      for (const draft of drafts) {
        const item = await tx.settlement_items.create({
          data: {
            run_id: created.id,
            owner_id: draft.ownerId,
            amount: draft.amount,
            payment_count: draft.paymentCount,
            status: "PENDING",
          },
        });
        await tx.settlement_item_transactions.createMany({
          data: draft.transactionIds.map((transactionId) => ({
            item_id: item.id,
            transaction_id: transactionId,
            amount: 0,
          })),
        });

        // The promise the owner is shown, fixed at the moment it is made.
        //
        // Raw SQL because `expected_payout_date` is deliberately absent from
        // schema.prisma (migration 075 explains why), and inside a savepoint so
        // a run created before that migration is applied still creates — it
        // simply carries no promise, which the owner-facing counter treats as
        // "no promise was made" rather than a broken one.
        await (tx as any).$executeRaw`SAVEPOINT stayo_payout_promise`;
        try {
          await (tx as any).$executeRaw`
            UPDATE settlement_items
            SET expected_payout_date = ${promisedDate}::date
            WHERE id = ${item.id}::uuid`;
          await (tx as any).$executeRaw`RELEASE SAVEPOINT stayo_payout_promise`;
        } catch {
          await (tx as any).$executeRaw`ROLLBACK TO SAVEPOINT stayo_payout_promise`.catch(() => undefined);
          await (tx as any).$executeRaw`RELEASE SAVEPOINT stayo_payout_promise`.catch(() => undefined);
        }
      }

      return created;
    });

    await this.log("RUN_CREATED", { date: isoDate, owners: drafts.length, gross }, actorId, { runId: run.id });
    return this.getRun(isoDate);
  }

  /** The run as the console renders it: totals plus per-owner items. */
  async getRun(isoDate: string) {
    const run = await prisma.settlement_runs.findUnique({
      where: { run_date: new Date(`${isoDate}T00:00:00.000Z`) },
      include: { items: { orderBy: { amount: "desc" } } },
    });
    if (!run) return null;

    const ownerIds = run.items.map((i: any) => i.owner_id);
    const owners = ownerIds.length
      ? await prisma.profile.findMany({
          where: { id: { in: ownerIds } },
          select: {
            id: true, name: true,
            payout_holder_name: true, payout_account_no: true,
            payout_ifsc: true, payout_bank_name: true,
          },
        })
      : [];
    const ownerById = new Map<string, any>(owners.map((o: any) => [o.id, o]));

    const items = run.items.map((item: any) => {
      const owner = ownerById.get(item.owner_id);
      return {
        ...item,
        amount: Number(item.amount),
        owner_name: owner?.name ?? "Unknown owner",
        // Surfaced so the drawer can warn before an admin tries to pay someone
        // with no account on file, rather than after.
        payout: owner?.payout_account_no
          ? {
              holder: owner.payout_holder_name,
              account: owner.payout_account_no,
              ifsc: owner.payout_ifsc,
              bank: owner.payout_bank_name,
            }
          : null,
      };
    });

    const byStatus = (status: string) => items.filter((i: any) => i.status === status);
    const sum = (rows: any[]) => rows.reduce((t, r) => t + r.amount, 0);

    return {
      run: {
        id: run.id,
        date: isoDate,
        status: run.status,
        gross_collected: Number(run.gross_collected),
        owner_count: run.owner_count,
      },
      lanes: {
        pending: byStatus("PENDING"),
        processing: byStatus("PROCESSING"),
        paid: byStatus("PAID"),
        failed: byStatus("FAILED"),
      },
      totals: {
        to_settle: sum(byStatus("PENDING")) + sum(byStatus("PROCESSING")),
        settled: sum(byStatus("PAID")),
        pending_count: byStatus("PENDING").length,
        done_count: byStatus("PAID").length,
        total_count: items.length,
      },
      items,
    };
  }

  async startItem(itemId: string, actorId: string) {
    const item = await prisma.settlement_items.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("NOT_FOUND: Payout not found");

    const guard = canStart(item as any);
    if (!guard.ok) throw new Error(`INVALID_TRANSITION: ${guard.reason}`);

    const updated = await prisma.settlement_items.update({
      where: { id: itemId },
      data: { status: "PROCESSING", updated_at: new Date() },
    });
    await this.log("ITEM_STARTED", { amount: Number(item.amount) }, actorId, { runId: item.run_id, itemId });
    await notifyPayoutOnItsWay({
      ownerId: item.owner_id,
      amount: Number(item.amount),
      expectedPayoutDate: await this.promisedDateFor(itemId),
    });
    return updated;
  }

  /**
   * Record a transfer that has already happened in a bank.
   *
   * The amount is never taken from the caller — it is what was computed from
   * captured transactions. An admin records how they sent it, not how much.
   */
  async markPaid(itemId: string, actorId: string, input: { method?: string; reference?: string }) {
    const item = await prisma.settlement_items.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("NOT_FOUND: Payout not found");

    const guard = canMarkPaid(item as any);
    if (!guard.ok) throw new Error(`INVALID_TRANSITION: ${guard.reason}`);

    const payout = validatePayout(input);
    if (!payout.ok) throw new Error(`VALIDATION: ${payout.reason}`);

    const updated = await prisma.settlement_items.update({
      where: { id: itemId },
      data: {
        status: "PAID",
        method: payout.method,
        reference: payout.reference,
        paid_at: new Date(),
        paid_by: actorId,
        failure_reason: null,
        updated_at: new Date(),
      },
    });

    await this.log(
      "ITEM_PAID",
      { amount: Number(item.amount), method: payout.method, reference: payout.reference },
      actorId,
      { runId: item.run_id, itemId },
    );

    await notifyPayoutPaid({
      ownerId: item.owner_id,
      amount: Number(item.amount),
      method: payout.method ?? null,
      reference: payout.reference ?? null,
    });

    await this.completeRunIfDone(item.run_id);
    return updated;
  }

  /**
   * The promise recorded for one item, or null if it predates migration 075.
   *
   * Raw SQL and null-on-error for the same reason the column is absent from
   * schema.prisma: reading it must never be able to break a payout transition.
   */
  private async promisedDateFor(itemId: string): Promise<string | null> {
    try {
      const rows = await sql`
        SELECT expected_payout_date FROM settlement_items WHERE id = ${itemId}::uuid`;
      const value = rows?.[0]?.expected_payout_date;
      return value ? new Date(value).toISOString().slice(0, 10) : null;
    } catch {
      return null;
    }
  }

  async markFailed(itemId: string, actorId: string, reason: string) {
    const item = await prisma.settlement_items.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("NOT_FOUND: Payout not found");

    const guard = canMarkFailed(item as any);
    if (!guard.ok) throw new Error(`INVALID_TRANSITION: ${guard.reason}`);
    if (!reason?.trim()) throw new Error("VALIDATION: Say why the transfer failed");

    const updated = await prisma.settlement_items.update({
      where: { id: itemId },
      data: { status: "FAILED", failure_reason: reason.trim(), updated_at: new Date() },
    });
    await this.log("ITEM_FAILED", { reason: reason.trim() }, actorId, { runId: item.run_id, itemId });
    // Told, not hidden. The owner's first fear on a failed transfer is that the
    // money has gone somewhere — saying so before he notices the absence is the
    // difference between a problem and a betrayal.
    await notifyPayoutFailed({
      ownerId: item.owner_id,
      amount: Number(item.amount),
      reason: reason.trim(),
    });
    return updated;
  }

  /** A run completes when nothing is left outstanding. */
  private async completeRunIfDone(runId: string) {
    const outstanding = await prisma.settlement_items.count({
      where: { run_id: runId, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (outstanding > 0) return;
    await prisma.settlement_runs.update({
      where: { id: runId },
      data: { status: "COMPLETED", completed_at: new Date() },
    });
  }
}

export const settlementRunService = new SettlementRunService();
