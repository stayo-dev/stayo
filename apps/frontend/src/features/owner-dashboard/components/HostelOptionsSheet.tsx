import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Archive, ArrowUp, ArrowDown } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useArchiveHostel } from '@features/settings/settingsHooks';
import { canMoveUp, canMoveDown } from '../property-order/hostelSort';

interface HostelOptionsSheetProps {
  open: boolean;
  onClose: () => void;
  hostelId: string | null;
  hostelName: string;
  /** Position in the owner's manual order; -1 when unknown. */
  index?: number;
  total?: number;
  onMove?: (hostelId: string, direction: -1 | 1) => void;
}

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Per-card "⋮" options on the owner dashboard's Property list — the kebab
 * menu was previously an unwired `stayoToast.info('Coming soon')` stub.
 * "Edit hostel details" opens the real Hostel Identity screen scoped to this
 * specific hostel (`/owner/more/hostel/:hostelId`); "Archive hostel" calls
 * the real `DELETE /hostels/:id`, which the backend itself blocks (with a
 * clear error) if the hostel still has active room allocations.
 *
 * Move up / Move down are the **keyboard and screen-reader path** for
 * reordering. Dragging the card handle is pointer-only, so without these the
 * feature would be unreachable without a mouse or touch. They're hidden
 * entirely when there's nothing to reorder. See ADR-042.
 */
export function HostelOptionsSheet({
  open,
  onClose,
  hostelId,
  hostelName,
  index = -1,
  total = 0,
  onMove,
}: HostelOptionsSheetProps) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const archiveMutation = useArchiveHostel();

  useEffect(() => {
    if (open) setConfirming(false);
  }, [open]);

  if (!hostelId) return null;

  const handleArchive = () => {
    archiveMutation.mutate(
      { hostelId },
      {
        onSuccess: () => {
          stayoToast.success(`${hostelName} archived`);
          onClose();
        },
        onError: (error) => {
          stayoToast.error(getErrorMessage(error, 'Could not archive this hostel'));
        },
      },
    );
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={confirming ? 'Archive hostel?' : hostelName}>
      {confirming ? (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">{hostelName}</b> will be archived and removed from your dashboard. This is blocked if it still has active tenants or room allocations.
          </p>
          {archiveMutation.isError && (
            <p className="text-[11.5px] font-semibold text-destructive">{getErrorMessage(archiveMutation.error, 'Could not archive this hostel')}</p>
          )}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              disabled={archiveMutation.isPending}
              onClick={handleArchive}
              className="flex-1 rounded-xl bg-destructive py-3.5 text-center font-display text-sm font-bold text-destructive-foreground disabled:opacity-50"
            >
              {archiveMutation.isPending ? 'Archiving…' : 'Archive hostel'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {onMove && index >= 0 && total > 1 && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canMoveUp(index)}
                onClick={() => onMove(hostelId, -1)}
                className="flex flex-1 items-center gap-2.5 rounded-2xl bg-muted p-3.5 text-left disabled:opacity-40"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card">
                  <ArrowUp className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.9} />
                </span>
                <div className="text-[13.5px] font-bold text-foreground">Move up</div>
              </button>
              <button
                type="button"
                disabled={!canMoveDown(index, total)}
                onClick={() => onMove(hostelId, 1)}
                className="flex flex-1 items-center gap-2.5 rounded-2xl bg-muted p-3.5 text-left disabled:opacity-40"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card">
                  <ArrowDown className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.9} />
                </span>
                <div className="text-[13.5px] font-bold text-foreground">Move down</div>
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/owner/more/hostel/${hostelId}`);
            }}
            className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-left"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-card">
              <Pencil className="h-4.5 w-4.5 text-muted-foreground" strokeWidth={1.9} />
            </span>
            <div className="text-[13.5px] font-bold text-foreground">Edit hostel details</div>
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-3 rounded-2xl border border-destructive/25 bg-card p-3.5 text-left"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-destructive/10">
              <Archive className="h-4.5 w-4.5 text-destructive" strokeWidth={1.9} />
            </span>
            <div className="text-[13.5px] font-bold text-destructive">Archive hostel</div>
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
