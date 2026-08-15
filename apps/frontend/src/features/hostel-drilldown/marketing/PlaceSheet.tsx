import { useEffect, useState } from 'react';
import { GraduationCap, MapPin, ShoppingBag, Stethoscope, TrainFront } from 'lucide-react';

import type { MarketingPlace, PlaceCategory } from '@features/hostel-marketing/api';

import { MarketingSheet, SheetFooter, SheetInput, SheetLabel } from './MarketingSheet';
import { M } from './marketingTheme';

export const PLACE_CATEGORIES: { value: PlaceCategory; label: string; Icon: typeof MapPin }[] = [
  { value: 'COLLEGE', label: 'College', Icon: GraduationCap },
  { value: 'TRANSPORT', label: 'Transport', Icon: TrainFront },
  { value: 'MARKET', label: 'Market', Icon: ShoppingBag },
  { value: 'HOSPITAL', label: 'Hospital', Icon: Stethoscope },
  { value: 'OTHER', label: 'Other', Icon: MapPin },
];

export function placeIcon(category: PlaceCategory) {
  return PLACE_CATEGORIES.find((entry) => entry.value === category)?.Icon ?? MapPin;
}

/**
 * `MODAL: MARKETING PLACE` of `Stayo App.dc.html`.
 *
 * The design's category row is icon-only 44px squares. Each carries its label
 * as an accessible name rather than visible text, so the row stays as drawn
 * without becoming five unlabelled buttons to anyone not reading it by eye.
 */
export function PlaceSheet({
  open,
  place,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  place: MarketingPlace | null;
  onClose: () => void;
  onSave: (next: MarketingPlace) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<MarketingPlace | null>(place);

  useEffect(() => setDraft(place), [place]);

  if (!draft) return null;

  const patch = (next: Partial<MarketingPlace>) => setDraft({ ...draft, ...next });

  return (
    <MarketingSheet
      open={open}
      onClose={onClose}
      title={place?.name ? 'Edit place' : 'Add a nearby place'}
      footer={
        <SheetFooter
          secondaryLabel="Remove"
          onSecondary={onRemove}
          primaryLabel="Save"
          onPrimary={() => onSave(draft)}
          primaryDisabled={!draft.name.trim()}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <SheetLabel>Place name</SheetLabel>
          <SheetInput
            primary
            value={draft.name}
            maxLength={80}
            onChange={(name) => patch({ name })}
            placeholder="Osmania University"
          />
        </div>

        <div>
          <SheetLabel>Distance</SheetLabel>
          <SheetInput
            value={draft.distance}
            maxLength={24}
            onChange={(distance) => patch({ distance })}
            placeholder="400 m"
          />
        </div>

        <div>
          <SheetLabel>Category</SheetLabel>
          <div className="flex flex-wrap gap-[9px]">
            {PLACE_CATEGORIES.map(({ value, label, Icon }) => {
              const active = draft.category === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => patch({ category: value })}
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{
                    background: active ? M.iconTile : '#FFFFFF',
                    border: active ? '1.5px solid var(--primary)' : `1px solid ${M.inputLine}`,
                    color: active ? 'var(--primary)' : M.chipText,
                  }}
                >
                  <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </MarketingSheet>
  );
}
