import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { roomService } from '@domains/rooms/api';
import { queryKeys } from '@lib/queryKeys';
import { formatMoney } from './invitationWorkspace';

/**
 * Picks the bed being offered.
 *
 * The room currently held for this tenant always stays selectable even if it
 * now reads as full — the invitation's own reservation is what is occupying
 * that slot, so filtering it out would make the tenant's own bed disappear.
 *
 * Moving a tenant to a different room usually means the money should follow.
 * Rather than silently rewriting rent behind the owner's back, the room's own
 * defaults are offered as an explicit, pre-ticked choice at the moment of the
 * change — which is the only moment it makes sense to ask.
 */

export interface RoomChoice {
  roomId: string;
  roomLabel: string;
  applyDefaults: boolean;
  defaults: { monthlyRent: number; deposit: number; maintenanceCharge: number; maintenanceType: string } | null;
}

interface RoomPickerSheetProps {
  open: boolean;
  onClose: () => void;
  hostelId: string;
  currentRoomId: string;
  onSave: (choice: RoomChoice) => void;
}

export function RoomPickerSheet({ open, onClose, hostelId, currentRoomId, onSave }: RoomPickerSheetProps) {
  const [selectedId, setSelectedId] = useState(currentRoomId);
  const [applyDefaults, setApplyDefaults] = useState(true);

  useEffect(() => {
    if (open) {
      setSelectedId(currentRoomId);
      setApplyDefaults(true);
    }
  }, [open, currentRoomId]);

  const { data: roomsRaw = [], isLoading } = useQuery({
    queryKey: queryKeys.rooms.list(hostelId),
    queryFn: () => roomService.getAll(hostelId),
    enabled: open && Boolean(hostelId),
    staleTime: 2 * 60 * 1000,
  });

  const rooms: Record<string, any>[] = Array.isArray(roomsRaw) ? roomsRaw : [];
  const selectable = rooms.filter((room) => {
    if (String(room.id) === currentRoomId) return true;
    const status = String(room.status ?? '').toUpperCase();
    if (status === 'MAINTENANCE' || status === 'BLOCKED') return false;
    return Number(room.occupied_count ?? 0) < Number(room.capacity ?? 1);
  });

  const isMoving = selectedId !== currentRoomId && Boolean(selectedId);

  // Only fetched once the owner has actually chosen a different room — the
  // defaults are a consequence of the move, not of opening the sheet.
  const { data: defaultsRaw } = useQuery({
    queryKey: ['invite-defaults', selectedId],
    queryFn: () => roomService.getInviteDefaults(selectedId),
    enabled: open && isMoving,
    staleTime: 2 * 60 * 1000,
  });

  const resolved = defaultsRaw?.data?.resolved_values ?? defaultsRaw?.resolved_values ?? null;
  const defaults = resolved
    ? {
        monthlyRent: Number(resolved.monthly_rent ?? 0),
        deposit: Number(resolved.advance_deposit ?? 0),
        maintenanceCharge: Number(resolved.maintenance_charge ?? 0),
        maintenanceType: String(resolved.maintenance_type ?? 'NONE'),
      }
    : null;

  const handleSave = () => {
    const room = rooms.find((r) => String(r.id) === selectedId);
    onSave({
      roomId: selectedId,
      roomLabel: room ? String(room.room_no) : '',
      applyDefaults: isMoving && applyDefaults && Boolean(defaults),
      defaults,
    });
    onClose();
  };

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} title="Change room">
      <div className="flex flex-col gap-3">
        {isLoading && <p className="py-6 text-center text-[13px] text-muted-foreground">Loading rooms…</p>}

        {!isLoading && selectable.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No rooms with a free bed in this hostel.
          </p>
        )}

        <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
          {selectable.map((room) => {
            const id = String(room.id);
            const isCurrent = id === currentRoomId;
            const isSelected = id === selectedId;
            const occupied = Number(room.occupied_count ?? 0);
            const capacity = Number(room.capacity ?? 1);
            const free = Math.max(capacity - occupied, 0);

            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedId(id)}
                className={`flex min-h-[56px] items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-muted">
                  <BedDouble className="h-4.5 w-4.5 text-foreground" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold text-foreground">
                    Room {String(room.room_no)}
                    {room.floor_name ? ` · ${String(room.floor_name)}` : ''}
                  </span>
                  <span className="block text-[11.5px] font-semibold text-muted-foreground">
                    {isCurrent ? 'Currently held for this tenant' : `${free} of ${capacity} beds free`}
                    {room.base_rent ? ` · ${formatMoney(Number(room.base_rent))}/mo` : ''}
                  </span>
                </span>
                {isSelected && <Check className="h-4.5 w-4.5 flex-none text-primary" strokeWidth={2.4} />}
              </button>
            );
          })}
        </div>

        {isMoving && defaults && (
          <label className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-3.5">
            <input
              type="checkbox"
              checked={applyDefaults}
              onChange={(e) => setApplyDefaults(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--primary)]"
            />
            <span className="text-[12.5px] leading-relaxed text-foreground">
              Also use this room's pricing —{' '}
              <b className="font-bold">{formatMoney(defaults.monthlyRent)}/mo</b> rent and{' '}
              <b className="font-bold">{formatMoney(defaults.deposit)}</b> deposit.
              <span className="mt-0.5 block text-muted-foreground">Untick to keep the amounts you already agreed.</span>
            </span>
          </label>
        )}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl border border-border bg-card font-display text-[14px] font-bold text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedId}
            className="min-h-[48px] flex-1 rounded-xl bg-primary font-display text-[14px] font-bold text-primary-foreground shadow-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            Done
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
