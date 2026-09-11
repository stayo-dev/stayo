import { StatusPill, type StatusTone } from '@shared/ui-patterns/StatusPill';
import type { MockTenant } from '@shared/mocks/tenants';
import { TenantAvatar } from '@shared/ui/TenantAvatar';
import { acceptanceBadge } from '../accessMode';
import { TenantQuickActions } from './TenantQuickActions';

const TONE_BY_STATUS: Record<MockTenant['status'], StatusTone> = {
  active: 'success',
  dues: 'warning',
  overdue: 'destructive',
  invited: 'warning',
  'pending-docs': 'warning',
};

interface TenantRowProps {
  tenant: MockTenant;
  onClick: () => void;
  /** Show which hostel this tenant belongs to — only needed when the list is showing tenants from more than one hostel at once ("All Hostels" filter). */
  showHostel?: boolean;
  /** Row is the URL-selected tenant in the desktop master-detail — never true below `lg`. */
  active?: boolean;
}

/** Single tenant row, per Stayo App.dc.html's Tenants tab list rows. */
export function TenantRow({ tenant, onClick, showHostel, active }: TenantRowProps) {
  const meta = tenant.room === '—' ? `No room · ₹${tenant.rent.toLocaleString('en-IN')}/mo` : `Room ${tenant.room} · ₹${tenant.rent.toLocaleString('en-IN')}/mo`;
  const metaSuffix = tenant.kycStatus === 'Pending' || tenant.kycStatus === 'Not started' ? ' · docs pending' : '';
  // "Awaiting acceptance" (new model) or "Not on app" (legacy) — a fact about
  // reach, not a tenancy status, so kept off the status pill and beside the
  // room/rent line instead.
  const accessLabel = acceptanceBadge(tenant);

  return (
    /* The card holds the row *and* the contact strip, so the strip's buttons
       are siblings of the open-tenant button rather than nested inside it. */
    <div
      className={`overflow-hidden rounded-[18px] border ${active ? 'border-primary ring-1 ring-primary/50' : 'border-border'} bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]`}
    >
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 p-3.5 text-left">
      {/*
       * The dashed ring marks someone not-yet-arrived, and it stays — but it is
       * a ring around the photo, not a reason to hide one. An invited tenant
       * who has finished onboarding has already uploaded their face; showing
       * initials there threw away a photo we hold.
       */}
      {tenant.photoUrl ? (
        <TenantAvatar
          name={tenant.name}
          initials={tenant.initials}
          photoUrl={tenant.photoUrl}
          shape="circle"
          className={`h-10 w-10 text-[13px] ${tenant.status === 'invited' ? 'border-[1.5px] border-dashed border-[#D9A891]' : ''}`}
        />
      ) : (
        <span
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-full font-display text-[13px] font-bold ${
            tenant.status === 'invited' ? 'border-[1.5px] border-dashed border-[#D9A891] bg-[#F5E9E3] text-primary' : 'bg-secondary text-primary'
          }`}
        >
          {tenant.initials}
        </span>
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
    <TenantQuickActions tenantId={tenant.id} name={tenant.name} phone={tenant.phone} outstanding={tenant.outstanding} />
    </div>
  );
}
