import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Archive, ArrowUp, ArrowDown } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { canMoveUp, canMoveDown } from '../property-order/hostelSort';
import { ArchiveHostelModal } from './ArchiveHostelModal';

interface HostelOptionsSheetProps {
  open: boolean;
  onClose: () => void;
  hostelId: string | null;
  hostelName: string;
  activeTenantsCount?: number;
  outstandingDuesValue?: number;
  /** Position in the owner's manual order; -1 when unknown. */
  index?: number;
  total?: number;
  onMove?: (hostelId: string, direction: -1 | 1) => void;
}

export function HostelOptionsSheet({
  open,
  onClose,
  hostelId,
  hostelName,
  activeTenantsCount = 0,
  outstandingDuesValue = 0,
  index = -1,
  total = 0,
  onMove,
}: HostelOptionsSheetProps) {
  const navigate = useNavigate();
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);

  if (!hostelId) return null;

  return (
    <>
      <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={hostelName}>
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
            onClick={() => {
              onClose();
              setArchiveModalOpen(true);
            }}
            className="flex items-center gap-3 rounded-2xl border border-destructive/25 bg-card p-3.5 text-left"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-destructive/10">
              <Archive className="h-4.5 w-4.5 text-destructive" strokeWidth={1.9} />
            </span>
            <div className="text-[13.5px] font-bold text-destructive">Archive hostel</div>
          </button>
        </div>
      </BottomSheet>

      <ArchiveHostelModal
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        hostelId={hostelId}
        hostelName={hostelName}
        activeTenantsCount={activeTenantsCount}
        outstandingDuesValue={outstandingDuesValue}
      />
    </>
  );
}
