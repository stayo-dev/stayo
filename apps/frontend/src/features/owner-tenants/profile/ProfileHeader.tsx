import { useState } from 'react';
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
 * The two cells carry rent and the next payment. They replaced an Agreement
 * status that restated what Risk & Compliance already showed and gave an owner
 * nothing to act on; the agreement itself is still previewable from the
 * Documents tab, where a document belongs.
 */

interface ProfileHeaderProps {
  tenant: RealTenantDetail;
}

const STATUS_TONE = {
  active: 'success',
  overdue: 'destructive',
  invited: 'warning',
  'pending-docs': 'warning',
} as const;

export function ProfileHeader({ tenant }: ProfileHeaderProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const showPhoto = Boolean(tenant.photoUrl) && !imageFailed;
  const next = tenant.nextPayment;

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
                {tenant.hostelName} · Room <b className="font-bold text-foreground">{tenant.room}</b>
                {tenant.joinedDate ? (
                  <>
                    {' '}· Joined <b className="font-bold text-foreground">{tenant.joinedDate}</b>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {/* Rent and the next payment, because neither appears anywhere else on
            this screen — rent was buried in the Stay tab and the next due date
            was nowhere at all. This replaced an Agreement cell, which restated
            a status already visible in Risk & Compliance and told an owner
            nothing they could act on. */}
        <div className="mt-3.5 flex overflow-hidden rounded-[13px] border border-border">
          <div className="flex-1 border-r border-border px-3.5 py-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Rent
            </div>
            <div className="mt-0.5 font-display text-[12.5px] font-bold tabular-nums text-foreground">
              ₹{tenant.stay.monthlyRent.toLocaleString('en-IN')}
              <span className="font-semibold text-muted-foreground"> / mo</span>
            </div>
          </div>
          <div className="flex-1 px-3.5 py-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Next payment
            </div>
            <div
              className={`mt-0.5 font-display text-[12.5px] font-bold ${
                next.isOverdue ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {next.amount ? `${next.amount} · ${next.timing}` : next.timing}
            </div>
            {(next.dateLabel || next.periodLabel) && (
              <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                {next.multiMonth && next.periodLabel ? next.periodLabel : next.dateLabel}
                {next.projected ? ' · projected' : ''}
              </div>
            )}
          </div>
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
