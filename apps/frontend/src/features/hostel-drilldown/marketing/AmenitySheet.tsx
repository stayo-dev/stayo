import { useEffect, useState } from 'react';

import { MarketingSheet, SheetFooter, SheetInput, SheetLabel } from './MarketingSheet';
import { M } from './marketingTheme';

/** The design's "or pick a common one" row. */
const SUGGESTIONS = [
  '3 meals / day',
  'High-speed Wi-Fi',
  'Free laundry',
  'Power backup',
  'Study desk',
  'Housekeeping',
  'CCTV security',
  'RO water',
  'AC rooms',
  'Parking',
];

/** `MODAL: MARKETING AMENITY` of `Stayo App.dc.html`. */
export function AmenitySheet({
  open,
  existing,
  onClose,
  onAdd,
}: {
  open: boolean;
  existing: string[];
  onClose: () => void;
  onAdd: (label: string) => void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  // Tapping a suggestion adds it and closes, so the common case is one tap.
  // Only the ones this hostel hasn't already listed are offered — a chip that
  // silently does nothing is worse than an absent chip.
  const remaining = SUGGESTIONS.filter(
    (suggestion) => !existing.some((label) => label.toLowerCase() === suggestion.toLowerCase()),
  );

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    onClose();
  };

  return (
    <MarketingSheet
      open={open}
      onClose={onClose}
      title="Add an amenity"
      subtitle="Anything extra your hostel offers"
      footer={
        <SheetFooter primaryLabel="Add to listing" onPrimary={submit} primaryDisabled={!value.trim()} />
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <SheetLabel>Amenity name</SheetLabel>
          <SheetInput primary value={value} onChange={setValue} placeholder="e.g. Rooftop lounge" maxLength={50} />
        </div>

        {remaining.length > 0 && (
          <div>
            <SheetLabel>Or pick a common one</SheetLabel>
            <div className="flex flex-wrap gap-2">
              {remaining.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    onAdd(suggestion);
                    onClose();
                  }}
                  className="rounded-[10px] bg-card px-3 py-2 text-[12px] font-semibold"
                  style={{ border: `1px solid ${M.inputLine}`, color: M.outlineText }}
                >
                  + {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </MarketingSheet>
  );
}
