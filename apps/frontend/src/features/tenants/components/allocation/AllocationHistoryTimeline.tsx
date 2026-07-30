import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BedDouble, ArrowRightLeft } from 'lucide-react';
import { allocationService } from '@features/rooms/api';
import { queryKeys } from '@lib/queryKeys';
import { TransferRoomSheet } from './TransferRoomSheet';

interface Props {
  hostelId: string;
  tenantId: string;
  allocations: unknown;
  currentRoom?: Record<string, unknown> | null;
  onChanged?: () => void;
}

export function AllocationHistoryTimeline({ hostelId, tenantId, allocations, currentRoom, onChanged }: Props) {
  const [showTransfer, setShowTransfer] = useState(false);
  const qc = useQueryClient();

  const list = Array.isArray(allocations)
    ? allocations
    : Array.isArray((allocations as Record<string, unknown>)?.data)
      ? ((allocations as Record<string, unknown>).data as Record<string, unknown>[])
    : Array.isArray((allocations as Record<string, unknown>)?.history)
      ? ((allocations as Record<string, unknown>).history as Record<string, unknown>[])
      : Array.isArray((allocations as Record<string, unknown>)?.allocations)
        ? ((allocations as Record<string, unknown>).allocations as Record<string, unknown>[])
        : [];

  const active = list.find((a) => a.is_active === true && !a.end_date);
  const fallbackRoomNo = currentRoom?.room_no ?? currentRoom?.room_number ?? null;
  const fallbackFloor = currentRoom?.floor ?? null;

  const endMutation = useMutation({
    mutationFn: (allocationId: string) => allocationService.end(allocationId, {}),
    onSuccess: () => {
      toast.success('Allocation ended');
      qc.invalidateQueries({ queryKey: queryKeys.tenants.allocations(hostelId, tenantId) });
      onChanged?.();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string } } } }) =>
      toast.error(e?.response?.data?.error?.message ?? 'Failed to end allocation'),
  });

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 mb-2">
          <BedDouble className="w-4 h-4 text-accent" />
          <span className="font-semibold text-foreground">Current room</span>
        </div>
        {active ? (
          <>
            <p className="text-lg font-bold">
              Room {String((active.room as Record<string, unknown>)?.room_no ?? active.room_no ?? '—')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Since{' '}
              {active.start_date
                ? new Date(String(active.start_date)).toLocaleDateString('en-IN')
                : '—'}
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowTransfer(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold touch-manipulation"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Transfer
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('End this allocation?')) {
                    endMutation.mutate(String(active.id));
                  }
                }}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium"
              >
                Remove
              </button>
            </div>
          </>
        ) : fallbackRoomNo ? (
          <>
            <p className="text-lg font-bold">Room {String(fallbackRoomNo)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Active room from tenant profile{fallbackFloor != null ? ` · Floor ${String(fallbackFloor)}` : ''}
            </p>
            <button
              type="button"
              onClick={() => setShowTransfer(true)}
              className="mt-4 flex w-full items-center justify-center gap-1.5 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold touch-manipulation"
            >
              <BedDouble className="w-4 h-4" />
              Assign room record
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No active room assignment</p>
            <button
              type="button"
              onClick={() => setShowTransfer(true)}
              className="mt-4 flex w-full items-center justify-center gap-1.5 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold touch-manipulation"
            >
              <BedDouble className="w-4 h-4" />
              Assign Room
            </button>
          </>
        )}
      </div>

      {list.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">History</h4>
          {list.map((a) => (
            <div
              key={String(a.id)}
              className="flex items-center gap-3 p-3 rounded-lg border border-border text-sm"
            >
              <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
              <div>
                <p className="font-medium">
                  Room {String((a.room as Record<string, unknown>)?.room_no ?? a.room_no ?? '—')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.start_date ? new Date(String(a.start_date)).toLocaleDateString('en-IN') : '—'}
                  {a.end_date
                    ? ` → ${new Date(String(a.end_date)).toLocaleDateString('en-IN')}`
                    : ' · Active'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showTransfer && (
        <TransferRoomSheet
          hostelId={hostelId}
          tenantId={tenantId}
          mode={active ? 'transfer' : 'assign'}
          onClose={() => setShowTransfer(false)}
          onSuccess={() => {
            setShowTransfer(false);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
