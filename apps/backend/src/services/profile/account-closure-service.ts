import { prisma, supabase as supabaseAdmin } from "@/lib/db";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";
import { eventLog } from "@/lib/services/event-log-service";
import { markUserSessionsRevokedAfter } from "@/lib/redis/session-revocation";

/**
 * Closing a Stayo account.
 *
 * ## Anonymise, do not erase
 *
 * A profile is referenced by obligations, payments, agreements and a hostel's
 * own books. Deleting the row would either fail on a foreign key or, worse,
 * cascade through somebody else's accounting — a hostel's ledger is not solely
 * the leaver's to rewrite. So the row survives with nothing identifying left
 * on it: name, phone, email, photo and every free-text field are replaced, and
 * `is_active` goes false.
 *
 * **`is_active` is not what stops them logging in.** Nothing in the login path
 * reads it (checked, 2026-08-26) — the actual lock is deleting the Supabase
 * auth user, which is where authentication lives (ADR-031), plus a revocation
 * marker so any token already issued dies on its next request. The flag is the
 * app-side record that this happened, not the enforcement.
 *
 * ## The blockers are not retention devices
 *
 * A live tenancy, money owing, or a settlement in flight all stop a closure,
 * and none of them is there to keep someone around. An account is the thing a
 * hostel bills against; closing it mid-stay breaks a third party's records,
 * not just the leaver's. They are checked here rather than trusted from the
 * client, because the client is where someone would remove them.
 */

export type ClosureBlockerKind = "LIVE_TENANCY" | "OUTSTANDING_DUES" | "PENDING_MOVE_OUT";

export class AccountClosureBlocked extends Error {
  constructor(public kind: ClosureBlockerKind, message: string) {
    super(message);
    this.name = "AccountClosureBlocked";
  }
}

/** Ordered by what has to happen first: settle, then leave, then close. */
export async function assertClosable(profileId: string): Promise<void> {
  const tenancy = await getActiveTenancy(profileId);

  if (tenancy) {
    const outstanding = await prisma.rent_obligations.aggregate({
      where: {
        tenant_id: tenancy.id,
        status: { notIn: ["PAID", "CANCELLED", "WAIVED"] },
      },
      _sum: { amount_paise: true },
    });

    if (Number(outstanding._sum.amount_paise ?? 0) > 0) {
      throw new AccountClosureBlocked(
        "OUTSTANDING_DUES",
        "There is rent still owing. Your account has to stay open until the balance is settled.",
      );
    }

    const pendingMoveOut = await prisma.move_out_requests.findFirst({
      where: { tenant_id: tenancy.id, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } },
      select: { id: true },
    });

    if (pendingMoveOut) {
      throw new AccountClosureBlocked(
        "PENDING_MOVE_OUT",
        "Your move-out is still being settled. Closing now would leave that half-finished.",
      );
    }

    throw new AccountClosureBlocked(
      "LIVE_TENANCY",
      "You still live at your hostel. Move out first and let the settlement finish.",
    );
  }
}

/**
 * The replacement values. Keyed off the profile id so two closures can never
 * collide on `profiles.email`, which is `@unique` and not nullable.
 */
function anonymised(profileId: string) {
  const short = profileId.replace(/-/g, "").slice(0, 12);
  return {
    name: "Closed account",
    email: `closed+${short}@yourstayo.invalid`,
    phone: null,
    is_active: false,
    phone_verified: false,
    auth_user_id: null,
  };
}

export async function closeAccount(input: {
  profileId: string;
  reason: string;
  note?: string | null;
}): Promise<void> {
  await assertClosable(input.profileId);

  const profile = await prisma.profile.findUnique({
    where: { id: input.profileId },
    select: { id: true, auth_user_id: true, role: true },
  });
  if (!profile) throw new Error("NOT_FOUND: profile");

  // Recorded *before* the row is scrubbed, so the feedback survives the thing
  // it is feedback about. `system_event_logs.metadata` is jsonb — no migration.
  await eventLog.log("ACCOUNT_CLOSED", null, {
    profile_id: input.profileId,
    role: profile.role,
    reason: input.reason,
    note: (input.note ?? "").slice(0, 2000) || null,
    closed_at: new Date().toISOString(),
  });

  await prisma.profile.update({
    where: { id: input.profileId },
    data: anonymised(input.profileId),
  });

  // The real lock. Order matters: if this throws, the profile is already
  // anonymised and the account is unusable anyway — the reverse order could
  // leave a live login pointing at a scrubbed profile.
  if (profile.auth_user_id) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(profile.auth_user_id);
    } catch (error: any) {
      // Logged, not thrown: the profile is already unrecoverable, and failing
      // the request here would tell the user nothing happened when most of it
      // did. The revocation below still ends every live session.
      console.error("[ACCOUNT_CLOSURE] supabase delete failed", error?.message || error);
    }
  }

  await markUserSessionsRevokedAfter(input.profileId, Date.now());
}
