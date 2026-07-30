import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { getInitials } from '@features/tenants/utils/normalize';
import type { Floor, RoomWithOccupants } from '../types';

interface RoomSheetModalProps {
  open: boolean;
  room: RoomWithOccupants | null;
  floor: Floor | undefined;
  onClose: () => void;
  onAssign: () => void;
}

/** Tap an occupied/reserved room → rent/dues tiles + resident list + assign vacant beds, per Stayo App.dc.html. Real occupant data via `useHostelRooms`. */
export function RoomSheetModal({ open, room, floor, onClose, onAssign }: RoomSheetModalProps) {
  const navigate = useNavigate();
  if (!room) return null;

  const occupied = room.beds.filter((b) => b.status === 'occupied').length;
  const vacant = room.beds.filter((b) => b.status === 'vacant').length;
  const residents = room.occupants;
  const pendingDues = residents.reduce((sum, t) => sum + t.pending_dues, 0);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col">
          <span>Room {room.number}</span>
          <span className="text-[11.5px] font-normal text-muted-foreground">
            {floor?.name} · {occupied}/{room.beds.length} beds occupied
          </span>
        </span>
      }
      footer={
        <button
          type="button"
          onClick={() => stayoToast.info('Coming soon')}
          className="w-full rounded-xl border border-border py-3 text-center font-display text-[13px] font-bold text-foreground"
        >
          ✎ Edit room details
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-2xl border border-border bg-card p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Monthly rent</div>
            <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-foreground">₹{room.rent.toLocaleString('en-IN')}</div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-card p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Pending dues</div>
            <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-destructive">₹{pendingDues.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Current residents</span>
            <span className="text-[10.5px] font-semibold text-primary">{vacant} beds available</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {residents.map((t) => (
              <button
                key={t.tenant_id}
                type="button"
                onClick={() => navigate(`/owner/tenants/${t.tenant_id}`)}
                className="flex w-full items-center gap-3 border-b border-border/60 p-3.5 text-left last:border-none"
              >
                <span className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-full bg-foreground font-display text-xs font-bold text-background">
                  {getInitials(t.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[13.5px] font-bold text-foreground">{t.name}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">₹{t.rent.toLocaleString('en-IN')}/mo</div>
                </div>
                {t.pending_dues > 0 ? (
                  <div className="flex flex-none flex-col items-end gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-warning">Due</span>
                    <span className="font-display text-[11.5px] font-bold tabular-nums text-destructive">₹{t.pending_dues.toLocaleString('en-IN')}</span>
                  </div>
                ) : (
                  <span className="flex-none text-muted-foreground">›</span>
                )}
              </button>
            ))}
            {vacant > 0 && (
              <button
                type="button"
                onClick={onAssign}
                className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 bg-muted/50 p-3 font-display text-[12.5px] font-bold text-primary"
              >
                + Assign {vacant} vacant bed{vacant > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
