import { useNavigate } from 'react-router-dom';
import { TenantPageHeader } from '../components/TenantPageHeader';
import { GuideNote } from '../guide/GuideNote';
import { useTenantGuide } from '../guide/useTenantGuide';
import { TAB_COPY } from '../guide/guideCopy';
import { useMutation } from '@tanstack/react-query';
import { Share2, Receipt, Wallet, Info, ShieldCheck, Undo2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { paymentService } from '@features/payments/api';
import { useTenantFinancials } from '@features/tenant-financials/hooks/useTenantFinancials';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { PaySheet } from '@features/tenant-financials/components/PaySheet';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold tracking-[0.06em] text-[#9C9186]';

// Real grades from `tenant-score-service.ts`: EXCELLENT/GOOD/FAIR/NEEDS_ATTENTION/HIGH_RISK
// (a payment-risk score, starts at 100 and is deducted for late payments — NOT
// a "new tenant builds up over time" narrative). The design mockup's demo
// state shows a "New tenant" framing, but that doesn't match how the real
// score works (a fresh tenant with no history starts at the top, EXCELLENT,
// not the bottom) — so tier copy here reflects the real scoring semantics
// instead of the mockup's specific illustrative scenario.
const STANDING_TIERS = [
  { key: 'ATTENTION', label: 'Building' },
  { key: 'FAIR', label: 'Fair' },
  { key: 'GOOD', label: 'Good' },
  { key: 'EXCELLENT', label: 'Excellent' },
];

const STANDING_COPY = [
  { heading: 'Building Consistency', sub: 'On-time payments will lift your standing' },
  { heading: 'Fair standing', sub: "You're on the right track" },
  { heading: 'Good standing', sub: "You're a reliable payer" },
  { heading: 'Excellent standing', sub: 'Outstanding track record' },
];

function standingIndex(grade: string | undefined) {
  if (grade === 'EXCELLENT') return 3;
  if (grade === 'GOOD') return 2;
  if (grade === 'FAIR') return 1;
  return 0; // NEEDS_ATTENTION / HIGH_RISK / unknown
}

const TIMELINE_DOT: Record<string, string> = {
  paid: 'bg-success',
  overdue: 'bg-destructive',
  due_soon: 'bg-warning',
  pending: 'bg-muted-foreground/40',
  upcoming: 'bg-muted-foreground/25',
  waived: 'bg-muted-foreground/40',
  partial: 'bg-warning',
};

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/** Tenant Payments tab (route stays `/tenant/money`; label renamed from "Money" for the single-level nav), per Stayo Tenant.dc.html. Real data via `useTenantFinancials()` — the same hook Home's rent-due hero uses, so the two never disagree. */
export function TenantMoneyPage() {
  const navigate = useNavigate();
  const fin = useTenantFinancials();
  const profile = useTenantProfile();

  const shareLinkMutation = useMutation({
    mutationFn: () => paymentService.generatePayLink({ tenantId: undefined, obligationId: undefined }),
    onSuccess: (res: any) => {
      const url = res?.pay_link || res?.url || res?.link;
      if (url && navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
        stayoToast.success('Payment link copied');
      } else {
        stayoToast.success('Payment link generated');
      }
    },
    onError: () => stayoToast.error('Could not generate a payment link'),
  });

  // Introduces this screen once, the first time it is opened with real
  // data on it. Inline rather than a spotlight — see `GuideNote`.
  const guide = useTenantGuide('money', !fin.isLoading);

  if (fin.isLoading) return <LoadingSkeleton />;

  const tierIndex = standingIndex(fin.score?.grade);
  const depositPct = fin.securityDeposit.configured > 0 ? Math.round((fin.securityDeposit.paid / fin.securityDeposit.configured) * 100) : 0;
  const rentDue = fin.readModel?.rent_due ?? 0;
  const lateFeeDue = fin.readModel?.late_fees_due ?? 0;
  const maintenanceDue = fin.readModel?.maintenance_due ?? 0;
  const installmentTotal = rentDue + lateFeeDue + maintenanceDue;
  const reversedPayments = (fin.history as any[]).filter((p: any) => p.is_reversal);

  const activeFreq = fin.billingFrequency?.active_frequency ? `${fin.billingFrequency.active_frequency.charAt(0)}${fin.billingFrequency.active_frequency.slice(1).toLowerCase()} plan` : 'Monthly plan';

  return (
    <div>
      <TenantPageHeader
        title="Payments"
        subtitle={`${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · ${activeFreq}`}
        right={
          profile.room?.room_no ? (
            <span className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-[7px]">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="text-[11px] font-semibold text-background/80">Room {profile.room.room_no}</span>
            </span>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6 px-4 pb-8 pt-5 sm:px-6">
        {guide.show && <GuideNote {...TAB_COPY.money} onDismiss={guide.dismiss} />}

      <div className="relative overflow-hidden rounded-[22px] bg-foreground p-5 text-background shadow-[0_12px_30px_rgba(34,30,26,0.24)]">
        <div
          className="pointer-events-none absolute -right-7 -top-7 h-[130px] w-[130px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(217,144,111,0.2), transparent 70%)' }}
        />
        <div className="relative flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#E0A57F]" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#B9AFA3]">Outstanding balance</span>
        </div>
        <div className="relative mt-2 font-display text-[40px] font-extrabold tabular-nums">
          ₹{fin.amountDue.toLocaleString('en-IN')}
        </div>
        {fin.isOverdue && (
          <p className="relative mt-1 text-[12.5px] text-[#B9AFA3]">{fin.overdueDays} days overdue. One payment clears it.</p>
        )}
        <div className="relative mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={fin.openPay}
            disabled={fin.amountDue <= 0}
            className="flex-1 rounded-xl bg-white py-[13px] text-center font-display text-sm font-bold text-foreground disabled:opacity-50"
          >
            Pay ₹{fin.amountDue.toLocaleString('en-IN')}
          </button>
          <button
            type="button"
            onClick={() => shareLinkMutation.mutate()}
            disabled={shareLinkMutation.isPending}
            className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-[13px] text-[13px] font-semibold text-background"
          >
            <Share2 className="h-4 w-4" /> Share link
          </button>
        </div>
      </div>

      {fin.score && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Payment standing</span>
          <div className={`${card} p-[17px]`}>
            <div className="flex items-center justify-between gap-2.5">
              <div>
                <div className="font-display text-base font-bold text-foreground">{STANDING_COPY[tierIndex].heading}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{STANDING_COPY[tierIndex].sub}</div>
              </div>
              <span className="flex-none rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                Score {fin.score.score}
              </span>
            </div>
            <div className="mt-3.5 flex gap-1.5">
              {STANDING_TIERS.map((t, i) => (
                <div key={t.key} className={`h-[7px] flex-1 rounded-full ${i <= tierIndex ? 'bg-primary' : 'bg-[#E7DDD1]'}`} />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between">
              {STANDING_TIERS.map((t, i) => (
                <span key={t.key} className={`text-[10px] font-semibold ${i === tierIndex ? 'text-primary' : 'text-[#B0A597]'}`}>{t.label}</span>
              ))}
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#F6F0E8] p-[13px]">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-[#9C7A52]" />
              <p className="text-[11px] leading-relaxed text-[#6B6259]">
                {tierIndex < 3
                  ? <>Clear this month on time and you'll move to <b className="font-semibold text-[#4A433C]">{STANDING_TIERS[tierIndex + 1].label}</b>. Every on-time payment lifts your standing.</>
                  : "You're at the top tier — keep it up with on-time payments."}
              </p>
            </div>
          </div>
        </div>
      )}

      {installmentTotal > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Current installment</span>
          <div className={`${card} p-[17px]`}>
            <div className="flex flex-col gap-2 text-[13px]">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Rent portion</span><span className="font-semibold tabular-nums text-foreground">{fmt(rentDue)}</span></div>
              {maintenanceDue > 0 && (
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Maintenance</span><span className="font-semibold tabular-nums text-foreground">{fmt(maintenanceDue)}</span></div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Late fee</span>
                <span className={`font-semibold tabular-nums ${lateFeeDue > 0 ? 'text-destructive' : 'text-success'}`}>{lateFeeDue > 0 ? fmt(lateFeeDue) : 'Waived'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
                <span className="font-bold text-foreground">Total due</span>
                <span className="font-display text-[15px] font-extrabold tabular-nums text-foreground">{fmt(installmentTotal)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={fin.openPay}
              className="mt-3.5 w-full rounded-xl bg-[#A45D44] py-[13px] text-center font-display text-sm font-bold text-white shadow-[0_6px_16px_rgba(164,93,68,0.28)]"
            >
              Pay this installment
            </button>
          </div>
        </div>
      )}

      {fin.billingFrequency && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Billing</span>
          <div className={`${card} p-4`}>
            <div className="flex items-center gap-3">
              <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                <Wallet className="h-4.5 w-4.5" />
              </span>
              <div className="flex-1">
                <div className="font-display text-sm font-bold text-foreground">
                  {fin.billingFrequency.active_frequency?.charAt(0)}{fin.billingFrequency.active_frequency?.slice(1).toLowerCase()} billing
                </div>
                <div className="text-[11.5px] text-muted-foreground">Rent portion {fmt(rentDue)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-[#F7F1EA] px-3 py-[11px]">
                <div className="text-[10px] font-semibold uppercase text-[#9C9186]">Rent / month</div>
                <div className="mt-0.5 font-display text-[13.5px] font-bold text-foreground">{fmt(rentDue)}</div>
              </div>
              <div className="rounded-xl bg-[#F7F1EA] px-3 py-[11px]">
                <div className="text-[10px] font-semibold uppercase text-[#9C9186]">Cycle</div>
                <div className="mt-0.5 font-display text-[13.5px] font-bold text-foreground">
                  {fin.billingFrequency.active_frequency?.charAt(0)}{fin.billingFrequency.active_frequency?.slice(1).toLowerCase()}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => stayoToast.info('Billing change request opened')}
              className="mt-3.5 flex w-full items-center justify-center gap-1.5 text-[12.5px] font-semibold text-primary"
            >
              Switch to quarterly or annual →
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <span className={sectionLabel}>Installment timeline</span>
        </div>
        <div className={`${card} divide-y divide-border px-4`}>
          {fin.timeline.length === 0 ? (
            <div className="py-4 text-center text-[12.5px] text-muted-foreground">No installments yet</div>
          ) : (
            fin.timeline.slice(0, 8).map((t: any) => (
              <div key={t.id} className="flex gap-3 py-3">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${TIMELINE_DOT[t.state] ?? 'bg-muted-foreground/30'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[13.5px] font-bold text-foreground">{t.label}</span>
                    <span className="tabular-nums font-display text-[13px] font-bold text-foreground">
                      ₹{Number(t.amount).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                    {new Date(t.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {t.state.replace('_', ' ')}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {fin.securityDeposit.configured > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Deposit</span>
          <div className={`${card} p-4`}>
            <div className="flex items-center gap-3">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-[#EAF3EE] text-success">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-bold text-foreground">Security deposit</div>
                <div className="text-[11px] text-muted-foreground">Held for move-in</div>
              </div>
              {depositPct >= 100 && (
                <span className="flex-none rounded-full bg-[#EAF3EE] px-2.5 py-1 text-[10.5px] font-bold text-success">Fully secured</span>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">Held by hostel</span>
              <span className="font-display text-[19px] font-extrabold tabular-nums text-success">
                ₹{fin.securityDeposit.paid.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success" style={{ width: `${depositPct}%` }} />
            </div>
            {fin.securityDeposit.due > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">₹{fin.securityDeposit.due.toLocaleString('en-IN')} still due</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <span className={sectionLabel}>Payment history</span>
        <div className={`${card} divide-y divide-border px-4`}>
          {fin.history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Receipt className="h-5 w-5 text-muted-foreground" />
              <span className="text-[12.5px] text-muted-foreground">No payments recorded yet</span>
            </div>
          ) : (
            fin.history.slice(0, 10).map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 py-3">
                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-[9px] ${p.is_reversal ? 'bg-muted text-muted-foreground' : 'bg-success/10 text-success'}`}>
                  {p.is_reversal ? <Undo2 className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-semibold ${p.is_reversal ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {p.is_reversal ? 'Payment reversed' : 'Payment received'}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </div>
                </div>
                <span className={`tabular-nums font-display text-[13.5px] font-bold ${p.is_reversal ? 'text-muted-foreground line-through' : 'text-success'}`}>
                  ₹{Number(p.amount_paid).toLocaleString('en-IN')}
                </span>
              </div>
            ))
          )}
        </div>
        {reversedPayments.length > 0 && (
          <div className="rounded-[13px] bg-[#FBF7F2] p-[13px]">
            <div className="flex items-center gap-2">
              <Undo2 className="h-3.5 w-3.5 text-[#9C9186]" />
              <span className="text-[11px] font-bold text-[#8A7F75]">Reversed · corrected by hostel</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {reversedPayments.length} payment{reversedPayments.length === 1 ? '' : 's'} above {reversedPayments.length === 1 ? 'was' : 'were'} reversed by your hostel — these amounts are not counted toward what you've paid.
            </p>
          </div>
        )}
      </div>

      <p className="pt-0.5 text-center text-[11px] font-medium text-[#B7AC9F]">Stayo{profile.hostel?.name ? ` · ${profile.hostel.name}` : ''}</p>

      <PaySheet
        stage={fin.payStage}
        amount={fin.amountDue}
        error={fin.payError}
        onClose={fin.closePay}
        onConfirm={fin.confirmPay}
      />
      </div>
    </div>
  );
}
