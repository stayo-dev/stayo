/**
 * "Send new links to all" for the Tenants list's Link expired drill-down.
 *
 * Each tenant goes through the same `POST /tenants/resend-invitation` the
 * profile's "Send new link" uses — no separate bulk endpoint, so a bulk send
 * cannot behave differently from a single one. Sends run one at a time: a
 * handful of WhatsApp sends is quick, and a burst is how a provider rate
 * limit gets hit.
 *
 * A resend always mints a fresh 7-day invitation with `opened_at` cleared, so
 * a tenant leaves "Link expired" and lands in "Link sent" on the next refresh.
 */

/**
 * - `delivered`: a fresh link went out on WhatsApp or email.
 * - `not-delivered`: the link was renewed but no channel reached them
 *   (no email to fall back to, or the provider refused). It needs sharing by hand.
 * - `failed`: the resend itself did not happen.
 */
export type ResendOutcome = 'delivered' | 'not-delivered' | 'failed';

export interface BulkResendResult<T> {
  delivered: T[];
  notDelivered: T[];
  failed: T[];
}

export async function bulkResend<T>(
  items: T[],
  sendOne: (item: T) => Promise<ResendOutcome>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResendResult<T>> {
  const result: BulkResendResult<T> = { delivered: [], notDelivered: [], failed: [] };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    let outcome: ResendOutcome;
    try {
      outcome = await sendOne(item);
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'delivered') result.delivered.push(item);
    else if (outcome === 'not-delivered') result.notDelivered.push(item);
    else result.failed.push(item);
    onProgress?.(i + 1, items.length);
  }
  return result;
}

/** One sentence for the owner, naming who still needs them. */
export function describeBulkResend(result: BulkResendResult<{ name: string }>): string {
  const parts: string[] = [];
  const n = result.delivered.length;
  if (n > 0) parts.push(`New link sent to ${n} tenant${n === 1 ? '' : 's'}.`);
  if (result.notDelivered.length > 0) {
    parts.push(
      `Renewed but not delivered to ${names(result.notDelivered)} — open their profile to share the link.`,
    );
  }
  if (result.failed.length > 0) parts.push(`Couldn't resend to ${names(result.failed)}. Try them again.`);
  return parts.join(' ') || 'Nothing to send.';
}

function names(list: { name: string }[]): string {
  const shown = list.slice(0, 3).map((t) => t.name);
  const rest = list.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}
