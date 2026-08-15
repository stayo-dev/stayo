import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';

import { MarketingSheet, SheetFooter, SheetInput, SheetLabel } from './MarketingSheet';
import { amenityIcon } from './amenityIcons';
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

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `MODAL: MARKETING AMENITY` of `Stayo App.dc.html`.
 *
 * **Multi-select.** An owner listing what their hostel provides is ticking off
 * a set, not answering one question — so tapping a suggestion toggles it and
 * the sheet stays open, and everything selected is added in one go. It used to
 * add-and-close on the first tap, which made listing six amenities six trips
 * through the same sheet.
 *
 * Custom names go into the same selection rather than committing on their own,
 * so typed and tapped amenities behave identically and "Add" means one thing.
 */
export function AmenitySheet({
  open,
  existing,
  onClose,
  onAdd,
}: {
  open: boolean;
  existing: string[];
  onClose: () => void;
  onAdd: (labels: string[]) => void;
}) {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setValue('');
      setSelected([]);
    }
  }, [open]);

  const alreadyOnListing = (label: string) => existing.some((entry) => sameLabel(entry, label));
  const isSelected = (label: string) => selected.some((entry) => sameLabel(entry, label));

  const toggle = (label: string) =>
    setSelected((current) =>
      current.some((entry) => sameLabel(entry, label))
        ? current.filter((entry) => !sameLabel(entry, label))
        : [...current, label],
    );

  /** Adds the typed name to the selection — it is not committed on its own. */
  const addTyped = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (alreadyOnListing(trimmed)) {
      setValue('');
      return;
    }
    if (!isSelected(trimmed)) setSelected((current) => [...current, trimmed]);
    setValue('');
  };

  const commit = () => {
    // A name half-typed when the owner hits Add is clearly meant to count.
    const pending = value.trim();
    const all = pending && !isSelected(pending) && !alreadyOnListing(pending)
      ? [...selected, pending]
      : selected;
    if (all.length === 0) return;
    onAdd(all);
    onClose();
  };

  // Suggestions already on the listing are dropped — a chip that silently does
  // nothing is worse than an absent chip.
  const remaining = SUGGESTIONS.filter((suggestion) => !alreadyOnListing(suggestion));
  const customSelected = selected.filter(
    (label) => !SUGGESTIONS.some((suggestion) => sameLabel(suggestion, label)),
  );
  const pendingCount = selected.length + (value.trim() && !isSelected(value) && !alreadyOnListing(value) ? 1 : 0);

  return (
    <MarketingSheet
      open={open}
      onClose={onClose}
      title="Add amenities"
      subtitle="Tap everything your hostel provides"
      footer={
        <SheetFooter
          primaryLabel={
            pendingCount === 0
              ? 'Select amenities to add'
              : `Add ${pendingCount} to listing`
          }
          onPrimary={commit}
          primaryDisabled={pendingCount === 0}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {remaining.length > 0 && (
          <div>
            <SheetLabel>Common amenities</SheetLabel>
            <div className="flex flex-wrap gap-2">
              {remaining.map((suggestion) => {
                const on = isSelected(suggestion);
                const Icon = amenityIcon(suggestion);
                return (
                  <button
                    key={suggestion}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(suggestion)}
                    className="flex items-center gap-[7px] rounded-[10px] px-3 py-2 text-[12px] font-semibold"
                    style={
                      on
                        ? { background: M.iconTile, border: '1.5px solid var(--primary)', color: '#4A433C' }
                        : { background: '#FFFFFF', border: `1px solid ${M.inputLine}`, color: M.outlineText }
                    }
                  >
                    {on ? (
                      <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.6} />
                    ) : (
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                    )}
                    {suggestion}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <SheetLabel>Something else?</SheetLabel>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <SheetInput
                primary
                value={value}
                onChange={setValue}
                placeholder="e.g. Rooftop lounge"
                maxLength={50}
                onEnter={addTyped}
              />
            </div>
            <button
              type="button"
              onClick={addTyped}
              disabled={!value.trim()}
              aria-label="Add this amenity to the selection"
              className="flex-none rounded-[11px] px-4 font-display text-[13px] font-bold text-white disabled:opacity-40"
              style={{ background: M.ink }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
            </button>
          </div>
        </div>

        {customSelected.length > 0 && (
          <div>
            <SheetLabel>Your own</SheetLabel>
            <div className="flex flex-wrap gap-2">
              {customSelected.map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed
                  onClick={() => toggle(label)}
                  className="flex items-center gap-[7px] rounded-[10px] px-3 py-2 text-[12px] font-semibold"
                  style={{ background: M.iconTile, border: '1.5px solid var(--primary)', color: '#4A433C' }}
                >
                  <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.6} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </MarketingSheet>
  );
}
