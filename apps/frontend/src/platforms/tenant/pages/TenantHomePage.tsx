import { useNavigate } from 'react-router-dom';
import { greetingWithName } from '../components/tenantGreeting';
import { Bell, Megaphone, CalendarDays, CreditCard } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useTenantHome } from '@features/tenant-home/hooks/useTenantHome';
import { useTenantFinancials } from '@features/tenant-financials/hooks/useTenantFinancials';
import { useTenantMealTimings } from '@features/food/hooks/useTenantMealTimings';
import { useTenantFoodPolls } from '@features/food/hooks/useTenantFoodPolls';
import { useNow } from '@features/food/hooks/useNow';
import { nextServingAt } from '@features/food/mealTimings';
import { NextServingCard } from '@features/food/components/NextServingCard';
import { ActivePollCard } from '@features/food/components/ActivePollCard';
import { formatCellItems } from '@features/owner-food/weekGrid';
import { PaySheet } from '@features/tenant-financials/components/PaySheet';
import { ProfileCompletionNudge } from '../components/ProfileCompletionNudge';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="h-20 animate-pulse rounded-2xl bg-muted" />
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/**
 * Tenant Home tab — an at-a-glance feed of what's happening at the hostel,
 * not a full actions hub (most live on their own tabs). Sections, in order:
 * rent-due hero (only while something is owed — per Stayo Tenant.dc.html's
 * `rentPending` card), today's meals, active food poll, announcements,
 * complaint/request status, upcoming events (owner-scheduled). No Quick
 * Actions grid — that part of the mockup stays out of scope.
 *
 * The rent-due card reuses `useTenantFinancials()` (same hook/read-model as
 * the Money tab) and its own `PaySheet` instance so Home never disagrees
 * with Money on what's owed — see the hook's own doc comment.
 */
