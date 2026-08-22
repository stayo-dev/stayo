import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Tagged-template raw SQL — Prisma parameterises every interpolated value. */
const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> =>
  (prisma as any).$queryRaw(strings, ...values);


/**
 * Telling the owner about his money before his bank does.
 *
 * When rent was cash, being paid was an event he witnessed — someone handed him
 * notes and he wrote a line in a book. Online, the money lands in Stayo's
 * account and the event becomes invisible unless he happens to open the app.
 * That is how a system meant to give him more control ends up feeling like
 * less, and it is why these three notifications are part of the feature rather
 * than a polish item:
 *
 *   1. a tenant paid you        — restores the moment of receipt
 *   2. your money is on its way — makes the promise before it is kept
 *   3. it reached your bank     — closes the loop he would otherwise close
 *                                 himself, from a passbook, days later
 *
 * In-app only for now. The WhatsApp equivalents need Meta template approval,
 * which takes weeks and must not gate this.
 *
 * Every function here is fire-and-forget. A notification is worth strictly less
 * than the money movement that triggered it, and must never be able to roll one
 * back or fail a request.
 */

const inr = (amount: number): string => `₹${Math.round(amount).toLocaleString("en-IN")}`;

async function notify(ownerId: string, type: string, title: string, message: string): Promise<void> {
  try {
    await prisma.notifications.create({
      data: { profile_id: ownerId, title, message, type },
    });
  } catch (error: any) {
    logger.error("payout_notifications.failed", {
      owner_id: ownerId,
      type,
      error: String(error?.message || error),
    });
  }
}

/**
 * Resolve a tenant's display name without widening any caller's query.
 *
 * The payment path loads its attempt with `include: { payments: true }` and
 * nothing else. Adding a tenant/profile include there to get a name would
 * change what every finalize loads on the hottest path in the system, for a
 * notification — the wrong trade. One small lookup here, off the critical path
 * and already fire-and-forget, costs nothing that matters.
 */
async function tenantName(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const rows = await sql`
      SELECT pr.name FROM tenants t
      JOIN profiles pr ON pr.id = t.profile_id
      WHERE t.id = ${tenantId}::uuid`;
    return rows?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

/** A tenant paid online. The owner's replacement for being handed cash. */
export async function notifyTenantPaid(params: {
  ownerId: string;
  tenantId: string | null;
  amount: number;
}): Promise<void> {
  const who = (await tenantName(params.tenantId))?.trim() || "A tenant";
  await notify(
    params.ownerId,
    "payout_collected",
    `${who} paid ${inr(params.amount)}`,
    // The date is not known at this point — the run that will carry it has not
    // been created yet — so this deliberately does not promise one. A vague
    // "soon" would be the first unkept promise in a feature built on keeping them.
    `Paid online, so it comes to you through Stayo. You'll see the date it reaches your bank once it's on its way.`,
  );
}

/** The payout has been started. This is where the committed date is stated. */
export async function notifyPayoutOnItsWay(params: {
  ownerId: string;
  amount: number;
  expectedPayoutDate: string | null;
}): Promise<void> {
  // Same wording as the strip on the Money screen — "Thu 27 Aug", no comma.
  // A notification and the screen it links to disagreeing about the date's
  // shape is a small thing that makes both look less careful.
  const when = params.expectedPayoutDate
    ? new Date(`${params.expectedPayoutDate}T00:00:00.000Z`)
        .toLocaleDateString("en-IN", {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })
        .replace(",", "")
    : null;
  await notify(
    params.ownerId,
    "payout_sent",
    `${inr(params.amount)} is on its way to you`,
    when
      ? `It should reach your bank by ${when}. Stayo takes nothing from it.`
      : `It's being transferred to your bank now. Stayo takes nothing from it.`,
  );
}

/** It landed. Named so it can be matched against the passbook line. */
export async function notifyPayoutPaid(params: {
  ownerId: string;
  amount: number;
  method: string | null;
  reference: string | null;
}): Promise<void> {
  await notify(
    params.ownerId,
    "payout_paid",
    `${inr(params.amount)} sent to your bank`,
    // The reference is the whole point of this message: it is what lets him
    // match our number to the credit in his passbook without calling anyone.
    params.reference
      ? `Reference ${params.reference}${params.method ? ` · ${params.method.replace(/_/g, " ").toLowerCase()}` : ""}. Tap to see which tenants it covers.`
      : `Tap to see which tenants it covers.`,
  );
}

/** It failed. Said plainly, with what happens next — never a silent red dot. */
export async function notifyPayoutFailed(params: {
  ownerId: string;
  amount: number;
  reason: string | null;
}): Promise<void> {
  await notify(
    params.ownerId,
    "payout_failed",
    `${inr(params.amount)} didn't reach your bank`,
    // One failure explained openly buys more trust than ten silent successes,
    // so this states the cause and that the money is still Stayo's to pay —
    // the owner's first fear is that it has gone somewhere.
    `${params.reason?.trim() || "The transfer was rejected"}. Your money is safe with Stayo and we're sorting it out.`,
  );
}
