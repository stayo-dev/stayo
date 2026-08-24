import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { portfolioService } from '@features/dashboard/api';
import { tenantService } from '@features/tenants/api';
import { queryKeys } from '@lib/queryKeys';
import { useState } from 'react';
import { Archive } from 'lucide-react';
import { ArchiveHostelModal } from '@features/owner-dashboard/components/ArchiveHostelModal';

function formatLakh(value: number) {
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** Hostel Drill-down → Overview sub-tab, per Stayo App.dc.html. Real stats — reuses `portfolio/summary`'s per-hostel card (same query the Home dashboard already fetches, so no extra network call once that's warm). */
export function HostelOverviewPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary(),
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });

  const invitedQuery = useQuery({
    queryKey: [...queryKeys.owner.invitedCounts([hostelId ?? '']), 'single'],
    queryFn: () =>
      tenantService.getAll(hostelId!, { status: 'INVITED', limit: 1 }).then((r: any) => Number(r?.total ?? r?.tenants?.length ?? 0)),
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });

  if (!hostelId) return null;

  const card = (portfolioQuery.data?.hostels ?? []).find((h: any) => h.hostel_id === hostelId);
  const activeTenants = card?.active_tenants ?? 0;
  const totalCapacity = card?.total_capacity ?? 0;
  const pendingDues = card?.pending_dues ?? 0;
  const collectedRevenue = card?.collected_revenue ?? 0;
  const overdueCount = card?.overdue_count ?? 0;
  const vacantBeds = Math.max(0, totalCapacity - activeTenants);
  // `portfolioService.getSummary()` returns `name` (portfolio-service.ts);
  // `hostel_name` is the shape the *performance* service uses, kept as a
  // fallback rather than assumed.
  const hostelName: string = card?.name ?? card?.hostel_name ?? '';
  const invitedCount = invitedQuery.data ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[18px] bg-foreground">
        <div className="flex items-baseline justify-between px-4.5 pb-2.5 pt-4">
          <span className="font-display text-sm font-bold text-background">Today&apos;s focus</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-background/55">By severity</span>
        </div>
        {overdueCount > 0 && (
          <div className="flex items-center gap-2.5 border-t border-white/10 px-4.5 py-2.5">
            <span className="h-2 w-2 flex-none rounded-full bg-destructive" />
            <p className="text-[13px] text-background/90">
              <b className="font-display font-bold tabular-nums">{formatLakh(pendingDues)}</b> due · {overdueCount} tenants overdue
            </p>
          </div>
        )}
        {invitedCount > 0 && (
          <div className="flex items-center gap-2.5 border-t border-white/10 px-4.5 py-2.5">
            <span className="h-2 w-2 flex-none rounded-full bg-warning" />
            <p className="text-[13px] text-background/90">{invitedCount} invited tenants not yet activated</p>
          </div>
        )}
        {overdueCount === 0 && invitedCount === 0 && (
          <div className="border-t border-white/10 px-4.5 py-2.5">
            <p className="text-[13px] text-background/90">Nothing needs attention right now.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-[18px] border border-border bg-card p-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Beds</div>
          <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-foreground">
            {activeTenants}/{totalCapacity}
          </div>
        </div>
        <div className="rounded-[18px] border border-border bg-card p-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Due</div>
          <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-destructive">{formatLakh(pendingDues)}</div>
        </div>
        <div className="rounded-[18px] border border-border bg-card p-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Collected</div>
          <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-success">{formatLakh(collectedRevenue)}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate(`/owner/hostels/${hostelId}/rooms`)}
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
      >
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13.5px] font-bold text-foreground">Floor occupancy</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{vacantBeds} vacant beds across the property</div>
        </div>
        <span className="flex-none rounded-lg border-[1.5px] border-primary px-3.5 py-2 font-display text-xs font-bold text-primary">Open rooms</span>
      </button>

      <button
        type="button"
        onClick={() => navigate(`/owner/hostels/${hostelId}/tenants`)}
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
      >
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13.5px] font-bold text-foreground">Tenants</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {activeTenants} residents · {overdueCount} overdue
          </div>
        </div>
        <span className="flex-none rounded-lg border-[1.5px] border-primary px-3.5 py-2 font-display text-xs font-bold text-primary">Open tenants</span>
      </button>

      {/* A second entry point to the archive flow the dashboard's hostel menu
          already owns — the same `ArchiveHostelModal`, deliberately not a
          second confirmation UI for one destructive action. Being able to
          retire the hostel you are currently looking at is worth the extra
          door; two different-looking doors would not be.

          Last on the page on purpose, and held back until the name loads. */}
      {hostelName && (
        <>
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="mt-1 inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-xl px-2 font-display text-[12.5px] font-bold text-muted-foreground hover:text-destructive"
          >
            <Archive className="h-4 w-4" strokeWidth={2} />
            Archive this hostel
          </button>
          <ArchiveHostelModal
            open={archiveOpen}
            onClose={() => setArchiveOpen(false)}
            hostelId={hostelId}
            hostelName={hostelName}
            activeTenantsCount={activeTenants}
            outstandingDuesValue={pendingDues}
          />
        </>
      )}
    </div>
  );
}
