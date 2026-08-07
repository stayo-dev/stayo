import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Building2, ShieldAlert, Home, UserCheck, IndianRupee, Wallet, AlertTriangle } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';
import { canApprove, canReject, STATUS_LABEL, STATUS_TONE } from '../leads/leadQueue';

// Exact card treatment from Stayo Admin.dc.html: #fff bg, 1px #EFE6DA border,
// 16px radius, two-layer shadow (a tight 1px hairline + a soft 30px lift).
const card = 'rounded-2xl border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]';
const LISTING_CHIP: Record<string, { chip: string; dot: string }> = {
  DRAFT: { chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
  LIVE: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  SUSPENDED: { chip: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};
// Same tone→class mapping as AdminLeadsPage's TONE_CHIP, kept local since it's presentational.
const LEAD_TONE_CHIP: Record<string, string> = {
  action: 'bg-primary/12 text-primary',
  progress: 'bg-info/12 text-info',
  done: 'bg-success/12 text-success',
  dead: 'bg-[#C0503A]/10 text-[#C0503A]',
};
const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const fmtTime = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => platformAdminService.getDashboard(), staleTime: 15_000 });
  const d = dashboardQuery.data;

  // Rejecting is deliberately NOT done from here. It used to call
  // updateLeadStatus(id,'LOST') — the silent path — while the Leads page
  // required a reason and told the applicant: two behaviours for one action in
  // the same console. The button now hands over to the Leads queue, which
  // captures the reason.

  const leadApproveMutation = useMutation({
    mutationFn: (id: string) => platformAdminService.approveLead(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
      if (result.whatsapp_sent) stayoToast.success('Activation link sent via WhatsApp');
      else if (result.email_sent) stayoToast.success('Activation link sent via email');
      else stayoToast.error(result.email_error || result.whatsapp_error || 'Approved, but the activation link could not be sent');
    },
    onError: (error: any) => stayoToast.error(error?.response?.data?.error?.message || 'Could not approve lead'),
  });

  if (dashboardQuery.isLoading || !d) {
    return (
      <div className="mx-auto max-w-[1360px] px-7 py-7">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      </div>
    );
  }

  // Per-KPI icon color, matching the mockup's varied {{k.bg}}/{{k.fg}}
  // per row rather than one uniform tone for all 8.
  const kpiRows = [
    { label: 'New Leads', value: d.kpis.new_leads, icon: Users, to: '/admin/leads', bg: 'bg-info/10', fg: 'text-info' },
    { label: 'Pending Approvals', value: d.kpis.pending_approvals, icon: ShieldAlert, to: '/admin/hostels', bg: 'bg-warning/10', fg: 'text-warning' },
    { label: 'Active Hostels', value: d.kpis.active_hostels, icon: Building2, to: '/admin/hostels', bg: 'bg-success/10', fg: 'text-success' },
    { label: 'Total Tenants', value: d.kpis.total_tenants, icon: Home, to: '/admin/hostels', bg: 'bg-info/10', fg: 'text-info' },
    { label: 'Active Tenants', value: d.kpis.active_tenants, icon: UserCheck, to: '/admin/hostels', bg: 'bg-warning/10', fg: 'text-warning' },
    { label: 'Platform Revenue', value: fmtINR(d.kpis.platform_revenue), icon: IndianRupee, to: '/admin/revenue', bg: 'bg-primary/10', fg: 'text-primary' },
    { label: 'Collections', value: fmtINR(d.kpis.collections), icon: Wallet, to: '/admin/revenue', bg: 'bg-success/10', fg: 'text-success' },
    { label: 'Pending Dues', value: fmtINR(d.kpis.pending_dues), icon: AlertTriangle, to: '/admin/revenue', bg: 'bg-destructive/10', fg: 'text-destructive' },
  ];

  return (
    <div className="mx-auto max-w-[1360px] px-7 py-7">
      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1fr_380px]">
        {/* Left column — Leads preview, Recent Activity */}
        <div className="flex flex-col gap-[18px] lg:order-1">
          <div className={`${card} p-5`}>
            <div className="mb-3.5 flex items-center justify-between">
              <span className="font-display text-[14.5px] font-bold text-foreground">Owner Leads</span>
              <button type="button" onClick={() => navigate('/admin/leads')} className="text-[12.5px] font-bold text-primary">View all →</button>
            </div>
            {d.leads_preview.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No leads yet.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {d.leads_preview.map((l: any) => {
                  // Scoped to this lead's id — mutation.isPending alone is
                  // shared across every row, so without this every card's
                  // button lit up "Sending…" whenever any one lead was
                  // approved. See docs/obsidian/Bugs.md.
                  const isApproving = leadApproveMutation.isPending && leadApproveMutation.variables === l.id;
                  const tone = STATUS_TONE[l.status] ?? 'action';
                  return (
                    <div key={l.id} className="rounded-[13px] border border-[#EFE6DA] px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-bold text-foreground">{l.name}</div>
                          <div className="mt-0.5 text-[12px] text-[#8A7F75]">{l.hostel_name}</div>
                          <div className="mt-1.5 text-[12px] tabular-nums text-[#8A7F75]">{l.phone}</div>
                        </div>
                        <div className="flex flex-none flex-col items-end gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LEAD_TONE_CHIP[tone]}`}>
                            {STATUS_LABEL[l.status] ?? l.status}
                          </span>
                          {l.created_at && <span className="whitespace-nowrap text-[11px] text-[#9C9186]">{fmtTime(l.created_at)}</span>}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        {canApprove(l.status) && (
                          <button
                            type="button"
                            onClick={() => leadApproveMutation.mutate(l.id)}
                            disabled={isApproving}
                            className="h-8 flex-1 rounded-lg bg-success text-[12px] font-bold text-white disabled:opacity-60"
                          >
                            {isApproving ? 'Sending…' : l.status === 'APPROVED' ? 'Retry Send' : 'Approve'}
                          </button>
                        )}
                        {canReject(l.status) && (
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/leads?reject=${l.id}`)}
                            className="h-8 flex-1 rounded-lg border border-[#EAD0C9] bg-white text-[12px] font-bold text-[#C0503A]"
                          >
                            Reject
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate('/admin/leads')}
                          className="h-8 flex-1 rounded-lg border border-[#E7DDD1] bg-white text-[12px] font-bold text-[#8A7F75]"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`${card} p-5`}>
            <div className="mb-3.5 font-display text-[14.5px] font-bold text-foreground">Recent Activity</div>
            {d.activity.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No recent activity.</p>
            ) : (
              <div className="flex flex-col">
                {d.activity.map((a: any, i: number) => (
                  <div key={a.id} className="flex gap-3.5 pb-4">
                    <div className="flex flex-none flex-col items-center">
                      <span
                        className="mt-0.5 h-2.5 w-2.5 flex-none rounded-full"
                        style={{ background: a.color ?? 'var(--primary)', boxShadow: `0 0 0 4px color-mix(in srgb, ${a.color ?? 'var(--primary)'} 16%, transparent)` }}
                      />
                      {i < d.activity.length - 1 && <span className="mt-1 w-[2px] flex-1 bg-[#EDE7DF]" />}
                    </div>
                    <div className="min-w-0 pb-0.5">
                      <div className="text-[11px] font-bold tracking-wide text-[#9C9186]">{fmtTime(a.time)}</div>
                      <div className="mt-0.5 text-[13px] font-bold text-foreground">{a.title}</div>
                      <div className="mt-0.5 text-[12.5px] text-[#8A7F75]">{a.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — KPI overview, Revenue Summary, Hostel Health */}
        <div className="flex flex-col gap-[18px] lg:order-2">
          <div className={`${card} p-1.5`}>
            <div className="px-3.5 pb-1.5 pt-3 text-[12.5px] font-bold uppercase tracking-[0.04em] text-[#9C9186]">Overview</div>
            <div className="flex flex-col">
              {kpiRows.map(({ label, value, icon: Icon, to, bg, fg }) => (
                <button key={label} type="button" onClick={() => navigate(to)} className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left hover:bg-[#F7F3EF]">
                  <span className={`flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] ${bg} ${fg}`}><Icon className="h-4 w-4" /></span>
                  <span className="flex-1 text-[12.5px] font-semibold text-[#8A7F75]">{label}</span>
                  <span className="font-display text-[16px] font-extrabold tabular-nums text-foreground">{value}</span>
                </button>
              ))}
            </div>
          </div>

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
