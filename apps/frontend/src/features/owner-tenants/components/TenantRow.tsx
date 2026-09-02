import { StatusPill, type StatusTone } from '@shared/ui-patterns/StatusPill';
import type { MockTenant } from '@shared/mocks/tenants';
import { TenantAvatar } from '@shared/ui/TenantAvatar';
import { acceptanceBadge } from '../accessMode';

const TONE_BY_STATUS: Record<MockTenant['status'], StatusTone> = {
  active: 'success',
  overdue: 'destructive',
  invited: 'warning',
  'pending-docs': 'warning',
};

interface TenantRowProps {
  tenant: MockTenant;
  onClick: () => void;
  /** Show which hostel this tenant belongs to — only needed when the list is showing tenants from more than one hostel at once ("All Hostels" filter). */
  showHostel?: boolean;
}

/** Single tenant row, per Stayo App.dc.html's Tenants tab list rows. */
export function TenantRow({ tenant, onClick, showHostel }: TenantRowProps) {
  const meta = tenant.room === '—' ? `No room · ₹${tenant.rent.toLocaleString('en-IN')}/mo` : `Room ${tenant.room} · ₹${tenant.rent.toLocaleString('en-IN')}/mo`;
  const metaSuffix = tenant.kycStatus === 'Pending' || tenant.kycStatus === 'Not started' ? ' · docs pending' : '';
  // "Awaiting acceptance" (new model) or "Not on app" (legacy) — a fact about
  // reach, not a tenancy status, so kept off the status pill and beside the
  // room/rent line instead.
  const accessLabel = acceptanceBadge(tenant);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-3.5 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      {/* An invited tenant has no photo yet, and the dashed ring is what marks
          them as not-yet-arrived — so that treatment stays. */}
      {tenant.status === 'invited' || !tenant.photoUrl ? (
        <span
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-full font-display text-[13px] font-bold ${
            tenant.status === 'invited' ? 'border-[1.5px] border-dashed border-[#D9A891] bg-[#F5E9E3] text-primary' : 'bg-secondary text-primary'
          }`}
        >
          {tenant.initials}
        </span>
      ) : (
        <TenantAvatar
          name={tenant.name}
          initials={tenant.initials}
          photoUrl={tenant.photoUrl}
          shape="circle"
          className="h-10 w-10 text-[13px]"
        />
      )}
      <div className="min-w-0 flex-1">
        {showHostel && (
          <div className="truncate text-[10px] font-bold uppercase tracking-wide text-primary/70">{tenant.hostelName}</div>
        )}
        <div className="truncate text-[13.5px] font-semibold text-foreground">{tenant.name}</div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11.5px] text-muted-foreground">
            {meta}
            {metaSuffix}
          </span>
          {accessLabel && (
            <StatusPill tone="neutral" className="flex-none">
              {accessLabel}
            </StatusPill>
          )}
        </div>
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <StatusPill tone={TONE_BY_STATUS[tenant.status]}>{tenant.statusLabel}</StatusPill>
        {tenant.outstanding > 0 && tenant.status !== 'active' && (
          <span className="font-display text-[13px] font-bold tabular-nums text-destructive">
            ₹{tenant.outstanding.toLocaleString('en-IN')}
          </span>
        )}
      </div>
    </button>
  );
}
