import { Building2 } from 'lucide-react';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';

interface ChooseHostelStepProps {
  onChoose: (hostelId: string) => void;
}

/**
 * Which hostel this import is for.
 *
 * Asked first, and never inferred, because the workbook is built from this
 * hostel's rooms and is stamped with its id — a sheet made for one hostel is
 * refused by another. Getting this wrong at the end would mean starting over.
 */
export function ChooseHostelStep({ onChoose }: ChooseHostelStepProps) {
  const session = useOwnerSession();
  const hostels = session.hostels ?? [];

  if (hostels.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-3.5 py-3 text-[12.5px] font-medium text-muted-foreground">
        Add a hostel first — the sheet is built from its rooms.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] font-medium text-muted-foreground">
        Your sheet is built from this hostel&apos;s rooms, so pick the right one.
      </p>
      <ul className="space-y-2">
        {hostels.map((hostel) => (
          <li key={hostel.id}>
            <button
              type="button"
              onClick={() => onChoose(hostel.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left"
            >
              <Building2 className="h-4 w-4 flex-none text-muted-foreground" />
              <span className="font-display text-[13.5px] font-bold text-foreground">{hostel.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
