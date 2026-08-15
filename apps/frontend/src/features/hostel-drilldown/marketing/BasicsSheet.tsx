import { useEffect, useState } from 'react';

import type { MarketingContent } from '@features/hostel-marketing/api';

import { MarketingSheet, SheetFooter, SheetInput, SheetLabel } from './MarketingSheet';
import { M } from './marketingTheme';

type Basics = MarketingContent['basics'];

/**
 * The editor behind the design's Basics rows.
 *
 * The design draws Basics as label/value rows with a chevron, each opening
 * something. Both of the fields Stayo actually stores are short, so one sheet
 * holds them rather than two near-identical sheets a chevron apart —
 * "tagline" and "about" are one thought.
 */
export function BasicsSheet({
  open,
  basics,
  focusField,
  onClose,
  onSave,
}: {
  open: boolean;
  basics: Basics;
  /** Which row was tapped — that field takes focus. */
  focusField: 'tagline' | 'about';
  onClose: () => void;
  onSave: (next: Basics) => void;
}) {
  const [draft, setDraft] = useState(basics);

  useEffect(() => {
    if (open) setDraft(basics);
  }, [open, basics]);

  return (
    <MarketingSheet
      open={open}
      onClose={onClose}
      title="Basics"
      subtitle="How your hostel introduces itself in search"
      footer={<SheetFooter secondaryLabel="Cancel" onSecondary={onClose} primaryLabel="Save" onPrimary={() => onSave(draft)} />}
    >
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <SheetLabel>Tagline</SheetLabel>
          <SheetInput
            primary
            value={draft.tagline ?? ''}
            maxLength={120}
            onChange={(tagline) => setDraft({ ...draft, tagline })}
            placeholder="Walk to campus, meals included"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            One line under your hostel name in search · {(draft.tagline ?? '').length}/120
          </p>
        </div>

        <div>
          <SheetLabel>About</SheetLabel>
          <textarea
            autoFocus={focusField === 'about'}
            value={draft.about ?? ''}
            rows={5}
            maxLength={2000}
            onChange={(event) => setDraft({ ...draft, about: event.target.value })}
            placeholder="What makes this place good to live in"
            className="w-full resize-none rounded-[11px] bg-card px-3.5 py-3 text-[13px] leading-[1.55] text-foreground outline-none"
            style={{ border: `1px solid ${M.inputLine}` }}
          />
        </div>
      </div>
    </MarketingSheet>
  );
}