export function TenantHomePage() {
  const navigate = useNavigate();
  const home = useTenantHome();
  const fin = useTenantFinancials();
  const mealTimings = useTenantMealTimings();
  const polls = useTenantFoodPolls();
  const now = useNow();

  if (home.isLoading) return <LoadingSkeleton />;

  const activePoll = polls.polls[0] ?? null;

  const upcomingMeal = nextServingAt(mealTimings.mealTimings, now);
  const upcomingCell = upcomingMeal ? home.todaysMeals.find((m) => m.slot === upcomingMeal.slot)?.cell : null;
  const nextServing = upcomingMeal
    ? { ...upcomingMeal, itemName: upcomingCell ? formatCellItems({ items: upcomingCell.food_schedule_meal_items }) : null }
    : null;

  const payableItems = (fin.readModel?.items ?? []).filter((i: any) => i.legacy_status !== 'UPCOMING');
  const nextDueItem = payableItems.length
    ? [...payableItems].sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0]
    : null;
  const rentPeriodLabel = nextDueItem
    ? new Date(nextDueItem.rent_month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const rentDueDateLabel = nextDueItem ? new Date(nextDueItem.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/*
        The front door, not a banner.

        This was a dark slab with a radial glow, spending about 120px of a
        phone screen to say a name — on a page whose first real content is
        "rent due". It sits on the app's own paper ground now: the hostel's
        monogram in Stayo terracotta, the hostel name above the greeting
        (their relationship is with the hostel; the app is just where it
        lives), and the bell. Sticky, so it stays put while the day's news
        scrolls under it.

        The greeting reads the clock rather than repeating the product name
        back at someone who lives here — see `tenantGreeting.ts`.
      */}
      <div className="sticky top-0 z-20 border-b border-border/60 bg-background/85 px-5 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-primary/12 font-display text-[14px] font-extrabold text-primary">
            {home.hostelName
              ? home.hostelName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
              : 'ST'}
          </span>

          <div className="min-w-0 flex-1">
            {home.hostelName && (
              <div className="truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {home.hostelName}
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-2">
              <h1 className="truncate font-display text-[19px] font-extrabold tracking-[-0.02em] text-foreground">
                {greetingWithName(home.name)}
              </h1>
              {home.roomNo && (
                <span className="inline-flex flex-none items-center gap-1.5 rounded-full bg-muted px-2.5 py-[3px] text-[10.5px] font-semibold text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> Room {home.roomNo}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => stayoToast.info('No new alerts')}
            aria-label="Alerts"
            className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full border border-border bg-card"
          >
            <Bell className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.8} />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-card bg-primary" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 sm:px-6">
      <ProfileCompletionNudge />
      {fin.amountDue > 0 && (
        <div className={`${card} p-[18px]`}>
          <div className="flex items-center gap-2">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-warning" />
            <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-warning">Rent due</span>
            {fin.isOverdue && (
              <span className="ml-auto text-[12px] font-semibold text-muted-foreground">{fin.overdueDays} day{fin.overdueDays === 1 ? '' : 's'} overdue</span>
            )}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-muted-foreground">{rentPeriodLabel}</div>
              <div className="mt-0.5 font-display text-[34px] font-extrabold tracking-[-0.03em] tabular-nums text-foreground">
                ₹{fin.amountDue.toLocaleString('en-IN')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12px] font-medium text-[#9C9186]">Was due</div>
              <div className="text-[14px] font-semibold text-[#4A433C]">{rentDueDateLabel}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={fin.openPay}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#A45D44] py-[15px] text-center font-display text-[15px] font-bold text-white shadow-[0_6px_16px_rgba(164,93,68,0.3)]"
          >
            <CreditCard className="h-[17px] w-[17px]" strokeWidth={1.7} />
            Pay ₹{fin.amountDue.toLocaleString('en-IN')}
          </button>
        </div>
      )}

      {home.todaysMeals.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Food</span>
            <button type="button" onClick={() => navigate('/tenant/food')} className="text-[13px] font-semibold text-primary">
              Menu
            </button>
          </div>
          <NextServingCard next={nextServing} now={now} />
        </div>
      )}

      {activePoll && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Active food poll</span>
          <ActivePollCard poll={activePoll} onToggleVote={(optionId) => polls.toggleVote(activePoll.id, optionId)} isVoting={polls.isVoting} />
        </div>
      )}

      {home.announcements.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Announcements</span>
          <div className={`${card} divide-y divide-border px-4`}>
            {home.announcements.map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
                  <Megaphone className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-snug text-foreground">{a.title}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{a.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {home.hasComplaint && home.latestComplaint && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Complaint status</span>
          <button
            type="button"
            onClick={() => navigate('/tenant/room')}
            className={`${card} flex items-center justify-between gap-3 p-4 text-left`}
          >
            <div className="min-w-0">
              <div className="font-display text-[14.5px] font-bold text-foreground">
                {home.latestComplaint.category ?? home.latestComplaint.type.replace('_', ' ')}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {home.latestComplaint.description ?? 'View details'}
              </div>
            </div>
            <span className="flex-none rounded-full bg-warning/10 px-2.5 py-1 text-[10.5px] font-bold text-warning">
              {home.latestComplaint.status.replace('_', ' ')}
            </span>
          </button>
        </div>
      )}

      {home.events.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Upcoming events</span>
          <div className={`${card} divide-y divide-border px-4`}>
            {home.events.map((e) => {
              const d = new Date(e.event_date);
              return (
                <div key={e.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-[12px] bg-secondary/60">
                    <span className="font-display text-[15px] font-extrabold leading-none text-foreground">{d.getDate()}</span>
                    <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                      {d.toLocaleDateString('en-IN', { month: 'short' })}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14.5px] font-bold text-foreground">{e.title}</div>
                    {e.description && <div className="text-[11.5px] text-muted-foreground">{e.description}</div>}
                  </div>
                  <CalendarDays className="h-4 w-4 flex-none text-muted-foreground" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="pt-0.5 text-center text-[11px] font-medium text-[#B7AC9F]">Stayo{home.hostelName ? ` · ${home.hostelName}` : ''}</p>
      </div>

      <PaySheet
        stage={fin.payStage}
        amount={fin.amountDue}
        error={fin.payError}
        onClose={fin.closePay}
        onConfirm={fin.confirmPay}
      />
    </div>
  );
}
