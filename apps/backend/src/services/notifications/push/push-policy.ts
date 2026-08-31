/**
 * Which notification types earn a push, and where tapping one lands.
 *
 * The "no" list is load-bearing. A channel that fires on weekly menus and
 * verified documents teaches people to swipe everything away, and then the
 * rent reminder gets swiped too.
 *
 * PURE — no Prisma, no network. Runs in the pure suite.
 */

/** Everything that pushes. Anything absent does not — see `shouldPush`. */
export const PUSH_TYPES: ReadonlySet<string> = new Set([
  // Tenant
  "rent_reminder",
  "payment",
  "announcement",
  "service_request",
  "agreement_lifecycle",
  "renewal_offer",
  "move_out_dispute",
  "move_out",
  "tenancy_claim",
  "tenancy_claim_dispute",
  "food_poll_opened",
  "food_voting_opened",
  "document_rejected",
  // Owner
  "lead",
  "marketing",
  "payout_collected",
  "payout_sent",
  "payout_paid",
  "payout_failed",
]);

/*
 * Deliberately absent: `daily_briefing`. The briefing cron sends a WhatsApp
 * template directly and never calls `createNotification`, so listing it here
 * would be dead config — a push that could never fire. Pushing briefings needs
 * its own integration in that cron and is out of scope for v1.
 */

/**
 * An unknown type is **not** pushed.
 *
 * This default is the whole safety property: someone adding a notification
 * type next month gets in-app delivery and has to opt into push deliberately,
 * rather than discovering they have been buzzing every tenant since Tuesday.
 */
export function shouldPush(type: string): boolean {
  return PUSH_TYPES.has(type.toLowerCase());
}

/** Where tapping the notification should land. */
const LINKS: Record<string, string> = {
  rent_reminder: "/tenant/money",
  payment: "/tenant/money",
  announcement: "/tenant/home",
  service_request: "/tenant/room",
  agreement_lifecycle: "/tenant/home",
  renewal_offer: "/tenant/home",
  move_out_dispute: "/tenant/home",
  move_out: "/tenant/home",
  tenancy_claim: "/tenant/home",
  tenancy_claim_dispute: "/tenant/home",
  food_poll_opened: "/tenant/food",
  food_voting_opened: "/tenant/food",
  document_rejected: "/tenant/profile/details",
  lead: "/owner/alerts",
  marketing: "/owner/more",
  payout_collected: "/owner/money",
  payout_sent: "/owner/money",
  payout_paid: "/owner/money",
  payout_failed: "/owner/money",
};

export function pushLinkFor(type: string): string {
  return LINKS[type.toLowerCase()] ?? "/tenant/notifications";
}
