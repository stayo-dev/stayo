import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { HostelMarketingPage } from '@/features/hostel-drilldown/pages/HostelMarketingPage';
import { HostProfileSection } from '../drawer/HostProfileSection';
import { AddressBlock } from '../listings/AddressBlock';
import { NavigationBlock } from '../listings/NavigationBlock';
import { tintForId } from '../theme/palette';
import { serializeDetail } from '../drawer/drawerParam';

const VERIFICATION_TONE: Record<string, string> = {
  VERIFIED: 'bg-[#EAF3EE] text-[#1F7A52]',
  PENDING: 'bg-[#FBF1DE] text-[#B8792B]',
  REJECTED: 'bg-[#FBEFE9] text-[#B3402F]',
};
const LISTING_TONE: Record<string, string> = {
  LIVE: 'bg-[#EAF3EE] text-[#1F7A52]',
  DRAFT: 'bg-[#F2ECE5] text-[#8A7F75]',
  SUSPENDED: 'bg-[#FBEFE9] text-[#B3402F]',
};

function StatusPill({ label, tone }: { label: string; tone?: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.03em] ${tone ?? 'bg-[#F2ECE5] text-[#8A7F75]'}`}>
      {label}
    </span>
  );
}

/**
 * Admin chrome around the owner's marketing editor (which the admin console
 * mounts verbatim — see AdminRoutes.tsx).
 *
 * The editor is a mobile card-list, correctly proportioned at the owner app's
 * ~480px phone-frame width — it must stay that width, not stretch, or its own
 * internal spacing breaks. On a desktop-width screen that used to mean the
 * editor sat centered in a mostly-empty page, everything below it (Location)
 * shoved to the bottom of a long scroll.
 *
 * Rather than stretch the editor or just add padding, the freed width becomes
 * a second, sticky column: hostel identity/status and the admin-only Location
 * tools, so they stay visible the whole time you're editing instead of
 * scrolling away underneath the card. Below `lg` (tablet/phone, where this
 * route can also be opened) it collapses back to the original single stacked
 * column. This only restructures this wrapper page — it changes no listing
 * behaviour and does not touch the shared editor component.
 */
export function AdminListingEditorPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();
  const [editingHostProfile, setEditingHostProfile] = useState(false);

  const hostel = useQuery({
    queryKey: ['admin', 'hostel', hostelId],
    queryFn: () => platformAdminService.getHostel(hostelId!),
    enabled: Boolean(hostelId),
  });

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col items-center lg:items-stretch">
      <div className="mb-5 flex w-full max-w-[480px] items-center gap-3 lg:max-w-none">
        <button
          type="button"
          onClick={() => navigate('/admin/listings')}
          aria-label="Back to Hostel Listings"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-[#E9DFD3] bg-white text-[#5A5147] hover:border-[#B46A55] hover:text-[#B46A55]"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        {hostelId && (
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full font-admin text-[12px] font-bold text-white"
            style={{ background: tintForId(hostelId) }}
          >
            {(hostel.data?.name ?? '?').slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-admin text-[15px] font-bold text-[#221E1A]">
            {hostel.data?.name ?? 'Listing'}
          </div>
          <div className="truncate text-[11.5px] text-[#8A7F75]">
            {[hostel.data?.owner?.name, hostel.data?.city].filter(Boolean).join(' · ') ||
              "Editing this hostel's Discovery listing"}
          </div>
        </div>
        {/* Only visible ≥lg — on the single-column layout these badges already
            sit inside the "Hostel" card lower down, showing them twice would
            just repeat the same two words at phone width. */}
        {hostel.data && (
          <div className="hidden flex-none items-center gap-2 lg:flex">
            {hostel.data.verification_status && (
              <StatusPill label={hostel.data.verification_status} tone={VERIFICATION_TONE[hostel.data.verification_status]} />
            )}
            {hostel.data.listing_status && (
              <StatusPill label={hostel.data.listing_status} tone={LISTING_TONE[hostel.data.listing_status]} />
            )}
          </div>
        )}
      </div>

      <div className="grid w-full grid-cols-1 items-start gap-8 lg:grid-cols-[480px_1fr]">
        <div className="mx-auto w-full max-w-[480px] overflow-hidden rounded-[20px] border border-[#EFE6DA] bg-background shadow-[0_1px_2px_rgba(40,30,20,.04),0_10px_30px_rgba(40,30,20,.06)] lg:mx-0">
          <HostelMarketingPage
            ownerId={hostel.data?.owner_id}
            onEditHostProfile={() => setEditingHostProfile(true)}
            isAdmin
          />
        </div>

        {/*
          The right rail. Sticky so it stays put while the editor card (which
          can run long — Photos, Beds & pricing, Amenities, Getting around,
          House rules...) scrolls underneath it — the same reason a page
          builder keeps its publish controls pinned rather than letting them
          scroll away with the content they publish.
        */}
        <div className="flex w-full max-w-[480px] flex-col gap-4 lg:sticky lg:top-6 lg:max-w-none">
          <div className="rounded-[16px] border border-[#EFE6DA] bg-white p-4">
            <div className="mb-3 font-admin text-[11px] font-bold uppercase tracking-[0.08em] text-[#B0A597]">
              Hostel
            </div>
            <div className="flex flex-col gap-2.5 text-[12.5px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#8A7F75]">Owner</span>
                {hostel.data?.owner_id ? (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/admin/owners?detail=${serializeDetail({ kind: 'owner', id: hostel.data.owner_id })}`,
                      )
                    }
                    className="font-semibold text-[#B46A55] hover:underline"
                  >
                    {hostel.data.owner?.name ?? 'View owner'}
                  </button>
                ) : (
                  <span className="font-semibold text-[#2A2521]">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#8A7F75]">City</span>
                <span className="font-semibold text-[#2A2521]">{hostel.data?.city || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 lg:hidden">
                <span className="text-[#8A7F75]">Verification</span>
                {hostel.data?.verification_status ? (
                  <StatusPill label={hostel.data.verification_status} tone={VERIFICATION_TONE[hostel.data.verification_status]} />
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 lg:hidden">
                <span className="text-[#8A7F75]">Listing</span>
                {hostel.data?.listing_status ? (
                  <StatusPill label={hostel.data.listing_status} tone={LISTING_TONE[hostel.data.listing_status]} />
                ) : (
                  <span>—</span>
                )}
              </div>
              {hostel.data?.listing_status === 'LIVE' && hostel.data?.public_slug && (
                <a
                  href={`/discover/h/${hostel.data.public_slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#B46A55] hover:underline"
                >
                  View public listing
                  <ExternalLink className="h-3 w-3" strokeWidth={2.2} />
                </a>
              )}
            </div>
          </div>

          {/*
            Address + Place ID/coordinates/map embed — admin-only by design,
            not merely by convention: the Place ID decides where Maps sends a
            student walking in, and an owner able to edit it could point
            arrivals at a better-looking building than their own (the routes
            behind these two blocks are ADMIN-only server-side, not just
            admin-shaped). "Nearby locations" (college/metro/market) is a
            *different*, already owner-editable field and lives inside the
            framed editor, in its "Getting around" card — not duplicated here.

            These blocks already existed (the Hostel Listings review drawer),
            but living only there meant setting up a hostel's map required
            leaving this editor entirely. Embedded here instead of
            duplicated: same components, same admin-only routes — now in the
            side rail rather than stacked below a long scroll.
          */}
          {hostelId && (
            <div>
              <div className="mb-2 px-1 font-admin text-[11px] font-bold uppercase tracking-[0.08em] text-[#B0A597]">
                Location — admin only
              </div>
              <div className="space-y-3">
                <AddressBlock hostelId={hostelId} />
                <NavigationBlock hostelId={hostelId} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        Reuses the admin drawer's own host-profile editor verbatim — same
        record an owner edits at /owner/more/host-profile, just opened from
        inside the listing flow instead of from the Owners page.
      */}
      {editingHostProfile && hostel.data?.owner_id && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setEditingHostProfile(false)}
            className="absolute inset-0 bg-[rgba(28,22,18,.44)]"
          />
          <div className="relative max-h-[85vh] w-full max-w-[480px] overflow-auto rounded-[20px] bg-white shadow-[0_24px_60px_rgba(30,20,12,.3)]">
            <div className="flex items-center justify-between border-b border-[#F2ECE5] px-5 py-4">
              <span className="font-admin text-[14px] font-bold text-[#221E1A]">Host profile</span>
              <button
                type="button"
                onClick={() => setEditingHostProfile(false)}
                className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#F2ECE5]"
              >
                <X className="h-3.5 w-3.5 text-[#7A6F63]" />
              </button>
            </div>
            <div className="p-5">
              <HostProfileSection ownerId={hostel.data.owner_id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
