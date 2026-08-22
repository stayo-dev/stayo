import { logger } from "@/lib/logger";

/**
 * Writing the FINANCIAL record of money Stayo actually received.
 *
 * `payments` is the operational record — it says an owner marked rent paid.
 * This table says Razorpay put money in Stayo's account. Settlement reads only
 * this one, because an owner-marked "UPI" payment went to the owner's own UPI
 * ID and Stayo owes nothing against it (see migration 070).
 *
 * Until this module existed, NOTHING wrote `gateway_transactions`. The whole
 * settlement pipeline had no source and every run was correctly empty.
 *
 * Raw SQL rather than the Prisma client, deliberately:
 *   - `tenant_id` (migration 075) is intentionally absent from schema.prisma —
 *     declaring a scalar makes every unselected read of the table demand the
 *     column, which is what broke hostel listings on 2026-08-22.
 *   - `ON CONFLICT DO NOTHING` on a unique column is the idempotency, and
 *     Prisma has no first-class expression for it here.
 */

/**
 * Only the tagged-template form is used, so every value in these statements is
 * parameterised by Prisma and none is ever concatenated into SQL.
 */
type Tx = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
};

export type CapturedRentInput = {
  /** Razorpay's payment id. The idempotency key — see below. */
  providerPaymentId: string | null | undefined;
  /** Rupees. See the note on amount provenance. */
  amount: number;
  ownerId: string;
  hostelId: string | null;
  tenantId: string | null;
  capturedAt?: Date;
  /** The provider payload, kept verbatim as evidence. */
  raw?: unknown;
  provider?: string;
};

/**
 * Pull the provider's own amount out of a webhook/verify payload, in paise.
 *
 * NOT used as the stored amount — see `recordCapturedRentInTx`. It is kept
 * alongside the payload so a later reconciliation is a query rather than a
 * re-parse of every raw blob.
 */
export function providerAmountPaise(raw: unknown): number | null {
  const r = raw as any;
  const candidates = [
    r?.payload?.payment?.entity?.amount,
    r?.payment?.entity?.amount,
    r?.entity?.amount,
    r?.amount_paid,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Record one captured tenant rent payment, inside the caller's transaction.
 *
 * MUST be called in the same transaction that settles the payment. If the
 * settlement rolls back, this row must roll back with it — a gateway row whose
 * payment never settled would make Stayo owe an owner money against a payment
 * that, internally, never happened.
 *
 * **Amount provenance.** The stored amount is the attempt amount in RUPEES,
 * which is the amount the Razorpay order was created for and therefore the
 * amount charged. The provider reports paise; taking its number directly is a
 * 100x error waiting to happen in a table that decides real bank transfers, and
 * there are currently zero captured payments in any environment to verify the
 * payload shape against. The provider's figure is preserved under
 * `raw.__provider_amount_paise` so the two can be reconciled once real captures
 * exist. If they ever disagree, the gateway is right and this needs revisiting.
 *
 * **No provider payment id means no row.** Without it there is no idempotency
 * key, and a replayed webhook would create a second settleable row for the same
 * money — Stayo would pay an owner twice. Skipping errs toward under-settling,
 * which an admin can see and correct; double-paying is unrecoverable.
 */
export async function recordCapturedRentInTx(
  tx: Tx,
  input: CapturedRentInput,
): Promise<"recorded" | "duplicate" | "skipped"> {
  const providerPaymentId = (input.providerPaymentId ?? "").trim();
  const amount = Number(input.amount);

  if (!providerPaymentId) {
    logger.error("settlement.gateway_ledger.missing_provider_id", {
      owner_id: input.ownerId,
      tenant_id: input.tenantId,
      amount,
      reason: "no idempotency key — refusing to write an unsettleable duplicate risk",
    });
    return "skipped";
  }

  if (!input.ownerId || !Number.isFinite(amount) || amount <= 0) {
    logger.error("settlement.gateway_ledger.unattributable", {
      provider_payment_id: providerPaymentId,
      owner_id: input.ownerId,
      amount,
    });
    return "skipped";
  }

  const raw = {
    ...(input.raw && typeof input.raw === "object" ? (input.raw as object) : { payload: input.raw ?? null }),
    __provider_amount_paise: providerAmountPaise(input.raw),
    __recorded_amount_rupees: amount,
  };

  // A failed statement aborts the WHOLE Postgres transaction, so a plain
  // try/catch around this insert would be a lie: catching the error would not
  // give the caller a usable transaction back, and the payment settlement
  // wrapped around it would roll back anyway.
  //
  // The concrete way that happens is a deploy that lands before migration 075:
  // `tenant_id` would not exist, every INSERT would fail, and every gateway
  // payment in production would fail with it. That is the 2026-08-22 outage
  // wearing a different hat.
  //
  // A savepoint is the actual Postgres mechanism for "try this, and if it
  // fails leave the surrounding transaction untouched". It makes recording the
  // settlement record genuinely optional relative to taking the money, which is
  // the correct priority: a missing gateway row makes Stayo under-settle, and
  // an admin can see and fix that. A rolled-back capture leaves a tenant
  // charged with no record anywhere.
  // The savepoint name is a fixed literal in the template, never interpolated:
  // an identifier cannot be parameterised, so the only safe form is a constant.
  await tx.$executeRaw`SAVEPOINT stayo_gateway_ledger`;
  try {
    const written = await tx.$executeRaw`
      INSERT INTO gateway_transactions
        (provider, provider_payment_id, purpose, amount, status, captured_at,
         hostel_id, owner_id, tenant_id, raw)
      VALUES (${input.provider ?? "razorpay"}, ${providerPaymentId},
              'TENANT_RENT'::"GatewayPurpose", ${amount}, 'CAPTURED',
              ${input.capturedAt ?? new Date()},
              ${input.hostelId}::uuid, ${input.ownerId}::uuid, ${input.tenantId}::uuid,
              ${JSON.stringify(raw)}::jsonb)
      ON CONFLICT (provider_payment_id) DO NOTHING`;
    await tx.$executeRaw`RELEASE SAVEPOINT stayo_gateway_ledger`;

    // 0 rows means the unique index caught a replay. That is the mechanism
    // working, not a failure, and it must not be retried or logged as an error.
    return written > 0 ? "recorded" : "duplicate";
  } catch (error: any) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT stayo_gateway_ledger`.catch(() => undefined);
    await tx.$executeRaw`RELEASE SAVEPOINT stayo_gateway_ledger`.catch(() => undefined);
    logger.error("settlement.gateway_ledger.insert_failed", {
      provider_payment_id: providerPaymentId,
      owner_id: input.ownerId,
      amount,
      error: String(error?.message || error),
      impact: "payment settled but is not settleable to the owner until reconciled",
    });
    return "skipped";
  }
}
