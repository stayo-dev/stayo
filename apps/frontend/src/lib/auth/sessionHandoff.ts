/**
 * What a sign-in response hands the browser (ADR-204).
 *
 * Every backend path that signs someone in — password, phone, owner and tenant
 * signup, tenant activation — ends the same way now: a single-use Clerk
 * **ticket**, which the browser redeems with Clerk. Clerk then owns the
 * session. The Supabase token pair survives only as what a backend still
 * mid-deploy may send; this module accepts it so a frontend deployed first
 * keeps working, and nothing here ever *prefers* it.
 *
 * PURE — no React, no I/O. The effects live in `establishSession.ts`.
 */

export type SessionHandoff =
  | { kind: 'clerk_ticket'; ticket: string }
  | { kind: 'supabase'; accessToken: string; refreshToken: string }
  | { kind: 'none' };

/** The header the backend reads to decide whether to answer with a ticket. */
export const AUTH_CAPABILITIES_HEADER = 'X-Auth-Capabilities';
export const AUTH_CAPABILITIES = 'clerk-ticket';

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readSessionHandoff(data: unknown): SessionHandoff {
  const body = (data ?? {}) as Record<string, unknown>;
  // A ticket always wins: Clerk is the session authority.
  if (nonEmpty(body.sign_in_ticket)) return { kind: 'clerk_ticket', ticket: body.sign_in_ticket };
  if (nonEmpty(body.access_token) && nonEmpty(body.refresh_token)) {
    return { kind: 'supabase', accessToken: body.access_token, refreshToken: body.refresh_token };
  }
  return { kind: 'none' };
}

/**
 * Errors whose meaning is "the session this browser holds is over — drop it":
 * the app's idle rule, a deny-listed session (logout elsewhere, password
 * reset or change), and a pre-Clerk token for an account that has moved.
 */
export const SESSION_ENDED_CODES: ReadonlySet<string> = new Set([
  'SESSION_INACTIVE',
  'SESSION_REVOKED',
  'SIGN_IN_AGAIN',
]);

export function isSessionEndedCode(code: unknown): boolean {
  return SESSION_ENDED_CODES.has(String(code ?? '').toUpperCase());
}
