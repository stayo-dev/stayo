import { useState } from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { TenantAvatar } from '@shared/ui/TenantAvatar';
import type { RealTenantDetail } from '../hooks/useTenantDetail';

/**
 * The tenant's identity block.
 *
 * The photo the tenant uploads during onboarding has been on this endpoint the
 * whole time (`photo_url`, returned twice) and was never mapped, so an owner
 * only ever saw initials. It falls back to the initials tile when absent or
 * when the image fails to load — a broken image icon in a profile header reads
 * as a broken product.
 *
 * The Agreement cell is a real control when an agreement exists, because
 * "Pending" with nothing to tap is where owners got stuck asking what the
 * tenant had actually signed.
 */

interface ProfileHeaderProps {
  tenant: RealTenantDetail;
  onOpenAgreement: () => void;
}

const STATUS_TONE = {
  active: 'success',
  overdue: 'destructive',
  invited: 'warning',
  'pending-docs': 'warning',
} as const;

export function ProfileHeader({ tenant, onOpenAgreement }: ProfileHeaderProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const showPhoto = Boolean(tenant.photoUrl) && !imageFailed;
  const agreementSigned = tenant.agreementStatus === 'Signed';
  const canOpenAgreement = agreementSigned && Boolean(tenant.agreement);

  return (
    <>
      <div className="rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <div className="flex items-center gap-3.5">
          {showPhoto ? (
            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label={`View ${tenant.name}'s photo`}
              className="flex-none"
            >
              <TenantAvatar
                name={tenant.name}
                initials={tenant.initials}
                photoUrl={tenant.photoUrl}
                className="h-16 w-16 text-xl"
              />
            </button>
          ) : (
            <TenantAvatar
              name={tenant.name}
              initials={tenant.initials}
              className="h-16 w-16 text-xl"
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-extrabold leading-tight text-foreground">{tenant.name}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusPill tone={STATUS_TONE[tenant.status]} variant="filter">
                {tenant.statusLabel}
              </StatusPill>
              <span className="text-[11.5px] text-muted-foreground">
                Room <b className="font-bold text-foreground">{tenant.room}</b> · Joined{' '}
                <b className="font-bold text-foreground">{tenant.joinedDate}</b>
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3.5 flex overflow-hidden rounded-[13px] border border-border">
          <div className="flex-1 border-r border-border px-3.5 py-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Hostel</div>
            <div className="mt-0.5 font-display text-[12.5px] font-bold text-foreground">{tenant.hostelName}</div>
          </div>

          {canOpenAgreement ? (
            <button
              type="button"
              onClick={onOpenAgreement}
              className="flex flex-1 items-center gap-1.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  Agreement
                </span>
                <span className="mt-0.5 flex items-center gap-1 font-display text-[12.5px] font-bold text-foreground">
                  <FileText className="h-3.5 w-3.5 text-primary" strokeWidth={1.9} />
                  Active Contract
                </span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={2} />
            </button>
          ) : (
            <div className="flex-1 px-3.5 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Agreement</div>
              <div className="mt-0.5 font-display text-[12.5px] font-bold text-foreground">
                {tenant.agreementStatus === 'Signed' ? 'Active Contract' : 'Not signed yet'}
              </div>
            </div>
          )}
        </div>
      </div>

      {zoomed && showPhoto && (
        <button
          type="button"
          onClick={() => setZoomed(false)}
          aria-label="Close photo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-8 backdrop-blur-sm"
        >
          <img
            src={tenant.photoUrl!}
            alt={tenant.name}
            className="max-h-full max-w-full rounded-2xl object-contain"
          />
        </button>
      )}
    </>
  );
}
