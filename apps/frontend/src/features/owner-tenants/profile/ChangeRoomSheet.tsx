import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Check, CalendarDays } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StayoLoader } from '@shared/ui/brand';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { allocationService, roomService } from '@features/rooms/api';
import { queryKeys } from '@lib/queryKeys';
import { toRoomOptions } from './roomOptions';

/**
 * Change a tenant's room in two taps: pick a room, confirm.
 *
 * Room change previously had no working path at all. "Change room" in the Stay
 * tab re-opened the generic Actions sheet, which has no room row; the only
 * other route was Request Change → Transfer Room, whose room field was a
 * free-text box expecting a UUID, submitted through the change-management
 * facade — which drops it, because `room_id` isn't a `tenant_profile` field.
 *
 * This goes to `POST /api/allocations/shift`, which closes the old allocation
 * and opens the new one transactionally.
 *
 * Deliberately absent: a reason field, an approval step, a confirmation
 * dialog. This is the owner's own room inventory, not a governed change.
 */

interface ChangeRoomSheetProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  tenantName: string;
  hostelId: string;
  currentRoomId: string | null;
  currentRoomNo: string;
  currentRent: number;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function ChangeRoomSheet({
  open,
  onClose,
  tenantId,
  tenantName,
  hostelId,
  currentRoomId,
  currentRoomNo,
  currentRent,
}: ChangeRoomSheetProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [dateOpen, setDateOpen] = useState(false);

  const { data: rooms, isLoading } = useQuery({
    queryKey: queryKeys.rooms.list(hostelId),
    queryFn: () => roomService.getAll(hostelId),
    enabled: open && Boolean(hostelId),
  });

  const options = toRoomOptions(rooms, { currentRoomId, currentRent });
  const selected = options.find((option) => option.id === selectedId) ?? null;

  const reset = () => {
    setSelectedId('');
    setEffectiveDate(today());
    setDateOpen(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const shift = useMutation({
    mutationFn: () =>
      allocationService.shift(hostelId, {
        tenant_id: tenantId,
        new_room_id: selectedId,
        shift_date: effectiveDate,
      }),
    onSuccess: () => {
      // Everything that names the tenant's room, so the owner doesn't see the
      // old one anywhere after the move.
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.allocations(hostelId, tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all(hostelId) });

      // A rent mismatch is worth saying out loud, but the move never touches
      // rent — that stays a separate, identity-confirmed decision, reachable
      // from the Stay tab's "Change rent".
      stayoToast.success(
        selected?.rentDiffers
          ? `Moved to Room ${selected.roomNo} — rent unchanged at ₹${currentRent.toLocaleString('en-IN')}`
          : `Moved to Room ${selected?.roomNo ?? ''}`,
      );
      close();
    },
    onError: (error: any) => {
      // Surface what roomAllocationService actually said — "room is full",
      // "tenant is not active" — rather than a generic failure.
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Could not move this tenant.';
      stayoToast.error(message);
    },
  });

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && close()} title={`Move ${tenantName} to…`}>
      <div className="flex flex-col gap-3">
        <p className="px-0.5 text-[11.5px] text-muted-foreground">
          Currently Room <b className="font-bold text-foreground">{currentRoomNo}</b>
        </p>

        {isLoading ? (
          <StayoLoader size="md" className="mx-auto my-6 text-primary" />
        ) : options.length === 0 ? (
          <EmptyState
            icon={<BedDouble className="h-5 w-5" />}
            title="No rooms with space"
            description="Every other room in this hostel is full, blocked, or under maintenance."
          />
        ) : (
          <ul className="flex max-h-[46dvh] flex-col gap-2 overflow-y-auto">
            {options.map((option) => {
              const isSelected = option.id === selectedId;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(option.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/8'
                        : 'border-border bg-card hover:bg-muted/60'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 flex-none items-center justify-center rounded-[11px] ${
                        isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isSelected ? (
                        <Check className="h-4.5 w-4.5" strokeWidth={2.4} />
                      ) : (
                        <BedDouble className="h-4.5 w-4.5" strokeWidth={1.9} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[14px] font-bold text-foreground">
                        Room {option.roomNo}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {option.free} of {option.capacity} free
                        {option.floor ? ` · Floor ${option.floor}` : ''}
                      </span>
                    </span>
                    {option.rentDiffers && (
                      <span className="flex-none rounded-md bg-warning/12 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-warning">
                        Rent differs
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {options.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 rounded-[13px] border border-border px-3.5 py-2.5">
              <CalendarDays className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                Effective
              </span>
              {dateOpen ? (
                <input
                  type="date"
                  value={effectiveDate}
                  autoFocus
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  onBlur={() => setDateOpen(false)}
                  aria-label="Effective date"
                  className="ml-auto rounded-lg border border-border bg-background px-2 py-1 text-[12.5px] text-foreground focus:outline-none"
                />
              ) : (
                <>
                  <span className="ml-auto font-display text-[12.5px] font-bold text-foreground">
                    {effectiveDate === today() ? 'Today' : effectiveDate}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDateOpen(true)}
                    className="text-[11.5px] font-bold text-primary"
                  >
                    change
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              disabled={!selected || shift.isPending}
              onClick={() => shift.mutate()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-[14px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(143,74,56,0.28)] transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              {shift.isPending ? (
                <>
                  <StayoLoader size="sm" label={null} />
                  Moving…
                </>
              ) : selected ? (
                `Move to Room ${selected.roomNo}`
              ) : (
                'Pick a room'
              )}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
