import type { DispatchChunk, UndeliveredInvitation } from './api';

/**
 * What "Send" did, told straight.
 *
 * The screen used to read "Every invitation has been sent" whenever the queue
 * was empty. Empty only means each invitation was *attempted*: an owner saw
 * that line, and a tick beside "Invitation sent", while no WhatsApp arrived.
 * The backend now separates delivered from undelivered, and this is the one
 * place the screen decides what to say about it.
 */

export interface SendResult {
  /** Reached the tenant on WhatsApp or email. */
  sent: number;
  failed: number;
  /** Still queued on the server. */
  remaining: number;
  /** Attempted, link live, nothing arrived — the owner has to share these. */
  undelivered: UndeliveredInvitation[];
}

/** Folds one chunk into the running result. An invitation is listed once, however many chunks mention it. */
export function mergeSendResult(current: SendResult | null, chunk: DispatchChunk): SendResult {
  const seen = new Set((current?.undelivered ?? []).map((u) => u.invitation_id));
  return {
    sent: (current?.sent ?? 0) + chunk.sent,
    failed: chunk.failed,
    remaining: chunk.remaining,
    undelivered: [...(current?.undelivered ?? []), ...chunk.undelivered.filter((u) => !seen.has(u.invitation_id))],
  };
}

/**
 * Whether "Send all" should ask for another slice.
 *
 * Progress is anything that left the queue, delivered or not. Looping on
 * `sent > 0`, as before, would abandon the rest of the queue the first time a
 * whole slice failed to deliver — a WhatsApp outage would strand everyone
 * after the first ten.
 */
export function shouldSendMore(chunk: DispatchChunk, options: { limit?: number; attempts: number }): boolean {
  if (options.limit) return false;
  if (options.attempts >= 50) return false;
  return chunk.remaining > 0 && chunk.sent + chunk.undelivered.length > 0;
}

/** Invitations still waiting to be sent, from the server's count once there is one. */
export function invitationsWaiting(importedTenants: number, result: SendResult | null): number {
  return result ? Math.max(0, result.remaining) : Math.max(0, importedTenants);
}

/** True once Send has been pressed and anything was attempted — the Send step stays on screen. */
export function anyDispatched(result: SendResult | null): boolean {
  return Boolean(result && result.sent + result.undelivered.length > 0);
}

export function describeSendState(input: { waiting: number; result: SendResult | null }): {
  title: string;
  detail: string;
} {
  const sent = input.result?.sent ?? 0;
  const undelivered = input.result?.undelivered.length ?? 0;

  if (input.waiting > 0) {
    return {
      title: `${input.waiting.toLocaleString('en-IN')} ${input.waiting === 1 ? 'invitation is' : 'invitations are'} ready to send`,
      detail:
        'Your tenants are set up and their rent is being tracked — they just haven’t been messaged yet. Each one gets a week to accept from the moment you send.',
    };
  }

  if (undelivered === 0) {
    return {
      title: sent === 1 ? 'The invitation has been delivered' : 'Every invitation has been delivered',
      detail: 'Your tenants can now set up their accounts.',
    };
  }

  const who = undelivered === 1 ? '1 tenant' : `${undelivered.toLocaleString('en-IN')} tenants`;
  return {
    title: sent > 0 ? `${sent.toLocaleString('en-IN')} delivered · ${who} didn’t get it` : `${who} didn’t get the invitation`,
    detail:
      'Their invitation is ready, but the message didn’t reach them. Share their link yourself — it works exactly the same, and it’s valid for a week.',
  };
}
