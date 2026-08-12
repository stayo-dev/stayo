import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { deriveAttention, deriveSnapshot } from '@features/platform-admin/dashboard/needsAttention';
import { deriveOwnerHealth, matchesFilter } from '@features/platform-admin/owners/ownerHealth';

// Exact card treatment from Stayo Admin.dc.html: #fff bg, 1px #EFE6DA border,
// 16px radius, two-layer shadow (a tight 1px hairline + a soft 30px lift).
const card = 'rounded-2xl border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]';
const LISTING_CHIP: Record<string, { chip: string; dot: string }> = {
  DRAFT: { chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
  LIVE: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  SUSPENDED: { chip: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};
const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const dashboardQuery = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => platformAdminService.getDashboard(), staleTime: 15_000 });
  // Owner-level attention can't come from the KPI endpoint — it is derived
  // from each owner's own signals, so the count is computed from the same
  // list the Owners screen renders.
  const ownersQuery = useQuery({
    queryKey: ['platform-admin', 'owners', ''],
    queryFn: () => platformAdminService.getOwners({ limit: 100 }),
    staleTime: 30_000,
  });
  const d = dashboardQuery.data;

  const ownersNeedingAttention = (ownersQuery.data?.owners ?? []).filter((o: any) =>
    matchesFilter(
      deriveOwnerHealth({
        id: String(o.id),
        name: String(o.name ?? ''),
        joinedAt: o.joined_at ? String(o.joined_at) : null,
        hostels: Number(o.hostels ?? 0),
        hostelsLive: Number(o.hostels_live ?? 0),
        hostelsAwaitingApproval: Number(o.hostels_awaiting_approval ?? 0),
        tenants: Number(o.tenants ?? 0),
        activeTenants: Number(o.active_tenants ?? 0),
        capacity: Number(o.capacity ?? 0),
        collectedThisMonth: Number(o.collected_this_month ?? 0),
        outstanding: Number(o.outstanding ?? 0),
        documentsSubmitted: Number(o.documents_submitted ?? 0),
        documentsVerified: Boolean(o.documents_verified),
        documentsRejected: Boolean(o.documents_rejected),
        mrr: Number(o.mrr ?? 0),
        subscriptionStatuses: Array.isArray(o.subscription_statuses) ? o.subscription_statuses.map(String) : [],
      }),
      'attention',
    ),
  ).length;

  if (dashboardQuery.isLoading || !d) {
    return (
      <div className="mx-auto max-w-[1360px] px-7 py-7">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      </div>
    );
  }

  const attention = deriveAttention(d.kpis as any, ownersNeedingAttention);
  const snapshot = deriveSnapshot(d.kpis as any, fmtINR);

  return (
    <div className="mx-auto max-w-[1360px] px-7 py-7">
      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[380px_1fr]">
        {/* Left column — what needs the admin, then the platform's own numbers */}
        <div className="flex flex-col gap-[18px] lg:order-1">
          {/* Only rendered when something is actually queued: a permanent
              "0 pending" row teaches people to skip this section. */}
          {attention.length > 0 && (
            <div className={`${card} p-1.5`}>
              <div className="px-3.5 pb-1.5 pt-3 text-[12.5px] font-bold uppercase tracking-[0.04em] text-[#9C9186]">Needs you</div>
              <div className="flex flex-col">
                {attention.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => navigate(item.to)}
                    className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left hover:bg-[#F7F3EF]"
                  >
                    <span
                      className={`flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] ${
                        item.severity === 'high' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
                      }`}
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-[12.5px] font-semibold text-foreground">{item.label}</span>
                    <ChevronRight className="h-4 w-4 flex-none text-[#9C9186]" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`${card} p-1.5`}>
            <div className="px-3.5 pb-1.5 pt-3 text-[12.5px] font-bold uppercase tracking-[0.04em] text-[#9C9186]">Platform</div>
            <div className="grid grid-cols-2">
              {snapshot.map((figure) => (
                <button
                  key={figure.label}
                  type="button"
                  onClick={() => navigate(figure.to)}
                  className="rounded-[11px] px-3 py-2.5 text-left hover:bg-[#F7F3EF]"
                >
                  <span className="block text-[11.5px] font-semibold text-[#8A7F75]">{figure.label}</span>
                  <span className="mt-0.5 block font-display text-[19px] font-extrabold tabular-nums text-foreground">
                    {figure.value}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column — Revenue Summary, Hostel Health */}
        <div className="flex flex-col gap-[18px] lg:order-2">
          <div className={`${card} p-5`}>
            <div className="mb-3.5 flex items-center justify-between">
              <span className="font-display text-[14.5px] font-bold text-foreground">Revenue Summary</span>
              <button type="button" onClick={() => navigate('/admin/revenue')} className="text-[12.5px] font-bold text-primary">Details →</button>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              {[
                ['Total Revenue', fmtINR(d.revenue_summary.total_revenue)],
                ['Platform Earnings', fmtINR(d.revenue_summary.platform_earnings)],
                ['Pending Collections', fmtINR(d.revenue_summary.pending_collections)],
                ['This Month', fmtINR(d.revenue_summary.this_month)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[11px] font-semibold text-[#8A7F75]">{label}</div>
                  <div className="mt-0.5 font-display text-[18px] font-extrabold tabular-nums text-foreground">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${card} p-5`}>
            <div className="mb-3.5 flex items-center justify-between">
              <span className="font-display text-[14.5px] font-bold text-foreground">Hostel Health</span>
              <button type="button" onClick={() => navigate('/admin/hostels')} className="text-[12.5px] font-bold text-primary">View all →</button>
            </div>
            {d.hostels_preview.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No hostels yet.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {d.hostels_preview.map((h: any) => {
                  const chip = LISTING_CHIP[h.listing_status] ?? LISTING_CHIP.DRAFT;
                  return (
                    <div key={h.id} className="rounded-[13px] border border-[#EFE6DA] px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-bold text-foreground">{h.name}</span>
                        <span className={`flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />
                          {h.listing_status}
                        </span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-4 gap-1.5 border-t border-[#F2ECE5] pt-2.5">
                        <div><div className="text-[9.5px] font-semibold text-[#9C9186]">Tenants</div><div className="text-[12.5px] font-bold text-foreground">{h.tenants}</div></div>
                        <div><div className="text-[9.5px] font-semibold text-[#9C9186]">Occ.</div><div className="text-[12.5px] font-bold text-foreground">{h.occupancy}%</div></div>
                        <div><div className="text-[9.5px] font-semibold text-[#9C9186]">Revenue</div><div className="text-[12.5px] font-bold text-foreground">{fmtINR(h.revenue)}</div></div>
                        <div><div className="text-[9.5px] font-semibold text-[#9C9186]">Dues</div><div className={`text-[12.5px] font-bold ${h.dues > 0 ? 'text-destructive' : 'text-foreground'}`}>{fmtINR(h.dues)}</div></div>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/hostels?open=${h.id}`)}
                        className="mt-2.5 h-[30px] w-full rounded-lg border border-[#E7DDD1] bg-white text-[12px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary"
                      >
                        Open Hostel
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
