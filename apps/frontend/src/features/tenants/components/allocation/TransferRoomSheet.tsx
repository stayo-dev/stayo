import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Loader2 } from 'lucide-react';
import { allocationService, roomService } from '@features/rooms/api';
import { queryKeys } from '@lib/queryKeys';

interface Props {
  hostelId: string;
  tenantId: string;
  mode?: 'assign' | 'transfer';
  onClose: () => void;
  onSuccess?: () => void;
}

export function TransferRoomSheet({ hostelId, tenantId, mode = 'transfer', onClose, onSuccess }: Props) {
  const [roomId, setRoomId] = useState('');
  const qc = useQueryClient();
  const isAssignMode = mode === 'assign';

  const { data: roomsRaw = [], isLoading } = useQuery({
    queryKey: queryKeys.rooms.list(hostelId),
    queryFn: () => roomService.getAll(hostelId),
  });

  const rooms = (Array.isArray(roomsRaw) ? roomsRaw : []).filter((r: Record<string, unknown>) => {
    const st = String(r.status ?? '').toUpperCase();
    if (st === 'MAINTENANCE' || st === 'BLOCKED') return false;
    const available = Number(r.vacant_count ?? Math.max(Number(r.capacity ?? 1) - Number(r.used_count ?? r.occupied_count ?? 0), 0));
    return available > 0;
  });

  const shiftMutation = useMutation({
    mutationFn: () =>
      isAssignMode
        ? allocationService.allocate(hostelId, {
            tenant_id: tenantId,
            room_id: roomId,
            start_date: new Date().toISOString().split('T')[0],
          })
        : allocationService.shift(hostelId, {
            tenant_id: tenantId,
            new_room_id: roomId,
            shift_date: new Date().toISOString().split('T')[0],
          }),
    onSuccess: () => {
      toast.success(isAssignMode ? 'Room assigned' : 'Room transferred');
      qc.invalidateQueries({ queryKey: queryKeys.tenants.allocations(hostelId, tenantId) });
      qc.invalidateQueries({ queryKey: queryKeys.rooms.all(hostelId) });
      qc.invalidateQueries({ queryKey: queryKeys.rooms.list(hostelId) });
      onSuccess?.();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) =>
      toast.error(e?.response?.data?.error?.message ?? (isAssignMode ? 'Assignment failed' : 'Transfer failed')),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-card rounded-t-2xl md:rounded-2xl border border-border p-5 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">{isAssignMode ? 'Assign room' : 'Transfer room'}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>
        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-accent" />
        ) : (
          <>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm mb-4"
            >
              <option value="">Select room</option>
              {rooms.map((r: Record<string, unknown>) => (
                <option key={String(r.id)} value={String(r.id)}>
                  Room {String(r.room_no)} ({Number(r.used_count ?? r.occupied_count ?? 0)}/{Number(r.capacity ?? 1)})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!roomId || shiftMutation.isPending}
              onClick={() => shiftMutation.mutate()}
              className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold disabled:opacity-50"
            >
              {shiftMutation.isPending
                ? isAssignMode ? 'Assigning...' : 'Transferring...'
                : isAssignMode ? 'Confirm assignment' : 'Confirm transfer'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
