import { useNavigate } from 'react-router-dom';
import { Bell, CreditCard, UtensilsCrossed, DoorOpen, MessageSquareWarning, Megaphone, CalendarDays } from 'lucide-react';
import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { useTenantHome } from '@features/tenant-home/hooks/useTenantHome';
import { PaySheet } from '@features/tenant-financials/components/PaySheet';
import { mealIcon } from '@features/owner-food/mealIcons';

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

/** Tenant Home tab, per Stayo Tenant.dc.html. Composes financials, food, and hostel-content data — no page-local fetching beyond that. */
export function TenantHomePage() {
  const navigate = useNavigate();
  const home = useTenantHome();

  if (home.isLoading) return <LoadingSkeleton />;

  const quickActions = [
    { key: 'pay', title: 'Pay Rent', icon: CreditCard, onClick: () => home.financials.openPay() },
    { key: 'food', title: 'Food', icon: UtensilsCrossed, onClick: () => navigate('/tenant/food') },
    { key: 'room', title: 'Room', icon: DoorOpen, onClick: () => navigate('/tenant/room') },
    { key: 'complaint', title: 'Complaint', icon: MessageSquareWarning, onClick: () => navigate('/tenant/room') },
  ];

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="relative overflow-hidden rounded-b-[24px] bg-[#221E1A] px-[22px] pb-[18px] pt-6">
        <div
          className="pointer-events-none absolute -right-10 -top-8 h-[150px] w-[150px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(217,144,111,0.2), transparent 70%)' }}
        />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[12px] bg-primary font-display text-[15px] font-extrabold text-white shadow-[0_4px_12px_rgba(180,106,85,0.35)]">
              {home.name?.[0]?.toUpperCase() ?? 'T'}
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[20px] font-extrabold tracking-[-0.02em] text-white">Hi, {home.name}</h1>
              {home.roomNo && (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/[0.09] px-2.5 py-[3px] text-[11px] font-semibold text-white/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> Room {home.roomNo}
                </span>
              )}
            </div>
          </div>
          <button type="button" className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/[0.08]">
            <Bell className="h-[18px] w-[18px] text-white/80" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 sm:px-6">
      {home.financials.amountDue > 0 && (
        <div className="rounded-2xl border border-border bg-card p-[18px] shadow-[0_1px_2px_rgba(40,30,20,0.04),0_8px_22px_rgba(40,30,20,0.07)]">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-warning">Rent due</span>
            {home.financials.isOverdue && (
              <span className="ml-auto text-[11.5px] font-semibold text-muted-foreground">
                {home.financials.overdueDays}d overdue
              </span>
            )}
          </div>
          <div className="mt-2 flex items-end justify-between">
            <span className="font-display text-[34px] font-extrabold tracking-[-0.03em] tabular-nums text-foreground">
              ₹{home.financials.amountDue.toLocaleString('en-IN')}
            </span>
          </div>
          <button
            type="button"
            onClick={home.financials.openPay}
            className="mt-3 w-full rounded-xl bg-[#A45D44] py-[15px] text-center font-display text-sm font-bold text-white shadow-[0_6px_16px_rgba(164,93,68,0.3)]"
          >
            Pay ₹{home.financials.amountDue.toLocaleString('en-IN')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <span className={sectionLabel}>Quick actions</span>
        <div className="grid grid-cols-4 gap-2.5">
          {quickActions.map(({ key, title, icon: Icon, onClick }) => (
            <button key={key} type="button" onClick={onClick} className={`${card} flex flex-col items-center gap-2 px-2 py-3`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-secondary text-primary">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="text-center text-[11px] font-semibold leading-tight text-foreground">{title}</span>
            </button>
          ))}
        </div>
      </div>

      {home.todaysMeals.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Today's meals</span>
            <button type="button" onClick={() => navigate('/tenant/food')} className="text-[13px] font-semibold text-primary">
              Menu
            </button>
          </div>
          <div className={`${card} divide-y divide-border px-4`}>
            {home.todaysMeals.map(({ slot, cell }) => (
              <div key={slot} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-[16px]">
                  {(() => { const I = mealIcon(slot); return <I className="h-4 w-4" strokeWidth={1.75} />; })()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-foreground">{cell!.item_name}</div>
                  <div className="text-[11.5px] font-medium text-muted-foreground">{MEAL_CATEGORY_META[slot].label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {home.pollAvailable && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Vote for next month's menu</span>
          <div className={`${card} p-4`}>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />Voting open
              </span>
            </div>
            {home.pollPreview.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {home.pollPreview.map((name) => (
                  <span key={name} className="rounded-[10px] bg-secondary/60 px-3 py-1.5 text-[12px] font-semibold text-muted-foreground">
                    {name}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate('/tenant/food')}
              className="mt-3.5 w-full rounded-xl bg-foreground py-3 text-center font-display text-sm font-bold text-background"
            >
              Vote now
            </button>
          </div>
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
          <span className={sectionLabel}>Request status</span>
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

      <p className="pt-0.5 text-center text-[11px] font-medium text-[#B7AC9F]">Stayo</p>
      </div>

      <PaySheet
        stage={home.financials.payStage}
        amount={home.financials.amountDue}
        error={home.financials.payError}
        onClose={home.financials.closePay}
        onConfirm={home.financials.confirmPay}
      />
    </div>
  );
}
