import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { platformAdminService } from '@features/platform-admin/api';
import { ADMIN_CARD } from '../theme/palette';
import { buildKpis, buildFunnel, conversionRate } from '../overview/overviewModel';

const POLL = { staleTime: 30_000, refetchInterval: 60_000 } as const;

export function OverviewPage() {
  const navigate = useNavigate();

  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => platformAdminService.getDashboard(),
    ...POLL,
  });
  // Admin -> Add Owner leads never appear in this funnel — it's explicitly
  // "From landing-page leads", not manual onboarding.
  const leads = useQuery({
    queryKey: ['admin', 'leads', 'counts'],
    queryFn: () => platformAdminService.getLeads({ source: 'WEBSITE', limit: 1 }),
    ...POLL,
  });
  const openTickets = useQuery({
    queryKey: ['admin', 'support-tickets', 'OPEN'],
    queryFn: () => platformAdminService.getSupportTickets('OPEN'),
    ...POLL,
  });
  const activity = useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => platformAdminService.getNotifications(),
    ...POLL,
  });

  const counts = leads.data?.counts ?? {};
  const openReportsCount = openTickets.data?.length;
  const kpis = buildKpis(dashboard.data?.kpis, openReportsCount);
  const funnel = buildFunnel(counts);

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-[22px]">
      {/* ── KPI row ─────────────────────────────────────────────── */}
      {/* Two-up even at phone widths — a single full-width card per metric
          reads as ten separate screens' worth of scrolling; two per row
          keeps the grid dashboard-shaped everywhere. */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 xl:grid-cols-3">
        {kpis.map((k) => (
          <div
            key={k.key}
            role={k.to ? 'button' : undefined}
            tabIndex={k.to ? 0 : undefined}
            onClick={k.to ? () => navigate(k.to!) : undefined}
            onKeyDown={k.to ? (e) => { if (e.key === 'Enter') navigate(k.to!); } : undefined}
            className={`${ADMIN_CARD} px-3 py-3 sm:px-[18px] sm:py-[17px] ${
              k.to ? 'cursor-pointer transition-colors hover:border-[#DCC9BE] hover:bg-[#FCFAF7]' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="text-[10.5px] font-semibold leading-tight text-[#8A7F75] sm:text-[12px]">
                {k.label}
              </div>
              {k.delta ? (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-[2px] font-admin text-[9.5px] font-bold sm:px-2 sm:py-[3px] sm:text-[10.5px] ${
                    k.deltaTone === 'amber' ? 'bg-[#FBF1DE] text-[#B8792B]' : 'bg-[#EAF3EE] text-[#1F7A52]'
                  }`}
                >
                  {k.delta}
                </span>
              ) : null}
            </div>
            <div
              className={`mt-1.5 font-admin text-[20px] font-extrabold tracking-[-0.03em] sm:mt-[9px] sm:text-[27px] ${
                k.unavailable ? 'text-[#C9BFB4]' : 'text-[#221E1A]'
              }`}
            >
              {k.value}
            </div>
            <div className="mt-0.5 text-[10.5px] text-[#A2978B] sm:text-[11.5px]">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── revenue trend + acquisition funnel ──────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate('/admin/revenue')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/admin/revenue'); }}
          className={`${ADMIN_CARD} cursor-pointer px-[22px] py-5 transition-colors hover:border-[#DCC9BE] hover:bg-[#FCFAF7]`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-admin text-[15px] font-bold tracking-[-0.01em] text-[#221E1A]">
                Platform revenue
              </div>
              <div className="mt-0.5 text-[12px] text-[#8A7F75]">Daily gross · last 14 days</div>
            </div>
            <span className="flex-none text-[12px] font-semibold text-[#B46A55]">View ›</span>
          </div>
          {/* The design charts 14 days of daily gross. No endpoint returns a
              date series — /platform-admin/revenue is point-in-time only — so
              the panel keeps its shape and says so rather than drawing bars
              from a number that isn't daily. */}
          <div className="mt-5 flex h-[190px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#DFD3C5] px-6 text-center">
            <div className="font-admin text-[14px] font-bold text-[#221E1A]">
              Daily revenue isn't measured yet
            </div>
            <div className="mt-1 max-w-[380px] text-[12px] leading-relaxed text-[#8A7F75]">
              This chart needs a per-day revenue series. The platform currently reports
              month-to-date totals only — shown in the cards above.
            </div>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate('/admin/leads')}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate('/admin/leads'); }}
          className={`${ADMIN_CARD} cursor-pointer px-[22px] py-5 transition-colors hover:border-[#DCC9BE] hover:bg-[#FCFAF7]`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-admin text-[15px] font-bold tracking-[-0.01em] text-[#221E1A]">
                Owner acquisition funnel
              </div>
              <div className="mt-0.5 text-[12px] text-[#8A7F75]">From landing-page leads</div>
            </div>
            <span className="flex-none text-[12px] font-semibold text-[#B46A55]">View ›</span>
          </div>

          <div className="mt-[18px] flex flex-col gap-2.5">
            {funnel.map((row) => (
              <div key={row.key}>
                <div className="mb-[5px] flex justify-between">
                  <span className="text-[12px] font-semibold text-[#4A433C]">{row.label}</span>
                  <span className="font-admin text-[12px] font-bold text-[#221E1A]">
                    {row.count.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="h-[9px] overflow-hidden rounded-full bg-[#F0EAE2]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: row.width, background: row.fill }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[#F2ECE5] pt-3.5">
            <span className="text-[12px] font-medium text-[#8A7F75]">Lead → owner conversion</span>
            <span className="font-admin text-[15px] font-extrabold text-[#1F7A52]">
              {conversionRate(counts)}
            </span>
          </div>
        </div>
      </div>

      {/* ── live activity ────────────────────────────────────────── */}
      <div className={`${ADMIN_CARD} px-[22px] py-5`}>
        <div className="font-admin text-[15px] font-bold tracking-[-0.01em] text-[#221E1A]">
          Live activity
        </div>
        <div className="mt-2 flex flex-col">
          {activity.isLoading ? (
            <div className="py-8 text-center text-[12px] text-[#8A7F75]">Loading activity…</div>
          ) : (activity.data ?? []).length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#8A7F75]">
              Nothing has happened on the platform yet today.
            </div>
          ) : (
            (activity.data ?? []).slice(0, 6).map((a, index) => (
              <div
                key={a.id}
                className={`flex gap-3 py-[11px] ${index > 0 ? 'border-t border-[#F2ECE5]' : ''}`}
              >
                <span
                  className="mt-[5px] h-2 w-2 flex-none rounded-full"
                  style={{ background: a.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-[#2A2521]">{a.title}</div>
                  <div className="mt-px text-[11px] text-[#9A8F84]">{a.sub}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
