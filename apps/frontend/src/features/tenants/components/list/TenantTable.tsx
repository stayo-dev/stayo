import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Eye, Bell, LogOut, Send } from 'lucide-react';
import { TenantStatusBadge } from '@features/tenants/components/badges/TenantStatusBadge';
import { getInitials, type NormalizedTenant } from '@features/tenants/utils/normalize';
import { getTenantBillingDisplay } from '@features/tenants/utils/billingDisplay';
import { AttentionChips } from '../shared/AttentionChips';

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

interface Props {
  tenants: NormalizedTenant[];
  hostelId: string;
  onReminder?: (t: NormalizedTenant) => void;
  onMoveOut?: (t: NormalizedTenant) => void;
  onResend?: (t: NormalizedTenant) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (tenantId: string) => void;
  onRowClick?: (t: NormalizedTenant) => void;
}

export function TenantTable({
  tenants,
  hostelId,
  onReminder,
  onMoveOut,
  onResend,
  selectedIds,
  onToggleSelect,
  onRowClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: tenants.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 10,
  });

  if (tenants.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-12">No tenants match your filters</p>
    );
  }

  const handleRowClick = (e: React.MouseEvent, tenant: NormalizedTenant) => {
    // If user clicked an interactive child element (button, link, input), don't trigger row click preview
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input')) {
      return;
    }
    onRowClick?.(tenant);
  };

  const gridColsClass = onToggleSelect
    ? 'grid-cols-[48px_2.2fr_65px_90px_90px_80px_90px_100px_120px]'
    : 'grid-cols-[2.2fr_65px_90px_90px_80px_90px_100px_120px]';

  return (
    <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
      <div className="min-w-[980px] text-sm">
        <div className={`grid ${gridColsClass} bg-secondary/50 text-left text-xs text-muted-foreground`}>
          {onToggleSelect && <div className="px-4 py-3 font-medium">Pick</div>}
          <div className="px-4 py-3 font-medium">Tenant</div>
          <div className="px-4 py-3 font-medium">Room</div>
          <div className="px-4 py-3 font-medium">Rent</div>
          <div className="px-4 py-3 font-medium">Due</div>
          <div className="px-4 py-3 font-medium">Status</div>
          <div className="px-4 py-3 font-medium">Joined</div>
          <div className="px-4 py-3 font-medium text-right">Outstanding</div>
          <div className="px-2 py-3" />
        </div>
        <div ref={scrollRef} className="max-h-[620px] overflow-y-auto overflow-x-hidden">
          <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const t = tenants[virtualRow.index];
              const billing = getTenantBillingDisplay(t);
              return (
                <div
                  key={t.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  onClick={(e) => handleRowClick(e, t)}
                  className={`absolute top-0 left-0 grid w-full ${gridColsClass} border-t border-border hover:bg-secondary/30 items-center cursor-pointer transition-colors py-2.5`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {onToggleSelect && (
                    <div className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds?.has(t.id) ?? false}
                        onChange={() => onToggleSelect(t.id)}
                        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                        aria-label={`Select ${t.name}`}
                      />
                    </div>
                  )}
                  <div className="px-4 py-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-accent/15 overflow-hidden flex items-center justify-center text-xs font-semibold text-accent shrink-0">
                        {t.photoUrl ? (
                          <img src={t.photoUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          getInitials(t.name)
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/hostels/${hostelId}/tenants/${t.id}`}
                          className="font-medium text-foreground hover:text-accent truncate block"
                        >
                          {t.name}
                        </Link>
                        <p className="text-xs text-muted-foreground truncate">{t.phone}</p>
                        <AttentionChips tenant={t} className="mt-1" />
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2 text-foreground font-medium">{t.room}</div>
                  <div className="px-4 py-2">{fmt(t.rent)}/mo</div>
                  <div className="px-4 py-2 min-w-0">
                    <span
                      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5 ${billing.dueClassName}`}
                      title={billing.title}
                    >
                      <span className="truncate">{billing.dueLabel}</span>
                    </span>
                  </div>
                  <div className="px-4 py-2">
                    <TenantStatusBadge status={t.status} />
                  </div>
                  <div className="px-4 py-2 text-muted-foreground">
                    {t.joinDate ? new Date(t.joinDate).toLocaleDateString('en-IN') : '—'}
                  </div>
                  <div className="px-4 py-2 text-right font-medium">
                    <span className={billing.outstandingClassName}>{billing.outstandingLabel}</span>
                  </div>
                  <div className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/hostels/${hostelId}/tenants/${t.id}`}
                        className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0"
                        title="View Dashboard"
                      >
                        <Eye className="w-4.5 h-4.5" />
                      </Link>
                      {onReminder && t.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => onReminder(t)}
                          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0"
                          title="Send reminder"
                        >
                          <Bell className="w-4.5 h-4.5" />
                        </button>
                      )}
                      {onMoveOut && t.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => onMoveOut(t)}
                          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0"
                          title="Start move-out"
                        >
                          <LogOut className="w-4.5 h-4.5" />
                        </button>
                      )}
                      {onResend && t.status === 'INVITED' && (
                        <button
                          type="button"
                          onClick={() => onResend(t)}
                          className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 shrink-0"
                          title="Resend invitation"
                        >
                          <Send className="w-4.5 h-4.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
