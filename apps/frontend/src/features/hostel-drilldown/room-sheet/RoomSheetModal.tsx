import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { getInitials } from '@features/tenants/utils/normalize';
import type { Floor, RoomWithOccupants } from '../types';

interface RoomSheetModalProps {
  open: boolean;
  room: RoomWithOccupants | null;
  floor: Floor | undefined;
  /** All floors on this hostel, for the "move to floor" reassignment select. */
  floors: Floor[];
  onClose: () => void;
  onAssign: () => void;
  onSaveDetails: (data: { room_no: string; base_rent: number; floor_id?: string }) => Promise<void>;
  isSaving?: boolean;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Tap an occupied/reserved room → rent/dues tiles + resident list + assign vacant beds, per Stayo App.dc.html. Real occupant data via `useHostelRooms`. "Edit room details" is a real `PATCH /rooms/:id` (number + rent + floor) — bed count isn't editable here since it can't safely go below occupied beds. Moving a room to a different floor happens here rather than by drag, since floors collapse independently (Rooms tab accordion) and can't both be open as drag targets at once. */
export function RoomSheetModal({ open, room, floor, floors, onClose, onAssign, onSaveDetails, isSaving }: RoomSheetModalProps) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState('');
  const [rent, setRent] = useState('');
  const [floorId, setFloorId] = useState('');

  useEffect(() => {
    if (open) setEditing(false);
  }, [open]);

  useEffect(() => {
    if (room) {
      setNumber(room.number);
      setRent(String(room.rent));
      setFloorId(room.floorId);
    }
  }, [room]);

  if (!room) return null;

  const handleSave = async () => {
    if (!number.trim()) {
      stayoToast.error('Room number is required');
      return;
    }
    try {
      await onSaveDetails({
        room_no: number.trim(),
        base_rent: Number(rent) || 0,
        ...(floorId && floorId !== room.floorId ? { floor_id: floorId } : {}),
      });
      stayoToast.success('Room details updated');
      setEditing(false);
    } catch {
      stayoToast.error('Could not update room details');
    }
  };

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
        editing ? (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-xl border border-border px-5 py-3 font-display text-[13px] font-bold text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex-1 rounded-xl bg-primary py-3 text-center font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full rounded-xl border border-border py-3 text-center font-display text-[13px] font-bold text-foreground"
          >
            ✎ Edit room details
          </button>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className={labelStyle}>Room name / number</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className="w-full rounded-[11px] border-[1.5px] border-primary bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none"
            />
          </label>
          <label className="block">
            <span className={labelStyle}>Monthly rent (per bed)</span>
            <div className="flex items-center rounded-[11px] border border-border bg-card px-3.5">
              <span className="text-sm font-semibold text-muted-foreground">₹</span>
              <input
                value={rent}
                onChange={(e) => setRent(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none"
              />
            </div>
          </label>
          {floors.length > 1 && (
            <label className="block">
              <span className={labelStyle}>Floor</span>
              <select
                value={floorId}
                onChange={(e) => setFloorId(e.target.value)}
                className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none"
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">Bed count can't be changed here — it can't safely go below the {occupied} bed{occupied === 1 ? '' : 's'} currently occupied.</p>
        </div>
      ) : (
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
              {residents.length === 0 && (
                <p className="p-4 text-center text-[12.5px] text-muted-foreground">No active tenants</p>
              )}
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
      )}
    </BottomSheet>
  );
}
