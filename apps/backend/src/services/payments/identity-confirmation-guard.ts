/**
 * 🔐 Identity Confirmation Guard
 *
 * Shared "confirm your password before doing something financially
 * sensitive" pattern used by offline payment recording, obligation waiver,
 * and obligation cancellation. Previously this two-step check (verify a
 * short-lived identity token outside the transaction, then atomically
 * single-use-consume it inside the transaction that performs the mutation)
 * was hand-copied at each call site with an identical error message and
 * an identical `tx.identity_tokens.updateMany` shape. Extracted here so
 * there is exactly one implementation of each step.
 *
 * Behavior is unchanged from the call sites this replaces — same error
 * messages, same single-use semantics (rollback leaves the token unused
 * so the caller can retry without re-entering their password).
 */

import { verifyIdentityToken } from "@/lib/auth-edge";

export interface IdentityConfirmation {
  jti: string;
  userId: string;
}

/**
 * Verify a submitted identity token outside any transaction and assert it
 * belongs to the acting session user. Does NOT consume the token — call
 * `consumeIdentityTokenInTx` inside the mutating transaction for that.
 *
 * Throws the same `IDENTITY_REQUIRED` / `IDENTITY_EXPIRED` / `FORBIDDEN`
 * conditions the original routes returned as HTTP errors — callers should
 * keep mapping these the same way they did before extraction.
 */
export async function verifyIdentityConfirmation(
  token: string | undefined | null,
  purpose: string,
  action: string,
  sessionUserId: string
): Promise<IdentityConfirmation> {
  if (!token || typeof token !== "string") {
    throw new Error("IDENTITY_REQUIRED: Identity verification required. Please confirm your password first.");
  }

  const identity = await verifyIdentityToken(token, purpose, action);
  if (!identity) {
    throw new Error("IDENTITY_EXPIRED: Identity token is invalid or expired. Please re-confirm your password.");
  }

  if (identity.userId !== sessionUserId) {
    throw new Error("FORBIDDEN: identity mismatch");
  }

  return { jti: identity.jti, userId: identity.userId };
}

/**
 * Atomically single-use-consume an identity token inside an active
 * transaction. Must be called before the guarded mutation so a failed
 * mutation rolls the consumption back too.
 */
export async function consumeIdentityTokenInTx(tx: any, jti: string): Promise<void> {
  const consumed = await tx.identity_tokens.updateMany({
    where: {
      jti,
      used: false,
      expires_at: { gt: new Date() },
    },
    data: { used: true, used_at: new Date() },
  });

  if (consumed.count === 0) {
    throw new Error("FORBIDDEN: Identity token has already been used or has expired. Please re-confirm your password.");
  }
}
