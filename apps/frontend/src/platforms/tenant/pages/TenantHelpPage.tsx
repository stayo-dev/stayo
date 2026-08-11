import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Phone, MessageCircle } from 'lucide-react';
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
        <button type="button" onClick={() => navigate('/tenant/profile')} className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
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

      {/* COMPLAINTS / REQUESTS SECTION */}
      <div className={`${card} p-4 mt-2`}>
        <h2 className="font-display text-[15px] font-bold text-foreground mb-3">Raise a Request</h2>
        <form 
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const type = (form.elements.namedItem('type') as HTMLSelectElement).value;
            const description = (form.elements.namedItem('description') as HTMLTextAreaElement).value;
            
            try {
              const res = await fetch('/api/tenant/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, description })
              });
              if (!res.ok) throw new Error('Failed to submit request');
              alert('Request submitted successfully!');
              form.reset();
            } catch (err) {
              alert('Failed to submit request. Please try again.');
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-semibold text-foreground">Request Type</label>
            <select name="type" required className="rounded-lg border border-border bg-transparent p-2.5 text-[13px] outline-none focus:border-foreground">
              <option value="MAINTENANCE">Maintenance Issue</option>
              <option value="CLEANING">Cleaning Request</option>
              <option value="ROOM_CHANGE">Room Change Request</option>
              <option value="LOST_KEY">Lost Key</option>
              <option value="VISITOR_PASS">Visitor Pass</option>
              <option value="EXTRA_MATTRESS">Extra Mattress</option>
            </select>
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-semibold text-foreground">Details / Complaint</label>
            <textarea name="description" required rows={3} placeholder="Please describe the issue..." className="resize-none rounded-lg border border-border bg-transparent p-2.5 text-[13px] outline-none focus:border-foreground" />
          </div>
          
          <button type="submit" className="mt-1 w-full rounded-xl bg-foreground py-3 font-display text-[13.5px] font-bold text-background transition-transform active:scale-[0.98]">
            Submit Request
          </button>
        </form>
      </div>
    </div>
  );
}
