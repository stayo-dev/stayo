import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';

const card = 'rounded-2xl border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]';
const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

const STATUS_CHIP: Record<string, { chip: string; dot: string }> = {
  TRIAL: { chip: 'bg-info/10 text-info', dot: 'bg-info' },
  ACTIVE: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  RENEWAL_DUE: { chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  PAYMENT_FAILED: { chip: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  CANCELLED: { chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
};
const REVENUE_FILTERS = [
  { key: undefined, label: 'All', active: 'bg-foreground text-background', inactive: 'border border-[#E7DDD1] bg-white text-[#8A7F75]' },
  { key: 'ACTIVE', label: 'Active', active: 'bg-success text-white', inactive: 'border border-success/30 bg-success/10 text-success' },
  { key: 'TRIAL', label: 'Trial', active: 'bg-info text-white', inactive: 'border border-info/30 bg-info/10 text-info' },
  { key: 'RENEWAL_DUE', label: 'Renewal Due', active: 'bg-warning text-white', inactive: 'border border-warning/30 bg-warning/10 text-warning' },
  { key: 'PAYMENT_FAILED', label: 'Payment Failed', active: 'bg-destructive text-white', inactive: 'border border-destructive/30 bg-destructive/10 text-destructive' },
  { key: 'CANCELLED', label: 'Cancelled', active: 'bg-muted-foreground text-white', inactive: 'border border-[#E7DDD1] bg-white text-[#8A7F75]' },
] as const;

function StatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status] ?? STATUS_CHIP.TRIAL;
  return (
    <span className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status.replace('_', ' ')}
    </span>
  );
}

export function AdminRevenuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [billingView, setBillingView] = useState<'ALL' | 'MONTHLY' | 'YEARLY'>('ALL');

  const revenueQuery = useQuery({ queryKey: ['admin', 'revenue'], queryFn: () => platformAdminService.getRevenue(), staleTime: 15_000 });
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
  const hostels = (hostelsQuery.data ?? []).filter((h) => billingView === 'ALL' || h.billing_cycle === billingView);

  return (
    <div className="mx-auto max-w-[1200px] px-7 py-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {kpis && [
          ['MRR', fmtINR(kpis.mrr)],
          ['ARR', fmtINR(kpis.arr)],
          ['Collected This Month', fmtINR(kpis.collected_this_month)],
          ['Pending Collections', fmtINR(kpis.pending_collections)],
          ['Lifetime Revenue', fmtINR(kpis.lifetime_revenue)],
        ].map(([label, value]) => (
          <div key={label} className={`${card} p-[18px]`}>
            <div className="text-[11.5px] font-semibold text-[#8A7F75]">{label}</div>
            <div className="mt-2 font-display text-[21px] font-extrabold tabular-nums text-foreground">{value}</div>
          </div>
        ))}
      </div>

      {metrics && (
        <div className="mt-[18px] flex flex-wrap gap-2.5 rounded-[14px] border border-[#EFE6DA] bg-white px-[18px] py-3.5">
          {[
            ['Active Hostels', metrics.active_hostels],
            ['Active Paying', metrics.active_paying],
            ['Active Tenants', metrics.active_tenants],
            ['Trial Hostels', metrics.trial_hostels],
            ['Cancelled', metrics.cancelled],
          ].map(([label, value]) => (
            <div key={label as string} className="flex-1 min-w-[110px] px-2 py-1.5 text-center">
              <div className="font-display text-[19px] font-extrabold text-foreground">{value}</div>
              <div className="mt-0.5 text-[11px] font-semibold text-[#8A7F75]">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3.5 mt-[22px] flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-[260px] items-center gap-2 rounded-[11px] border border-[#E7DDD1] bg-white px-3">
          <Search className="h-4 w-4 text-[#9C9186]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hostel…" className="w-full bg-transparent text-[13px] text-foreground outline-none" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REVENUE_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${statusFilter === f.key ? f.active : f.inactive}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex h-10 w-[150px] flex-none rounded-[11px] bg-[#F0EBE4] p-[3px]">
          {(['MONTHLY', 'YEARLY'] as const).map((cycle) => (
            <button
              key={cycle}
              type="button"
              onClick={() => setBillingView((v) => (v === cycle ? 'ALL' : cycle))}
              className={`flex-1 rounded-lg text-[12px] font-bold ${billingView === cycle ? 'bg-white text-foreground shadow-sm' : 'text-[#8A7F75]'}`}
            >
              {cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
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
            <div className="mt-1 text-[12px] text-[#8A7F75]">{h.plan_name} · {h.billing_cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'} · {fmtINR(h.amount)}</div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-[#F2ECE5] pt-2.5 text-[12px]">
              <div><div className="text-[10px] font-semibold text-[#9C9186]">Next Renewal</div><div className="font-bold text-foreground">{h.next_renewal_at ? new Date(h.next_renewal_at).toLocaleDateString('en-IN') : '—'}</div></div>
              <div><div className="text-[10px] font-semibold text-[#9C9186]">AutoPay</div><div className={`font-bold ${h.autopay_enabled ? 'text-success' : 'text-foreground'}`}>{h.autopay_enabled ? 'Enabled' : 'Disabled'}</div></div>
              <div><div className="text-[10px] font-semibold text-[#9C9186]">Collected</div><div className="font-bold text-foreground">{fmtINR(h.collected)}</div></div>
              <div><div className="text-[10px] font-semibold text-[#9C9186]">Outstanding</div><div className={`font-bold ${h.dues > 0 ? 'text-destructive' : 'text-foreground'}`}>{fmtINR(h.dues)}</div></div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                recordPaymentMutation.mutate(h.hostel_id);
              }}
              disabled={recordPaymentMutation.isPending}
              className="mt-2.5 h-9 w-full rounded-lg border border-[#E7DDD1] bg-white text-[12px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary"
            >
              Record subscription payment
            </button>
          </div>
        ))}
        {hostels.length === 0 && (
          <div className="col-span-full py-12 text-center text-[13.5px] text-[#9C9186]">
            {statusFilter || billingView !== 'ALL' ? 'No hostels match this filter.' : 'No hostels have a subscription yet.'}
          </div>
        )}
      </div>

      <div className={`${card} mt-4 p-5`}>
        <div className="mb-3 font-display text-[14.5px] font-bold text-foreground">Export</div>
        <div className="flex flex-wrap gap-2.5">
          {[
            ['revenue', 'Export Revenue Report'],
            ['subscriptions', 'Export Subscription Report'],
            ['outstanding', 'Export Outstanding Payments'],
            ['gst', 'Export GST/Tax Report'],
          ].map(([report, label]) => (
            <button
              key={report}
              type="button"
              onClick={() => platformAdminService.exportRevenueReport(report)}
              className="h-11 min-w-[200px] flex-1 rounded-[11px] border border-[#E7DDD1] bg-white text-[12.5px] font-bold text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
