/**
 * The delivery rules, with no Prisma and no network in sight.
 *
 * Split from `push-sender.ts` deliberately. `lib/db.ts` throws on import when
 * `DATABASE_URL_TEST` is unset, so anything that reaches Prisma — even
 * transitively — cannot be imported by a test in the pure suite. Keeping the
 * rules here is what makes them testable at all, and it leaves `push-sender`
 * as thin wiring over an already-tested decision.
 *
 * PURE — safe to import anywhere.
 */

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Injected so the rules can be tested without a network. */
export interface DeliverDeps {
  send(subscription: StoredSubscription, payload: PushPayload): Promise<void>;
}

/**
 * Fan a payload out to every device a profile has.
 *
 * A 404/410 means the push service has permanently forgotten this endpoint —
 * the browser was uninstalled, storage cleared, or the subscription rotated.
 * Those rows are dead and are reported for deletion. Anything else (a 5xx, a
 * timeout) is transient: pruning on those would quietly delete live devices
 * during an outage, and the person would simply stop receiving notifications
 * with nothing on screen to explain why.
 *
 * Never rejects. Callers are fire-and-forget on paths that record money.
 */
export async function deliver(
  deps: DeliverDeps,
  subscriptions: StoredSubscription[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: string[] }> {
  let sent = 0;
  const pruned: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await deps.send(subscription, payload);
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) pruned.push(subscription.endpoint);
      }
    }),
  );

  return { sent, pruned };
}
