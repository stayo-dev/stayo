import { useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { RETURN_SHEET_TITLE, suggestedLabel, type ReturnDateMode } from '../stayState';
import type { SuggestedReturn } from '../types';

interface ReturnDateSheetProps {
  mode: ReturnDateMode;
  suggested: SuggestedReturn;
  minDate: string;
  maxDate: string;
  /** Pre-filled date for the picker — the current return date when changing it. */
  initialDate?: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/**
 * Going home is ONE button — the smart default ("Back Sunday" Thu–Fri,
 * otherwise "Back tomorrow") — with any other date one tap further down.
 * Vacation and changing a date have no sensible default, so they open on
 * the picker. See ADR-193.
 */
export function ReturnDateSheet({ mode, suggested, minDate, maxDate, initialDate, onPick, onClose }: ReturnDateSheetProps) {
  const [showPicker, setShowPicker] = useState(mode !== 'GOING_HOME');
  const [date, setDate] = useState(initialDate ?? suggested.date);

  return (
    <BottomSheet open onOpenChange={(open) => !open && onClose()} title={RETURN_SHEET_TITLE[mode]}>
      <div className="flex flex-col gap-3 pb-2">
        {mode === 'GOING_HOME' && (
          <button
            type="button"
            onClick={() => onPick(suggested.date)}
            className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground active:scale-[0.99]"
          >
            {suggestedLabel(suggested)}
          </button>
        )}
        {showPicker ? (
          <>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Return date"
              className="h-12 w-full rounded-xl border border-border bg-muted px-3 text-base text-foreground"
            />
            <button
              type="button"
              disabled={!date}
              onClick={() => onPick(date)}
              className="h-12 w-full rounded-xl bg-foreground font-bold text-background disabled:opacity-50"
            >
              {mode === 'CHANGE_DATE' ? 'Save new date' : 'Confirm'}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setShowPicker(true)} className="py-2 text-sm font-semibold text-muted-foreground">
            Other date
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
