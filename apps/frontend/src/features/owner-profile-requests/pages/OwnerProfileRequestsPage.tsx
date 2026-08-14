import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, X } from 'lucide-react';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerProfileRequests } from '../hooks/useOwnerProfileRequests';

const FIELD_LABEL: Record<string, string> = {
  phone_1: 'Phone',
  personal_email: 'Email',
};

const fmt = (_key: string, value: string | null) => value || '—';

/** Owner-side review queue for tenant-submitted profile-change requests (phone/email only — 2026-08-14 product decision, narrowed same day) — see `useTenantProfile().submitChangeRequest` on the tenant side. */
export function OwnerProfileRequestsPage() {
  const navigate = useNavigate();
  const requests = useOwnerProfileRequests();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="font-display text-[18px] font-extrabold text-foreground">Profile change requests</h1>
          <p className="text-[12px] text-muted-foreground">Tenant-submitted changes awaiting your approval</p>
        </div>
      </div>

      {requests.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      ) : requests.requests.length === 0 ? (
        <EmptyState title="No pending requests" />
      ) : (
        <div className="flex flex-col gap-3">
          {requests.requests.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-display text-sm font-bold text-foreground">{r.tenant?.name ?? 'Unknown tenant'}</div>
                  {r.tenant?.room_no && <div className="text-[11px] text-muted-foreground">Room {r.tenant.room_no}</div>}
                </div>
                <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[10.5px] font-bold text-warning">Pending</span>
              </div>

              <div className="mt-3 flex flex-col gap-2 rounded-xl bg-secondary/30 p-3">
                {Object.keys(r.diff).map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="font-semibold text-muted-foreground">{FIELD_LABEL[key] ?? key}</span>
                    <span className="text-right text-foreground">
                      <span className="text-muted-foreground line-through">{fmt(key, r.before[key])}</span>
                      {' → '}
                      <span className="font-semibold">{fmt(key, r.diff[key])}</span>
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-2.5 text-[12px] italic text-muted-foreground">"{r.reason}"</p>

              {rejectingId === r.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for rejecting (optional)"
                    className="min-h-[60px] w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-[12.5px] outline-none focus:border-foreground"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await requests.reject(r.id, rejectReason);
                        setRejectingId(null);
                        setRejectReason('');
                        stayoToast.success('Request rejected');
                      }}
                      className="flex-1 rounded-xl bg-destructive py-2.5 text-center text-[12.5px] font-bold text-white"
                    >
                      Confirm reject
                    </button>
                    <button type="button" onClick={() => setRejectingId(null)} className="rounded-xl border border-border px-4 py-2.5 text-[12.5px] font-semibold text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await requests.approve(r.id);
                      stayoToast.success('Approved and applied');
                    }}
                    disabled={requests.isApproving}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-foreground py-2.5 text-center text-[12.5px] font-bold text-background disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(r.id)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-[12.5px] font-semibold text-foreground"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
