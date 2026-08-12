import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Building2, Search, X } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import {
  compareByUrgency,
  deriveOwnerHealth,
  healthDimensions,
  matchesFilter,
  type OwnerFilter,
  type OwnerHealth,
  type OwnerSignals,
} from '@features/platform-admin/owners/ownerHealth';

/**
 * Owners — the platform's customers, and the admin's primary list.
 *
 * Replaces Hostels as the top-level destination. A hostel is a child of an
 * owner, so listing properties made one owner with three hostels read as three
 * unrelated rows with no way to see the business behind them.
 *
 * Every row leads with the *reason* it needs attention rather than a wall of
 * metrics, and the list is ordered worst-first — with hundreds of owners the
 * admin should never scroll to find the problem.
 */

const FILTERS: Array<{ key: OwnerFilter; label: string; active: string; inactive: string }> = [
  { key: 'attention', label: 'Needs you', active: 'bg-warning text-white', inactive: 'border border-warning/30 bg-warning/10 text-warning' },
  { key: 'all', label: 'All', active: 'bg-foreground text-background', inactive: 'border border-[#E7DDD1] bg-white text-[#8A7F75]' },
  { key: 'new', label: 'New', active: 'bg-info text-white', inactive: 'border border-info/30 bg-info/10 text-info' },
  { key: 'active', label: 'Healthy', active: 'bg-success text-white', inactive: 'border border-success/30 bg-success/10 text-success' },
];

const LEVEL_CHIP: Record<OwnerHealth['level'], { label: string; className: string }> = {
  'at-risk': { label: 'At risk', className: 'bg-destructive/10 text-destructive' },
  attention: { label: 'Needs attention', className: 'bg-warning/10 text-warning' },
  new: { label: 'New', className: 'bg-info/10 text-info' },
  healthy: { label: 'Healthy', className: 'bg-success/10 text-success' },
};

const DIMENSION_DOT: Record<string, string> = {
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  untracked: 'bg-muted-foreground/30',
};

const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

function toSignals(row: Record<string, any>): OwnerSignals {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Owner'),
    joinedAt: row.joined_at ? String(row.joined_at) : null,
    hostels: Number(row.hostels ?? 0),
    hostelsLive: Number(row.hostels_live ?? 0),
    hostelsAwaitingApproval: Number(row.hostels_awaiting_approval ?? 0),
    tenants: Number(row.tenants ?? 0),
    activeTenants: Number(row.active_tenants ?? 0),
    capacity: Number(row.capacity ?? 0),
    collectedThisMonth: Number(row.collected_this_month ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    documentsSubmitted: Number(row.documents_submitted ?? 0),
    documentsVerified: Boolean(row.documents_verified),
    documentsRejected: Boolean(row.documents_rejected),
    mrr: Number(row.mrr ?? 0),
    subscriptionStatuses: Array.isArray(row.subscription_statuses) ? row.subscription_statuses.map(String) : [],
  };
}

