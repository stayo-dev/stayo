import { prisma } from "@/lib/db";

/**
 * Lifetime collection facts about an owner — deliberately not part of
 * `portfolioService`, which states its own invariant that every metric it
 * returns comes from `hostel_daily_snapshots` and no raw transactional table
 * is queried inside it. `payments` is a raw transactional table, so this lives
 * beside that service and is composed into the route, the same way
 * `expenseService.getMonthSpendSummary` already is.
 */
export const ownerCollectionHistory = {
  /**
   * Has this owner ever recorded a payment, across every hostel and every
   * month?
   *
   * Home's new-owner checklist needs a *lifetime* fact. Its other two steps
   * (rooms exist, tenants exist) already are lifetime facts, but "money has
   * come in" was read from `rent_collected_this_month`, which resets on the
   * 1st — so the checklist carried a one-way `graduated` latch in browser
   * storage to stop it telling a long-running hostel every month that it had
   * never taken rent. That latch was keyed globally rather than per owner, so
   * a single finished account silently suppressed the checklist for every
   * account signed in afterwards on the same browser, brand-new ones included.
   * With this fact available, all three steps are permanently true and the
   * latch is gone. See ADR-139.
   *
   * Scoped through the `hostels` relation rather than `payments.owner_id`,
   * which is nullable — a payment written without it would read as "never
   * collected". `payments.hostel_id` is indexed and `findFirst` stops at the
   * first row, so this stays cheap on a large portfolio.
   */
  async hasEverCollected(ownerId: string): Promise<boolean> {
    const first = await prisma.payments.findFirst({
      where: { hostels: { owner_id: ownerId } },
      select: { id: true },
    });
    return first !== null;
  },
};
