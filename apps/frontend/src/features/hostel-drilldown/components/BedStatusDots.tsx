import type { RoomBed } from '@shared/mocks/rooms';

const DOT_CLASS: Record<RoomBed['status'], string> = {
  occupied: 'bg-success',
  reserved: 'bg-warning',
  vacant: 'border-[1.5px] border-border',
};

/** The 4-dot occupied/reserved/vacant bed indicator, per Stayo App.dc.html's Rooms tab. */
export function BedStatusDots({ beds }: { beds: RoomBed[] }) {
  return (
    <div className="flex flex-none gap-1">
      {beds.map((b) => (
        <span key={b.id} className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[b.status]}`} />
      ))}
    </div>
  );
}
