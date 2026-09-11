import { useQuery } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { DataTable, EmptyState, StatCard, type DataColumn } from '../ui';
import { adminError, formatPaise, planLabel, revenueTiles } from '../billing/subscriptionAdminView';

const PLAN_COLUMNS: DataColumn[] = [
  { key: 'plan', label: 'Plan', width: '2.4fr' },
  { key: 'owners', label: 'Owners', width: '0.8fr' },
  { key: 'mrr', label: 'Plan MRR', width: '1fr' },
];

/**
 * Stayo SUBSCRIPTION revenue only (ADR-172, Phase 5) — what owners pay Stayo.
 * Deliberately NOT tenant rent (a separate stream), NOT GST. Reads the
 * owner-level `/api/platform-admin/revenue` endpoint.
 */
export function RevenuePage() {
  const rev = useQuery({
    queryKey: ['admin', 'subscription-revenue'],
    queryFn: () => platformAdminService.getSubscriptionRevenue(),
    staleTime: 60_000,
  });

  if (rev.isLoading) return <div className="p-6 text-[13px] text-[#8A7F75]">Loading revenue…</div>;
  if (rev.isError || !rev.data)
    return (
      <div className="p-6">
        <EmptyState title="Could not load revenue" message={adminError(rev.error)} />
      </div>
    );

  const d = rev.data;
  const t = revenueTiles(d);

  return (
    <div className="flex flex-col gap-5 p-5 lg:p-7">
      <p className="text-[12px] text-[#7A6F63]">
        <span className="font-semibold text-[#221E1A]">Stayo subscription revenue</span> — what owners pay Stayo to use the
        platform. This is separate from tenant rent (which owners collect from their tenants and is shown under Settlements /
        Owners). No GST is applied.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="MRR" value={t.mrr} sub="active subscriptions" />
        <StatCard label="ARR" value={t.arr} />
        <StatCard label="Collected this month" value={t.collectedThisMonth} sub={`${d.kpis?.invoices_this_month ?? 0} invoices`} />
        <StatCard label="Lifetime collected" value={t.lifetime} sub={`${d.kpis?.invoices_lifetime ?? 0} invoices`} />
        <StatCard label="Active subscriptions" value={String(t.activeSubs)} />
        <StatCard label="Payments to review" value={String(t.pendingReview)} valueTone={t.pendingReview > 0 ? 'amber' : 'ink'} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Pending payment" value={String(d.subscriptions?.pending_payment ?? 0)} />
        <StatCard label="Paused" value={String(d.subscriptions?.paused ?? 0)} />
        <StatCard label="Expired" value={String(d.subscriptions?.expired ?? 0)} />
        <StatCard label="Cancelled" value={String(d.subscriptions?.cancelled ?? 0)} />
        <StatCard label="Approved payments" value={String(d.payments?.approved ?? 0)} />
        <StatCard label="Rejected payments" value={String(d.payments?.rejected ?? 0)} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#8A7F75]">Plan distribution</h2>
        <DataTable
          columns={PLAN_COLUMNS}
          rows={(d.plan_distribution ?? []).map((p: any, i: number) => ({ ...p, id: p.code ?? `plan-${i}` }))}
          empty="No subscriptions yet."
          renderCell={(row: any, key) => {
            switch (key) {
              case 'plan':
                return <span className="text-[12.5px] text-[#221E1A]">{planLabel(row)}</span>;
              case 'owners':
                return <span className="text-[12.5px] font-semibold text-[#221E1A]">{row.owners}</span>;
              case 'mrr':
                return (
                  <span className="text-[12.5px] text-[#5A5147]">
                    {row.price_paise != null ? formatPaise(row.price_paise * row.owners) : '—'}
                  </span>
                );
              default:
                return null;
            }
          }}
        />
      </section>
    </div>
  );
}
