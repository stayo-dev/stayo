import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Users, Wallet, Archive, ArrowRight } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useArchiveHostel } from '@features/settings/settingsHooks';

interface ArchiveHostelModalProps {
  open: boolean;
  onClose: () => void;
  hostelId: string | null;
  hostelName: string;
  activeTenantsCount?: number;
  outstandingDuesValue?: number;
}

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

export function ArchiveHostelModal({
  open,
  onClose,
  hostelId,
  hostelName,
  activeTenantsCount = 0,
  outstandingDuesValue = 0,
}: ArchiveHostelModalProps) {
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const archiveMutation = useArchiveHostel();

  if (!hostelId) return null;

  const isBlocked = activeTenantsCount > 0;

  const handleConfirmArchive = () => {
    archiveMutation.mutate(
      { hostelId, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          stayoToast.success(`${hostelName} has been archived successfully`);
          setReason('');
          onClose();
        },
        onError: (error) => {
          stayoToast.error(getErrorMessage(error, 'Could not archive this hostel'));
        },
      },
    );
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={`Archive ${hostelName}`}>
      <div className="flex flex-col gap-4.5 pt-1">
        {/* Info Banner */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex gap-2.5">
            <Archive className="h-5 w-5 flex-none text-amber-600 dark:text-amber-400" />
            <div className="text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-200">
              Archiving closes operations for <b className="font-semibold">{hostelName}</b>.
              Historical records (tenants, transactions, expenses) are permanently retained for reporting and audit.
            </div>
          </div>
        </div>

        {/* Blocking Check: Active Tenants */}
        {isBlocked ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-destructive">
              <Users className="h-4.5 w-4.5" />
              <span className="font-display text-sm font-bold">
                Blocked: {activeTenantsCount} Active {activeTenantsCount === 1 ? 'Tenant' : 'Tenants'}
              </span>
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              You must complete checkout/move-out for all active tenants before archiving this property.
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/owner/tenants?hostelId=${hostelId}`);
              }}
              className="flex items-center justify-between rounded-xl bg-destructive px-3.5 py-2.5 text-[12.5px] font-bold text-destructive-foreground transition-opacity hover:opacity-90"
            >
              <span>Manage & Check-out Tenants</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            {/* Warning Check: Outstanding Dues */}
            {outstandingDuesValue > 0 && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-orange-200 bg-orange-50/60 p-3.5 dark:border-orange-900/30 dark:bg-orange-950/20">
                <AlertTriangle className="h-4.5 w-4.5 flex-none text-orange-600 dark:text-orange-400 mt-0.5" />
                <div className="text-[12px] leading-relaxed text-orange-900 dark:text-orange-200">
                  <span className="font-bold">Outstanding Dues Warning:</span> ₹{outstandingDuesValue.toLocaleString('en-IN')} in unpaid dues remain linked to this property. Historical debt queries will continue to track these records.
                </div>
              </div>
            )}

            {/* Optional Reason Input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
                Reason for Closure (Optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Lease expired, property sold, seasonal shutdown…"
                rows={2}
                className="w-full rounded-xl border border-border bg-card p-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {archiveMutation.isError && (
              <p className="text-[11.5px] font-semibold text-destructive">
                {getErrorMessage(archiveMutation.error, 'Could not archive this hostel')}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveMutation.isPending}
                onClick={handleConfirmArchive}
                className="flex-1 rounded-xl bg-destructive py-3.5 text-center font-display text-sm font-bold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {archiveMutation.isPending ? 'Archiving Property…' : 'Confirm & Archive Property'}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
