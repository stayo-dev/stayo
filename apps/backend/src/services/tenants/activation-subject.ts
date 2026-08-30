/**
 * Which credential is this activation request presenting?
 *
 * ## Why a second way in exists
 *
 * The activation token authenticates a *stranger*. Nothing else about an
 * invited tenant is known yet — no account, no session, no verified number —
 * so a long random string in a link is the only thing that can prove the
 * person opening it is the person invited.
 *
 * A tenant arriving from the claim flow is not a stranger. They proved their
 * phone by OTP, their tenancy was matched to them, an account was created and
 * a session minted. And their invitation was deliberately `SUPERSEDED` at
 * adoption, which `resolveByToken` refuses with `CLAIM_REQUIRED` — correctly,
 * since that link is dead. Minting a fresh token for someone already holding a
 * session would add a credential to hand around in order to re-prove something
 * already proven.
 *
 * So the session is the credential on that path. The token path is untouched:
 * a request carrying a token is resolved exactly as before, byte for byte,
 * whether or not a session also exists. Session mode is only ever reached by a
 * request that presents no token at all — where the old behaviour was a flat
 * refusal.
 *
 * Pure, because this is the front door to a ceremony that signs a legal
 * agreement, and "which proof did they bring" is the part worth testing in
 * isolation. See ADR-155.
 */

/**
 * Deliberately a plain interface rather than a discriminated union: this
 * project compiles with `strict: false`, which will not narrow a union on a
 * boolean tag, so the union form reads well and then fails to typecheck at
 * every call site. Same accommodation as `SignatureFileCheck`.
 */
export interface ActivationSubjectRef {
  ok: boolean;
  mode?: "token" | "session";
  /** Set when `mode` is "token". */
  token?: string;
  /** Set when `mode` is "session" — the tenancy the session belongs to. */
  tenantId?: string;
  code?: string;
  message?: string;
}

export function resolveActivationSubject(input: {
  token?: string | null;
  sessionTenantId?: string | null;
}): ActivationSubjectRef {
  const token = String(input?.token ?? "").trim();

  // A token wins whenever one is present, even alongside a session. This is
  // what keeps the ordinary invited-tenant flow unchanged: it cannot be
  // diverted into session mode by a stray cookie.
  if (token) return { ok: true, mode: "token", token };

  const tenantId = String(input?.sessionTenantId ?? "").trim();
  if (tenantId) return { ok: true, mode: "session", tenantId };

  // Unchanged from the old guard, deliberately — including the wording. A
  // request with neither proof is the same refusal it has always been.
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    message: "Activation token is required",
  };
}