export function AdminOwnersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<OwnerFilter>('attention');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['platform-admin', 'owners', search],
    queryFn: () => platformAdminService.getOwners({ search: search || undefined, limit: 100 }),
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const owners = query.data?.owners ?? [];
    return owners
      .map((raw) => {
        const signals = toSignals(raw);
        return { raw, signals, health: deriveOwnerHealth(signals) };
      })
      .sort((a, b) => compareByUrgency(a.health, b.health));
  }, [query.data]);

  const visible = rows.filter((row) => matchesFilter(row.health, filter));
  const attentionCount = rows.filter((row) => matchesFilter(row.health, 'attention')).length;
  const selected = rows.find((row) => row.signals.id === selectedId) ?? null;

  return (
    <div className="px-4 pb-8 pt-5 sm:px-6">
      <div className="mb-4">
        <h1 className="font-display text-[20px] font-extrabold text-foreground">Owners</h1>
        <p className="mt-0.5 text-[12.5px] text-[#8A7F75]">Every business using Stayo</p>
      </div>

      <label className="mb-3 flex items-center gap-2 rounded-xl border border-[#E7DDD1] bg-white px-3.5 py-[11px]">
        <Search className="h-3.5 w-3.5 flex-none text-[#9C9186]" strokeWidth={1.8} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, email or phone…"
          className="w-full bg-transparent text-[13px] text-foreground placeholder:text-[#9C9186] focus:outline-none"
        />
      </label>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
              filter === chip.key ? chip.active : chip.inactive
            }`}
          >
            {chip.label}
            {chip.key === 'attention' && attentionCount > 0 ? ` ${attentionCount}` : ''}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-[14px] bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-[13.5px] text-[#9C9186]">
          {filter === 'attention' ? 'Nothing needs you right now.' : 'No owners match your search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(({ raw, signals, health }) => {
            const chip = LEVEL_CHIP[health.level];
            return (
              <div
                key={signals.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(signals.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedId(signals.id)}
                className="cursor-pointer rounded-[14px] border border-[#EFE6DA] bg-white p-4 text-left shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-bold text-foreground">{signals.name}</span>
                  <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.className}`}>
                    {chip.label}
                  </span>
                </div>

                <div className="mt-1 truncate text-[12px] text-[#8A7F75]">
                  {signals.hostels > 0
                    ? `${signals.hostels} ${signals.hostels === 1 ? 'hostel' : 'hostels'} · ${signals.activeTenants} tenants`
                    : 'No hostel yet'}
                </div>

                {/* The reason leads, because that is what the admin acts on.
                    Metrics sit underneath as supporting context. */}
                {health.headline && (
                  <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-[#FBF6F0] px-2.5 py-2">
                    <AlertTriangle
                      className={`mt-0.5 h-3.5 w-3.5 flex-none ${
                        health.headline.severity === 'high' ? 'text-destructive' : 'text-warning'
                      }`}
                      strokeWidth={2.2}
                    />
                    <span className="text-[11.5px] font-semibold leading-snug text-foreground">
                      {health.headline.label}
                    </span>
                  </div>
                )}

                <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-[#F2ECE5] pt-2.5">
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">Occ.</div>
                    <div className="text-[13px] font-bold text-foreground">{Number(raw.occupancy ?? 0)}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">Collected</div>
                    <div className="text-[13px] font-bold text-foreground">{fmtINR(signals.collectedThisMonth)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-[#9C9186]">MRR</div>
                    <div className="text-[13px] font-bold text-foreground">
                      {signals.mrr > 0 ? fmtINR(signals.mrr) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <OwnerDrawer
          raw={selected.raw}
          signals={selected.signals}
          health={selected.health}
          onClose={() => setSelectedId(null)}
          onOpenHostels={() => navigate(`/admin/hostels?owner=${selected.signals.id}`)}
          onOpenDocuments={() => navigate('/admin/documents')}
        />
      )}
    </div>
  );
}

/**
 * The owner profile.
 *
 * Deliberately observability and intervention only — it does not reproduce the
 * owner's own app. Anything operational (tenants, rent, food) is reached by
 * opening that owner's context, not rebuilt here.
 */
function OwnerDrawer({
  raw,
  signals,
  health,
  onClose,
  onOpenHostels,
  onOpenDocuments,
}: {
  raw: Record<string, any>;
  signals: OwnerSignals;
  health: OwnerHealth;
  onClose: () => void;
  onOpenHostels: () => void;
  onOpenDocuments: () => void;
}) {
  const dimensions = healthDimensions(signals);
  const chip = LEVEL_CHIP[health.level];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(40,30,20,0.32)]" onClick={onClose} />
      <div className="relative z-10 flex h-full w-[440px] max-w-[92vw] flex-col bg-white shadow-[-24px_0_60px_-24px_rgba(40,30,20,0.28)]">
        <div className="flex flex-none items-center justify-between border-b border-[#EFE6DA] px-[22px] py-[18px]">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Owner</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#E7DDD1] bg-white text-[#8A7F75] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-[22px]">
          <div className="flex items-center gap-3.5">
            <span className="flex h-13 w-13 flex-none items-center justify-center rounded-[14px] bg-foreground font-display text-[17px] font-bold text-background">
              {signals.name?.[0]?.toUpperCase() ?? 'O'}
            </span>
            <div className="min-w-0">
              <div className="font-display text-[18px] font-extrabold text-foreground">{signals.name}</div>
              <div className="mt-1 truncate text-[12px] text-[#8A7F75]">{raw.email ?? '—'}</div>
              <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.className}`}>
                {chip.label}
              </span>
            </div>
          </div>

          {health.reasons.length > 0 && (
            <section className="mt-5">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Needs you</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {health.reasons.map((reason) => (
                  <li key={reason.code} className="rounded-xl border border-[#EFE6DA] bg-[#FBF6F0] p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className={`mt-0.5 h-3.5 w-3.5 flex-none ${
                          reason.severity === 'high' ? 'text-destructive' : 'text-warning'
                        }`}
                        strokeWidth={2.2}
                      />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-bold text-foreground">{reason.label}</div>
                        <div className="mt-0.5 text-[11.5px] leading-relaxed text-[#8A7F75]">{reason.detail}</div>
                        {reason.action === 'review-documents' && (
                          <button
                            type="button"
                            onClick={onOpenDocuments}
                            className="mt-2 inline-flex h-[30px] items-center gap-1 rounded-lg border border-[#E7DDD1] bg-white px-3 text-[11.5px] font-bold text-foreground hover:border-primary hover:text-primary"
                          >
                            Review documents <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                        {reason.action === 'approve-hostel' && (
                          <button
                            type="button"
                            onClick={onOpenHostels}
                            className="mt-2 inline-flex h-[30px] items-center gap-1 rounded-lg border border-[#E7DDD1] bg-white px-3 text-[11.5px] font-bold text-foreground hover:border-primary hover:text-primary"
                          >
                            Review hostels <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Business</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Hostels" value={`${signals.hostels}`} sub={`${signals.hostelsLive} live`} />
              <Stat label="Tenants" value={`${signals.tenants}`} sub={`${signals.activeTenants} active`} />
              <Stat label="Occupancy" value={`${Number(raw.occupancy ?? 0)}%`} sub={`${signals.capacity} beds`} />
              <Stat
                label="Collected"
                value={fmtINR(signals.collectedThisMonth)}
                sub={signals.outstanding > 0 ? `${fmtINR(signals.outstanding)} due` : 'this month'}
              />
            </div>
          </section>

          <section className="mt-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Health</h3>
            <ul className="mt-2 divide-y divide-[#F2ECE5] overflow-hidden rounded-xl border border-[#EFE6DA]">
              {dimensions.map((dimension) => (
                <li key={dimension.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${DIMENSION_DOT[dimension.state]}`} />
                    <span className="text-[12.5px] font-bold text-foreground">{dimension.label}</span>
                  </span>
                  <span
                    className={`text-[11.5px] ${
                      dimension.state === 'untracked' ? 'italic text-[#9C9186]' : 'text-[#8A7F75]'
                    }`}
                  >
                    {dimension.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Hostels</h3>
            {signals.hostels === 0 ? (
              <p className="mt-2 text-[12.5px] text-[#9C9186]">No hostel created yet.</p>
            ) : (
              <>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {(raw.hostel_names ?? []).map((name: string) => (
                    <li key={name} className="flex items-center gap-2 rounded-xl border border-[#EFE6DA] px-3.5 py-2.5">
                      <Building2 className="h-3.5 w-3.5 flex-none text-[#9C9186]" strokeWidth={1.9} />
                      <span className="truncate text-[12.5px] font-bold text-foreground">{name}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={onOpenHostels}
                  className="mt-2 inline-flex h-[32px] items-center gap-1 rounded-lg border border-[#E7DDD1] bg-white px-3.5 text-[12px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary"
                >
                  Open all hostels <ArrowUpRight className="h-3 w-3" />
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[#EFE6DA] px-3.5 py-2.5">
      <div className="text-[10px] font-semibold text-[#9C9186]">{label}</div>
      <div className="mt-0.5 text-[15px] font-bold text-foreground">{value}</div>
      <div className="text-[10.5px] text-[#9C9186]">{sub}</div>
    </div>
  );
}
