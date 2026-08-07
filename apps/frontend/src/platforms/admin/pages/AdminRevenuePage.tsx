import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, IndianRupee, Search, TrendingUp, X } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';
import {
  describeArr,
  formatCompactINR,
  formatINR,
  hasRevenueActivity,
} from '../revenue/revenueFormat';

const card =
  'rounded-2xl border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]';

const STATUS_CHIP: Record<string, { chip: string; dot: string }> = {
  TRIAL: { chip: 'bg-info/10 text-info', dot: 'bg-info' },
  ACTIVE: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  RENEWAL_DUE: { chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  PAYMENT_FAILED: { chip: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  CANCELLED: { chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
};

const REVENUE_FILTERS = [
  { key: undefined, label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'TRIAL', label: 'Trial' },
  { key: 'RENEWAL_DUE', label: 'Renewal due' },
  { key: 'PAYMENT_FAILED', label: 'Payment failed' },
  { key: 'CANCELLED', label: 'Cancelled' },
] as const;

const EXPORTS: [string, string][] = [
  ['revenue', 'Revenue report'],
  ['subscriptions', 'Subscription report'],
  ['outstanding', 'Outstanding payments'],
  ['gst', 'GST / tax report'],
];

function StatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status] ?? STATUS_CHIP.TRIAL;
  return (
    <span className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status.replace('_', ' ')}
    </span>
  );
}

/**
 * Platform revenue.
 *
 * Rewritten because the screen had no empty state: with nothing sold it still
 * rendered eleven zeros, a search box, six status filters, a billing-cycle
 * toggle and four export buttons — controls that filter nothing and exports
 * that produce empty files — with "No hostels have a subscription yet" buried
 * underneath all of it.
 *
 * It also gave five money figures equal visual weight. MRR is the number the
 * business is run on; collected/pending/lifetime are context. ARR is MRR × 12
 * by definition, so it now says so rather than posing as an independent
 * measurement.
 */
