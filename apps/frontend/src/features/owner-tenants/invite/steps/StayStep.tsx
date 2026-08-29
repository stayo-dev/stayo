import { useQuery } from '@tanstack/react-query';
import { roomService } from '@features/rooms/api';
import type { OwnerSessionHostel } from '@features/owner-session/useOwnerSession';
import type { InviteMode, InviteWizardData } from '../../types';
import { isBackdated, todayIso } from '../priorHistory';

interface StayStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
  hostels: OwnerSessionHostel[];
  /** Changes what the date field means and says. See ADR-141. */
  mode: InviteMode;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

interface VacantRoom {
  id: string;
  label: string;
}

/** Step 2/4 of the Invite Tenant wizard — which hostel, room, and when. Real hostels + real vacant rooms (`GET /api/rooms?grouped=true`). */
export function StayStep({ data, setD, hostels, mode }: StayStepProps) {
  const today = todayIso();
  const existing = mode === 'EXISTING';
  // Deliberately not a rent calculation — the exact months and amounts come
  // from the server on the History step. This only says whether the date is in
  // the past, so the owner is not surprised by a step appearing. See ADR-141.
  const backdated = existing && Boolean(data.joiningDate) && isBackdated(data.joiningDate, today);
  const roomsQuery = useQuery({
    queryKey: ['hostel', data.hostelId, 'rooms', 'grouped'],
    queryFn: () => roomService.getAll(data.hostelId, { grouped: true }),
    enabled: Boolean(data.hostelId),
    staleTime: 30_000,
  });

  const vacantRooms: VacantRoom[] = (roomsQuery.data ?? []).flatMap((floor: any) =>
    (floor.rooms ?? [])
      .filter((r: any) => Number(r.available) > 0)
      .map((r: any) => ({ id: r.id, label: `${r.room_no} · ${r.available} bed${r.available > 1 ? 's' : ''} free` })),
  );

  const selectHostel = (hostelId: string) => setD({ hostelId, roomId: '', roomLabel: '' });
  const selectRoom = (roomId: string) => {
    const room = vacantRooms.find((r) => r.id === roomId);
    setD({ roomId, roomLabel: room?.label ?? '' });
  };

  return (
    <div className="flex flex-col gap-4.5 rounded-2xl border border-border bg-muted p-4">
      <label className="block">
        <span className={labelStyle}>Hostel</span>
        <select
          value={data.hostelId}
          onChange={(e) => selectHostel(e.target.value)}
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        >
          <option value="" disabled>
            Select a hostel
          </option>
          {hostels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelStyle}>Room — vacant beds only</span>
        <select
          value={data.roomId}
          onChange={(e) => selectRoom(e.target.value)}
          disabled={!data.hostelId || roomsQuery.isLoading}
          className="w-full rounded-xl border-[1.5px] border-primary bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none disabled:opacity-50"
        >
          <option value="" disabled>
            {!data.hostelId ? 'Select a hostel first' : roomsQuery.isLoading ? 'Loading rooms…' : vacantRooms.length === 0 ? 'No vacant rooms' : 'Select a room'}
          </option>
          {vacantRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelStyle}>{existing ? 'When did they move in?' : 'Joining date'}</span>
        <input
          type="date"
          value={data.joiningDate}
          onChange={(e) => setD({ joiningDate: e.target.value })}
          // A tenant who is already living here cannot have arrived tomorrow.
          max={existing ? today : undefined}
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        />
        {/* Says what the date will cause, on the step where it is chosen —
            rather than letting the next step be a surprise. */}
        {existing && Boolean(data.joiningDate) && (
          <span className="mt-1.5 block text-[12px] leading-relaxed text-muted-foreground">
            {backdated
              ? "That's in the past — we'll ask what they've already paid before you finish."
              : "They moved in this month — we'll still ask what they've already paid."}
          </span>
        )}
      </label>
      <label className="block">
        <span className={labelStyle}>Agreement duration (months)</span>
        <input
          value={data.agreementMonths}
          onChange={(e) => setD({ agreementMonths: e.target.value.replace(/[^0-9]/g, '') })}
          inputMode="numeric"
          placeholder="12"
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>
    </div>
  );
}
