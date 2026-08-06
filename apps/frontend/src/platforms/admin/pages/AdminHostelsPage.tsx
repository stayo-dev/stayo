import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X, CheckCircle2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';

const VERIFICATION_CHIP: Record<string, { chip: string; dot: string }> = {
  PENDING: { chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  VERIFIED: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
};
const LISTING_CHIP: Record<string, { chip: string; dot: string }> = {
  DRAFT: { chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
  LIVE: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  SUSPENDED: { chip: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};

const HOSTEL_FILTERS = [
  { key: 'all', label: 'All', active: 'bg-foreground text-background', inactive: 'border border-[#E7DDD1] bg-white text-[#8A7F75]' },
  { key: 'live', label: 'Live', active: 'bg-success text-white', inactive: 'border border-success/30 bg-success/10 text-success' },
  { key: 'pending', label: 'Pending', active: 'bg-warning text-white', inactive: 'border border-warning/30 bg-warning/10 text-warning' },
  { key: 'suspended', label: 'Suspended', active: 'bg-destructive text-white', inactive: 'border border-destructive/30 bg-destructive/10 text-destructive' },
] as const;
type HostelFilter = (typeof HOSTEL_FILTERS)[number]['key'];

const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
const duesClass = (dues: number) => (dues > 0 ? 'text-destructive' : 'text-foreground');

function Chip({ status, map }: { status: string; map: Record<string, { chip: string; dot: string }> }) {
  const s = map[status] ?? Object.values(map)[0];
  return (
    <span className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function subscriptionLabel(status: string | null | undefined, trialEndsAt?: string | null) {
  if (!status) return { text: 'No plan', className: 'bg-muted text-muted-foreground' };
  if (status === 'ACTIVE') return { text: 'Active', className: 'bg-success/10 text-success' };
  if (status === 'TRIAL') {
    const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)) : null;
    return { text: daysLeft != null ? `Trial · ${daysLeft}d left` : 'Trial', className: 'bg-info/10 text-info' };
  }
  if (status === 'RENEWAL_DUE') return { text: 'Renewal due', className: 'bg-warning/10 text-warning' };
  if (status === 'PAYMENT_FAILED') return { text: 'Overdue', className: 'bg-destructive/10 text-destructive' };
  if (status === 'CANCELLED') return { text: 'Cancelled', className: 'bg-muted text-muted-foreground' };
  return { text: status, className: 'bg-muted text-muted-foreground' };
}

export function AdminHostelsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<HostelFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('open'));

  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && openId !== selectedId) setSelectedId(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const closeDetail = () => {
    setSelectedId(null);
    if (searchParams.get('open')) {
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const listParams = {
    search: search || undefined,
    listing: filter === 'live' ? 'LIVE' : filter === 'suspended' ? 'SUSPENDED' : undefined,
    verification: filter === 'pending' ? 'PENDING' : undefined,
  };

  const listQuery = useQuery({
    queryKey: ['admin', 'hostels', search, filter],
    queryFn: () => platformAdminService.getHostels(listParams),
    staleTime: 15_000,
  });

  const detailQuery = useQuery({
    queryKey: ['admin', 'hostel', selectedId],
    queryFn: () => platformAdminService.getHostel(selectedId!),
    enabled: Boolean(selectedId),
  });

  const plansQuery = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => platformAdminService.getPlans(), staleTime: 60_000 });
  const [planId, setPlanId] = useState('');
  const assignMutation = useMutation({
    mutationFn: () => platformAdminService.assignSubscription(selectedId!, { planId }),
    onSuccess: () => {
      stayoToast.success('Subscription assigned');
      queryClient.invalidateQueries({ queryKey: ['admin', 'hostel', selectedId] });
    },
    onError: () => stayoToast.error('Could not assign subscription'),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'hostels'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'hostel', selectedId] });
  };
  const approveMutation = useMutation({
    mutationFn: () => platformAdminService.approveListing(selectedId!),
    onSuccess: () => { stayoToast.success('Listing approved'); invalidateAll(); },
    onError: () => stayoToast.error('Could not approve listing'),
  });
  const suspendMutation = useMutation({
    mutationFn: () => platformAdminService.suspendListing(selectedId!),
    onSuccess: () => { stayoToast.success('Listing suspended'); invalidateAll(); },
    onError: () => stayoToast.error('Could not suspend listing'),
  });
  const reactivateMutation = useMutation({
    mutationFn: () => platformAdminService.reactivateListing(selectedId!),
    onSuccess: () => { stayoToast.success('Listing reactivated'); invalidateAll(); },
    onError: () => stayoToast.error('Could not reactivate listing'),
  });

  const h = detailQuery.data;

  return (
    <div className="mx-auto max-w-[1360px] px-7 py-6">
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-[300px] items-center gap-2 rounded-[11px] border border-[#E7DDD1] bg-white px-3">
          <Search className="h-4 w-4 text-[#9C9186]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hostels, owners, cities…" className="w-full bg-transparent text-[13px] text-foreground outline-none" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HOSTEL_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${filter === f.key ? f.active : f.inactive}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[13px] font-semibold text-[#9C9186]">{listQuery.data?.length ?? 0} hostels</span>
      </div>

      {listQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : listQuery.data && listQuery.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listQuery.data.map((hostel) => {
            const subLabel = subscriptionLabel(hostel.subscription_status);
            return (
              <div
                key={hostel.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(hostel.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedId(hostel.id)}
                className="cursor-pointer rounded-[14px] border border-[#EFE6DA] bg-white p-4 text-left shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-bold text-foreground">{hostel.name}</span>
                  <Chip status={hostel.listing_status} map={LISTING_CHIP} />
                </div>
                <div className="mt-1 text-[12px] text-[#8A7F75]">
                  {hostel.owner} · {hostel.city ?? '—'}
                  {hostel.owner_hostel_count > 1 && (
                    <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-primary">{hostel.owner_hostel_count} hostels</span>
                  )}
                </div>
                <div className="mt-2.5 grid grid-cols-4 gap-2 border-t border-[#F2ECE5] pt-2.5">
                  <div><div className="text-[10px] font-semibold text-[#9C9186]">Tenants</div><div className="text-[13px] font-bold text-foreground">{hostel.tenants}</div></div>
                  <div><div className="text-[10px] font-semibold text-[#9C9186]">Occ.</div><div className="text-[13px] font-bold text-foreground">{hostel.occupancy}%</div></div>
                  <div><div className="text-[10px] font-semibold text-[#9C9186]">Revenue</div><div className="text-[13px] font-bold text-foreground">{fmtINR(hostel.revenue)}</div></div>
                  <div><div className="text-[10px] font-semibold text-[#9C9186]">Dues</div><div className={`text-[13px] font-bold ${duesClass(hostel.dues)}`}>{fmtINR(hostel.dues)}</div></div>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${subLabel.className}`}>{subLabel.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSelectedId(hostel.id); }}
                    className="h-[30px] flex-none rounded-lg border border-[#E7DDD1] bg-white px-3.5 text-[12px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary"
                  >
                    Open Hostel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center text-[13.5px] text-[#9C9186]">No hostels match your search.</div>
      )}

      {selectedId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-[rgba(40,30,20,0.32)]" onClick={closeDetail} />
          <div className="relative z-10 flex h-full w-[440px] max-w-[92vw] flex-col bg-white shadow-[-24px_0_60px_-24px_rgba(40,30,20,0.28)]">
            <div className="flex flex-none items-center justify-between border-b border-[#EFE6DA] px-[22px] py-[18px]">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Hostel Details</span>
              <button
                type="button"
                onClick={closeDetail}
                className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#E7DDD1] bg-white text-[#8A7F75] hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailQuery.isLoading || !h ? (
              <div className="flex-1 p-[22px]"><div className="h-64 animate-pulse rounded-2xl bg-muted" /></div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-[22px]">
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-13 w-13 flex-none items-center justify-center rounded-[14px] bg-foreground font-display text-[17px] font-bold text-background">
                      {h.name?.[0]?.toUpperCase() ?? 'H'}
                    </span>
                    <div className="min-w-0">
                      <div className="font-display text-[18px] font-extrabold text-foreground">{h.name}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Chip status={h.verification_status} map={VERIFICATION_CHIP} />
                        <Chip status={h.listing_status} map={LISTING_CHIP} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-[#9C9186]">Created {new Date(h.created_at).toLocaleDateString('en-IN')}</div>

                  <div className="mt-5 rounded-[13px] border border-[#EFE6DA] bg-[#F7F3EF] p-4">
                    <div className="flex flex-col gap-3.5">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9C9186]">Owner</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
                          {h.owner?.name ?? '—'}
                          {h.owner_hostel_count > 1 && (
                            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-primary">{h.owner_hostel_count} hostels</span>
                          )}
                        </div>
                      </div>
                      <div><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9C9186]">Contact Number</div><div className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-foreground">{h.phone}</div></div>
                      <div><div className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9C9186]">Address</div><div className="mt-0.5 text-[13.5px] leading-snug text-[#8A7F75]">{[h.address, h.city, h.state, h.pincode].filter(Boolean).join(', ')}</div></div>
                      <div className="h-px bg-[#EFE6DA]" />
                      <div className="flex items-center justify-between"><span className="text-[12.5px] text-[#8A7F75]">Active Tenants</span><span className="text-[13px] font-bold text-foreground">{h.tenants}</span></div>
                      <div className="flex items-center justify-between"><span className="text-[12.5px] text-[#8A7F75]">Occupancy</span><span className="text-[13px] font-bold text-foreground">{h.occupancy}%</span></div>
                      <div className="flex items-center justify-between"><span className="text-[12.5px] text-[#8A7F75]">Monthly Revenue</span><span className="text-[13px] font-bold text-foreground">{fmtINR(h.revenue)}</span></div>
                      <div className="flex items-center justify-between"><span className="text-[12.5px] text-[#8A7F75]">Pending Dues</span><span className={`text-[13px] font-bold ${duesClass(h.dues)}`}>{fmtINR(h.dues)}</span></div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] text-[#8A7F75]">Subscription</span>
                        {(() => {
                          const label = subscriptionLabel(h.subscription?.status, h.subscription?.trial_ends_at);
                          return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${label.className}`}>{label.text}</span>;
                        })()}
                      </div>
                    </div>
                  </div>

                  {h.sibling_hostels && h.sibling_hostels.length > 0 && (
                    <div className="mt-4 rounded-[13px] border border-[#EFE6DA] p-4">
                      <div className="mb-3 text-[13px] font-bold text-foreground">Other hostels by this owner ({h.sibling_hostels.length})</div>
                      <div className="flex flex-col gap-1.5">
                        {h.sibling_hostels.map((sib: { id: string; name: string; city: string | null; listing_status: string }) => (
                          <button
                            key={sib.id}
                            type="button"
                            onClick={() => setSelectedId(sib.id)}
                            className="flex items-center justify-between gap-2 rounded-[10px] border border-[#EFE6DA] bg-[#F7F3EF] px-3 py-2.5 text-left hover:border-primary"
                          >
                            <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">{sib.name}</span>
                            <span className="flex flex-none items-center gap-2">
                              <span className="text-[11px] text-[#9C9186]">{sib.city ?? '—'}</span>
                              <Chip status={sib.listing_status} map={LISTING_CHIP} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 rounded-[13px] border border-[#EFE6DA] p-4">
                    <div className="mb-3 text-[13px] font-bold text-foreground">Assign / change plan</div>
                    <div className="flex gap-2">
                      <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="h-10 flex-1 rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 text-[12.5px] font-semibold text-foreground">
                        <option value="">Select a plan…</option>
                        {plansQuery.data?.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} — {fmtINR(Number(p.price_amount))}/mo</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!planId || assignMutation.isPending}
                        onClick={() => assignMutation.mutate()}
                        className="h-10 rounded-[10px] bg-foreground px-4 text-[12.5px] font-bold text-background disabled:opacity-50"
                      >
                        {h.subscription ? 'Change' : 'Assign'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-none border-t border-[#EFE6DA] bg-white px-[22px] py-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => approveMutation.mutate()}
                      disabled={h.verification_status === 'VERIFIED' || approveMutation.isPending}
                      className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-success text-[12px] font-bold text-white disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> {h.verification_status === 'VERIFIED' ? 'Verified' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => suspendMutation.mutate()}
                      disabled={h.listing_status === 'SUSPENDED' || suspendMutation.isPending}
                      className="h-10 flex-1 rounded-[10px] border border-[#E3C79A] bg-white text-[12px] font-bold text-[#B8792B] disabled:opacity-40"
                    >
                      Suspend
                    </button>
                    <button
                      type="button"
                      onClick={() => reactivateMutation.mutate()}
                      disabled={h.listing_status !== 'SUSPENDED' || reactivateMutation.isPending}
                      className="h-10 flex-1 rounded-[10px] border border-[#E7DDD1] bg-white text-[12px] font-bold text-[#8A7F75] disabled:opacity-40"
                    >
                      Reactivate
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