export function AdminRevenuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [billingView, setBillingView] = useState<'ALL' | 'MONTHLY' | 'YEARLY'>('ALL');
  const [exporting, setExporting] = useState<string | null>(null);

  const revenueQuery = useQuery({
    queryKey: ['admin', 'revenue'],
    queryFn: () => platformAdminService.getRevenue(),
    staleTime: 15_000,
  });
  const hostelsQuery = useQuery({
    queryKey: ['admin', 'revenue-hostels', search, statusFilter],
    queryFn: () => platformAdminService.getRevenueHostels({ search: search || undefined, status: statusFilter }),
    staleTime: 15_000,
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (hostelId: string) => platformAdminService.recordInvoice(hostelId),
    onSuccess: () => {
      stayoToast.success('Payment recorded');
      queryClient.invalidateQueries({ queryKey: ['admin', 'revenue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'revenue-hostels'] });
    },
    onError: () => stayoToast.error('Could not record payment'),
  });

  const kpis = revenueQuery.data?.kpis;
  const metrics = revenueQuery.data?.metrics;
  const allHostels = hostelsQuery.data ?? [];
  const hostels = allHostels.filter((h) => billingView === 'ALL' || h.billing_cycle === billingView);

  const loading = revenueQuery.isLoading || hostelsQuery.isLoading;
  // Unfiltered, so an active filter never makes the page look like a platform
  // that has never sold anything.
  const hasActivity = hasRevenueActivity(kpis, allHostels.length);
  const filtered = Boolean(statusFilter) || billingView !== 'ALL' || Boolean(search);

  const runExport = async (report: string, label: string) => {
    setExporting(report);
    try {
      await platformAdminService.exportRevenueReport(report);
    } catch {
      // Silence here would look like a download that simply never arrived.
      stayoToast.error(`Could not export the ${label.toLowerCase()}`);
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-[116px] animate-pulse rounded-2xl bg-muted" />
          <div className="h-[116px] animate-pulse rounded-2xl bg-muted" />
        </div>
        <div className="mt-4 h-[76px] animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-7">
      {/* HEADLINE — MRR is the number the business is run on. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#8A7F75]">
            <IndianRupee className="h-3.5 w-3.5" strokeWidth={2.6} />
            Monthly recurring revenue
          </div>
          <div className="mt-2 font-display text-[32px] font-extrabold leading-none tabular-nums text-foreground">
            {formatINR(kpis?.mrr ?? 0)}
          </div>
          <div className="mt-1.5 text-[12px] text-[#8A7F75]">
            {metrics?.active_paying
              ? `${metrics.active_paying} paying hostel${metrics.active_paying === 1 ? '' : 's'}`
              : 'No paying hostels yet'}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#8A7F75]">
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={2.6} />
            Annual run rate
          </div>
          <div className="mt-2 font-display text-[32px] font-extrabold leading-none tabular-nums text-foreground">
            {formatINR(kpis?.arr ?? 0)}
          </div>
          {/* ARR is derived, not measured — say so. */}
          <div className="mt-1.5 text-[12px] text-[#8A7F75]">{describeArr(kpis) ?? 'Projected from MRR'}</div>
        </div>
      </div>

      {/* SECONDARY — context, deliberately lighter than the headline. */}
      <div className={`${card} mt-4 grid grid-cols-2 divide-x divide-[#F2ECE5] sm:grid-cols-3`}>
        {[
          ['Collected this month', kpis?.collected_this_month ?? 0, false],
          ['Pending collections', kpis?.pending_collections ?? 0, true],
          ['Lifetime revenue', kpis?.lifetime_revenue ?? 0, false],
        ].map(([label, value, warn], i) => (
          <div key={label as string} className={`px-4 py-3.5 ${i === 2 ? 'col-span-2 border-t border-[#F2ECE5] sm:col-span-1 sm:border-t-0' : ''}`}>
            <div className="text-[11px] font-semibold text-[#8A7F75]">{label as string}</div>
            <div
              className={`mt-1 font-display text-[19px] font-extrabold tabular-nums ${
                warn && Number(value) > 0 ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {formatINR(Number(value))}
            </div>
          </div>
        ))}
      </div>

      {/* PORTFOLIO — counts, not money, so they never read as rupees. */}
      {metrics && hasActivity && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 rounded-[14px] border border-[#EFE6DA] bg-white px-4 py-3">
          {[
            ['Active hostels', metrics.active_hostels],
            ['Paying', metrics.active_paying],
            ['On trial', metrics.trial_hostels],
            ['Tenants', metrics.active_tenants],
            ['Cancelled', metrics.cancelled],
          ].map(([label, value]) => (
            <div key={label as string} className="flex items-baseline gap-1.5">
              <span className="font-display text-[16px] font-extrabold tabular-nums text-foreground">{value as number}</span>
              <span className="text-[11.5px] font-semibold text-[#8A7F75]">{label as string}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nothing sold yet: one honest explanation instead of a full working
          screen whose every control is inert. */}
      {!hasActivity ? (
        <div className={`${card} mt-4 px-5 py-14 text-center`}>
          <IndianRupee className="mx-auto mb-3 h-9 w-9 text-[#C9BDB1]" strokeWidth={1.6} />
          <p className="font-display text-[16px] font-extrabold text-foreground">No subscriptions yet</p>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-[#8A7F75]">
            Once a hostel goes live and starts a plan, its billing appears here — along with collections,
            renewals and the exports.
          </p>
          <button
            type="button"
            onClick={() => navigate('/admin/hostels')}
            className="mt-4 rounded-[10px] border border-[#E7DDD1] bg-white px-4 py-2.5 text-[12.5px] font-bold text-foreground hover:border-primary hover:text-primary"
          >
            View hostels
          </button>
        </div>
      ) : (
        <>
          {/* CONTROLS — only rendered when there is something to control. */}
          <div className="mb-3.5 mt-5 flex flex-wrap items-center gap-2.5">
            <div className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded-[11px] border border-[#E7DDD1] bg-white px-3 sm:max-w-[280px]">
              <Search className="h-4 w-4 flex-none text-[#9C9186]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search hostel…"
                className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                  <X className="h-3.5 w-3.5 text-[#9C9186]" />
                </button>
              )}
            </div>

            {/* Labelled and grouped with the other filters. It used to float
                right unlabelled, reading like a chart period selector. */}
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] font-semibold text-[#9C9186]">Billing</span>
              <div className="flex h-9 rounded-[10px] bg-[#F0EBE4] p-[3px]">
                {(['ALL', 'MONTHLY', 'YEARLY'] as const).map((cycle) => (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setBillingView(cycle)}
                    className={`rounded-lg px-3 text-[12px] font-bold ${
                      billingView === cycle ? 'bg-white text-foreground shadow-sm' : 'text-[#8A7F75]'
                    }`}
                  >
                    {cycle === 'ALL' ? 'All' : cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {REVENUE_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  statusFilter === f.key
                    ? 'bg-foreground text-background'
                    : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {hostels.map((h) => (
              <div
                key={h.hostel_id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/admin/hostels?open=${h.hostel_id}`)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(`/admin/hostels?open=${h.hostel_id}`)}
                className={`${card} cursor-pointer p-4`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-bold text-foreground">{h.hostel_name}</span>
                  <StatusChip status={h.status} />
                </div>
                <div className="mt-1 truncate text-[12px] text-[#8A7F75]">
                  {h.plan_name} · {h.billing_cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'} · {formatINR(h.amount)}
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-[#F2ECE5] pt-2.5 text-[12px]">
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">Next renewal</div>
                    <div className="font-bold text-foreground">
                      {h.next_renewal_at ? new Date(h.next_renewal_at).toLocaleDateString('en-IN') : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">AutoPay</div>
                    <div className={`font-bold ${h.autopay_enabled ? 'text-success' : 'text-foreground'}`}>
                      {h.autopay_enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">Collected</div>
                    <div className="font-bold text-foreground">{formatCompactINR(h.collected)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">Outstanding</div>
                    <div className={`font-bold ${h.dues > 0 ? 'text-destructive' : 'text-foreground'}`}>
                      {formatCompactINR(h.dues)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    recordPaymentMutation.mutate(h.hostel_id);
                  }}
                  disabled={recordPaymentMutation.isPending}
                  className="mt-2.5 h-9 w-full rounded-lg border border-[#E7DDD1] bg-white text-[12px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary disabled:opacity-60"
                >
                  {recordPaymentMutation.isPending ? 'Recording…' : 'Record subscription payment'}
                </button>
              </div>
            ))}

            {hostels.length === 0 && (
              <div className="col-span-full rounded-[14px] border border-[#EFE6DA] bg-white py-12 text-center">
                <AlertTriangle className="mx-auto mb-2.5 h-7 w-7 text-[#C9BDB1]" strokeWidth={1.7} />
                <p className="text-[13.5px] font-bold text-foreground">No hostels match this filter</p>
                {filtered && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter(undefined);
                      setBillingView('ALL');
                      setSearch('');
                    }}
                    className="mt-2 text-[12.5px] font-bold text-primary underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={`${card} mt-4 p-5`}>
            <div className="mb-1 font-display text-[14.5px] font-bold text-foreground">Export</div>
            <p className="mb-3 text-[12px] text-[#8A7F75]">Downloads a CSV of everything currently on the platform.</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {EXPORTS.map(([report, label]) => (
                <button
                  key={report}
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => runExport(report, label)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] border border-[#E7DDD1] bg-white text-[12.5px] font-bold text-foreground hover:border-primary disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting === report ? 'Preparing…' : label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
