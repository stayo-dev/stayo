import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Check, CalendarDays, Building2, AlertCircle } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StayoLoader } from '@shared/ui/brand';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { allocationService, roomService } from '@features/rooms/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { queryKeys } from '@lib/queryKeys';
import { tenantTransferService } from '../api/tenantTransfer';
import { toRoomOptions } from './roomOptions';
import { planRoomMove } from './roomMovePlan';

/**
 * Move a tenant to another room — in this hostel, or another one the owner
 * runs.
 *
 * Two taps for the ordinary case: pick a room, confirm. The hostel selector
 * appears only when the owner actually has more than one property, so a
 * single-hostel owner never pays for a choice they don't have.
 *
 * Which backend operation runs is decided by the destination, not by the owner
 * — `planRoomMove` picks between `allocationService.shift` (same hostel) and
 * `tenantTransferService.transfer` (across hostels). The two are not
 * interchangeable: transfer rewrites `tenants.hostel_id`, writes an audit row,
 * and refuses a same-hostel move outright.
 *
 * Deliberately absent for a same-hostel shift: a reason field, an approval
 * step, a confirmation dialog. It is the owner's own room inventory. A hostel
 * change does get an explicit consequence note, because it moves the tenant
 * between properties and leaves their financial history behind.
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
  const session = useOwnerSession();

  const [targetHostelId, setTargetHostelId] = useState(hostelId);
  const [selectedId, setSelectedId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [dateOpen, setDateOpen] = useState(false);

  // Reopening for a different tenant must not inherit the last one's
  // destination — this sheet is mounted once and reused.
  useEffect(() => {
    if (open) {
      setTargetHostelId(hostelId);
      setSelectedId('');
      setEffectiveDate(today());
      setDateOpen(false);
    }
  }, [open, hostelId, tenantId]);

  const hostels = session.hostels ?? [];
  const multiHostel = hostels.length > 1;
  const targetHostel = hostels.find((h) => h.id === targetHostelId) ?? null;
  const currentHostelName = hostels.find((h) => h.id === hostelId)?.name ?? null;

  const { data: rooms, isLoading } = useQuery({
    queryKey: queryKeys.rooms.list(targetHostelId),
    queryFn: () => roomService.getAll(targetHostelId),
    enabled: open && Boolean(targetHostelId),
  });

  const options = toRoomOptions(rooms, {
    // Only the tenant's own hostel has a room to exclude.
    currentRoomId: targetHostelId === hostelId ? currentRoomId : null,
    currentRent,
  });
  const selected = options.find((option) => option.id === selectedId) ?? null;

  const plan = planRoomMove({
    currentHostelId: hostelId,
    targetHostelId,
    targetRoomNo: selected?.roomNo,
    targetHostelName: targetHostel?.name,
  });

  const move = useMutation({
    mutationFn: () => {
      if (plan.kind === 'transfer') {
        return tenantTransferService.transfer({
          tenantId,
          targetRoomId: selectedId,
          reason: `Moved to ${targetHostel?.name ?? 'another hostel'} by owner`,
        });
      }
      return allocationService.shift(hostelId, {
        tenant_id: tenantId,
        new_room_id: selectedId,
        shift_date: effectiveDate,
      });
    },
    onSuccess: () => {
      // Everything naming the tenant's room or hostel. A transfer moves them
      // between properties, so both hostels' lists have to be refreshed.
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.allocations(hostelId, tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
      for (const id of new Set([hostelId, targetHostelId])) {
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all(id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list(id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all(id) });
      }

      stayoToast.success(
        plan.crossHostel
          ? `Moved to Room ${selected?.roomNo} at ${targetHostel?.name ?? 'the new hostel'}`
          : selected?.rentDiffers
            ? `Moved to Room ${selected.roomNo} — rent unchanged at ₹${currentRent.toLocaleString('en-IN')}`
            : `Moved to Room ${selected?.roomNo ?? ''}`,
      );
      onClose();
    },
    onError: (error: any) => {
      // Surface what the service actually said — "Target room is at maximum
      // capacity", "blocked by an active move-out workflow", "blocked by an
      // unresolved settlement" — rather than a generic failure.
      const raw =
        error?.response?.data?.error?.message || error?.message || 'Could not move this tenant.';
      stayoToast.error(raw.replace(/^(VALIDATION_ERROR|FORBIDDEN|NOT_FOUND):\s*/, ''));
    },
  });

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} title={`Move ${tenantName}`}>
      <div className="flex flex-col gap-3">
        <p className="px-0.5 text-[11.5px] text-muted-foreground">
          Currently Room <b className="font-bold text-foreground">{currentRoomNo}</b>
          {multiHostel && currentHostelName ? (
            <> at <b className="font-bold text-foreground">{currentHostelName}</b></>
          ) : null}
        </p>

        {multiHostel && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {hostels.map((hostel) => {
              const active = hostel.id === targetHostelId;
              return (
                <button
                  key={hostel.id}
                  type="button"
                  onClick={() => {
                    setTargetHostelId(hostel.id);
                    setSelectedId('');
                  }}
                  aria-pressed={active}
                  className={`flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 font-display text-[12px] font-bold transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {hostel.name}
                </button>
              );
            })}
          </div>
        )}

        {plan.consequence && (
          <div className="flex items-start gap-2 rounded-[13px] border border-warning/25 bg-warning/8 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-warning" strokeWidth={1.9} />
            <p className="text-[11.5px] leading-relaxed text-foreground">{plan.consequence}</p>
          </div>
        )}

        {isLoading ? (
          <StayoLoader size="md" className="mx-auto my-6 text-primary" />
        ) : options.length === 0 ? (
          <EmptyState
            icon={<BedDouble className="h-5 w-5" />}
            title="No rooms with space"
            description={
              multiHostel
                ? `Every room at ${targetHostel?.name ?? 'this hostel'} is full, blocked, or under maintenance.`
                : 'Every other room in this hostel is full, blocked, or under maintenance.'
            }
          />
        ) : (
          <ul className="flex max-h-[42dvh] flex-col gap-2 overflow-y-auto">
            {options.map((option) => {
              const isSelected = option.id === selectedId;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(option.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                      isSelected ? 'border-primary bg-primary/8' : 'border-border bg-card hover:bg-muted/60'
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
            {/* A transfer's date is the service's own `transferDate`, which it
                defaults to now — exposing a second, ignored date field here
                would be a lie. Only a shift takes one. */}
            {!plan.crossHostel && (
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
            )}

            <button
              type="button"
              disabled={!selected || move.isPending}
              onClick={() => move.mutate()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-[14px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(143,74,56,0.28)] transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              {move.isPending ? (
                <>
                  <StayoLoader size="sm" label={null} />
                  Moving…
                </>
              ) : (
                plan.confirmLabel
              )}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
