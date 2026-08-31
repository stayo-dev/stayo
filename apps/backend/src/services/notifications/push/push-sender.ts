import webpush from "web-push";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { deliver, type PushPayload } from "./push-delivery";

const logger = getLogger("push-sender");

export type { PushPayload } from "./push-delivery";

function configured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * The real send — thin wiring over `deliver`, which holds the tested rules.
 *
 * Fire-and-forget: a push failure must never fail or delay the notification
 * write it hangs off, and that write runs on paths that record payments. When
 * VAPID is unconfigured this is a silent no-op, so a deploy without keys
 * degrades to the three existing channels rather than erroring.
 */
export async function sendToProfile(profileId: string, payload: PushPayload): Promise<void> {
  if (!configured()) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@yourstayo.com",
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );

  const subscriptions = await prisma.push_subscriptions.findMany({
    where: { profile_id: profileId },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) return;

  const { sent, pruned } = await deliver(
    {
      send: async (subscription, body) => {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(body),
        );
      },
    },
    subscriptions,
    payload,
  );

  if (pruned.length > 0) {
    await prisma.push_subscriptions
      .deleteMany({ where: { endpoint: { in: pruned } } })
      .catch(() => undefined);
  }

  logger.info("push.delivered", { profileId, sent, pruned: pruned.length });
}
