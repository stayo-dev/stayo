import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { portfolioService } from '@features/dashboard/api';
import { queryKeys } from '@lib/queryKeys';
import { APP_SURFACE } from '@shared/ui/surface';

const TABS = [
  { to: 'overview', label: 'Overview' },
  { to: 'rooms', label: 'Rooms' },
  { to: 'tenants', label: 'Tenants' },
  { to: 'marketing', label: 'Marketing' },
  { to: 'settings', label: 'Settings' },
];

/**
 * Hostel Drill-down shell — back-to-Properties + hostel name/status + tab
 * sub-nav + Outlet. A full-screen takeover with its own back button, mounted
 * outside `OwnerAppShell` — same treatment as `TenantDetailPage`.
 *
 * Everything configurable about *this* hostel lives on the Settings tab: it
 * moved out of the Configure section, where a multi-hostel owner could edit
 * one hostel's rules while looking at another's name. Establishing the hostel
 * by navigation is the same protection the backend's architectural invariants
 * enforce server-side (never fall back to "first hostel").
 *
 * The tab row scrolls. Five fixed-width tabs need more than a 360px phone has,
 * and a row that overflows silently is how the tenant nav hid its sixth tab
 * entirely — see [[Bugs]] 2026-08-30. `snap-x` plus a visible edge keeps the
 * overflow discoverable rather than invisible.
 */
export function HostelDrilldownLayout() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();

  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary(),
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });

  const card = (portfolioQuery.data?.hostels ?? []).find((h: any) => h.hostel_id === hostelId);
  const isRunning = card ? card.status === 'ACTIVE' && card.is_active : undefined;

  return (
    <ThemeProvider theme="product">
      <div className={APP_SURFACE}>
        <div className="flex items-center gap-2.5 px-4 pb-1.5 pt-6 sm:px-6">
          <button type="button" onClick={() => navigate('/owner/home')} aria-label="Back" className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-full border border-border bg-card">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          </button>
          <span className="text-[13px] font-medium text-muted-foreground">Properties</span>
        </div>

        <div className="px-4 pb-2.5 pt-1 sm:px-6">
          <h1 className="font-display text-[21px] font-extrabold tracking-tight text-foreground">{card?.name ?? 'Hostel'}</h1>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${isRunning === false ? 'bg-muted-foreground' : 'bg-success'}`} />
            <span className="text-[12.5px] text-muted-foreground">
              {card?.city ?? '—'} · {isRunning === false ? 'Inactive' : 'Running'}
            </span>
          </div>
        </div>

        <div className="flex gap-5 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:gap-5.5 sm:px-6 [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `-mb-px flex-none whitespace-nowrap border-b-2 pb-2.5 font-display text-[13px] font-bold ${isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        <div className="px-4 py-4 sm:px-6">
          {/* The layout already resolved this hostel for its header — pass the
              name down so a tab does not fetch it a second time. */}
          <Outlet context={{ hostelName: card?.name ?? 'this hostel' }} />
        </div>
      </div>
    </ThemeProvider>
  );
}
