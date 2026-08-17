/**
 * Should this Google sign-in create a brand-new Stayo account?
 *
 * Extracted so the one condition that decides whether a stranger gets an
 * account is testable on its own. It previously lived inline in an effect
 * that ran several times per callback, which is exactly how it came to be
 * evaluated with a stale `provisionAllowed`.
 *
 * PURE — runs under vitest's node environment.
 */
export function shouldProvisionAccount(input: {
  status: number | undefined;
  code: string | undefined;
  provisionAllowed: boolean;
}): boolean {
  // All three must hold:
  //  - the backend specifically said this email has no Stayo account
  //    (not a generic 403, and never a 401, which means the deployment could
  //    not verify the session at all)
  //  - the visitor started from a surface allowed to create one — tenant
  //    sign-in only; owner and admin never auto-provision
  return input.status === 403 && input.code === 'NO_STAYO_ACCOUNT' && input.provisionAllowed === true;
}
