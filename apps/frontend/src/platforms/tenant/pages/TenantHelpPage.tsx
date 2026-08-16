import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Phone, MessageCircle, Wrench } from 'lucide-react';
import { tenantPortalApi } from '@features/tenant-portal/api';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/** Tenant Profile → Help & support. Real hostel/owner contact via `tenantPortalApi.getMyProfile()` — no ticketing system, just direct call/WhatsApp, matching what the design's stub row implied. */
export function TenantHelpPage() {
  const navigate = useNavigate();
  const profileQuery = useQuery({
    queryKey: ['tenant', 'portal-profile-help'],
    queryFn: () => tenantPortalApi.getMyProfile(),
    staleTime: 60_000,
  });

  const owner = profileQuery.data?.owner_contact;
  const hostel = profileQuery.data?.hostel;
  const ownerPhone = String(owner?.owner_phone ?? hostel?.phone ?? '').replace(/\D/g, '');
  const waPhone = ownerPhone.length === 10 ? `91${ownerPhone}` : ownerPhone;

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/profile')} className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h1 className="font-display text-[18px] font-extrabold text-foreground">Help & support</h1>
      </div>

      {profileQuery.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <div className={`${card} p-4`}>
          <div className="font-display text-[15px] font-bold text-foreground">{owner?.owner_name ?? hostel?.name ?? 'Your hostel'}</div>
          {hostel?.address && <div className="mt-1 text-[12px] text-muted-foreground">{hostel.address}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {ownerPhone && (
              <a
                href={`tel:${ownerPhone}`}
                className="flex flex-col items-center gap-1.5 rounded-xl bg-primary py-3 text-primary-foreground"
              >
                <Phone className="h-4 w-4" />
                <span className="text-[12px] font-semibold">Call</span>
              </a>
            )}
            {waPhone && (
              <a
                href={`https://wa.me/${waPhone}`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col items-center gap-1.5 rounded-xl border border-success/30 bg-success/10 py-3 text-success"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="text-[12px] font-semibold">WhatsApp</span>
              </a>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate('/tenant/room')}
        className={`${card} mt-2 flex items-center gap-3 p-4 text-left`}
      >
        <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-secondary text-primary">
          <Wrench className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">Raise a maintenance request</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">Report an issue or request room services</div>
        </div>
        <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
      </button>
    </div>
  );
}
