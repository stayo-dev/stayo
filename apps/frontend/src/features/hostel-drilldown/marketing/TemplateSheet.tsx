import { Check, FileText, Layers } from 'lucide-react';

import { MarketingSheet } from './MarketingSheet';
import { CARD_SHADOW, M } from './marketingTheme';

/**
 * `MODAL: MARKETING TEMPLATE` of `Stayo App.dc.html`.
 *
 * The design lists several reusable listing templates and offers to apply the
 * current page across other hostels. Stayo has one marketing page per hostel
 * and no endpoint that points two hostels at one revision, so the sheet keeps
 * the design's exact chrome and rows while saying plainly that this hostel's
 * page is the only one — rather than listing templates that don't exist and
 * failing on tap.
 *
 * Reuse is real work, not a missing button: one edit to a shared page would
 * re-open review for every hostel pointing at it, which is an approval-model
 * decision. Until that is designed, this sheet is honest about the state.
 */
export function TemplateSheet({
  open,
  hostelName,
  onClose,
}: {
  open: boolean;
  hostelName: string;
  onClose: () => void;
}) {
  return (
    <MarketingSheet open={open} onClose={onClose} title="Listing templates" subtitle="Reuse a page or start fresh">
      <div className="flex flex-col gap-2.5 pb-2">
        <div
          className="flex items-center gap-3 rounded-2xl bg-card p-[14px]"
          style={{ border: '1.5px solid var(--primary)', boxShadow: CARD_SHADOW }}
        >
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px]"
            style={{ background: M.iconTile, color: 'var(--primary)' }}
          >
            <FileText className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-bold text-foreground">{hostelName}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">This hostel's own listing page · in use</p>
          </div>
          <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        </div>

        <div
          className="mt-1 flex items-center gap-[11px] rounded-2xl p-[14px]"
          style={{ background: M.lockedBg, border: `1px dashed ${M.dashed}` }}
        >
          <span
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]"
            style={{ background: M.lockedTile, color: M.lockedText }}
          >
            <Layers className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="flex-1">
            <p className="font-display text-[12.5px] font-bold" style={{ color: M.outlineText }}>
              Apply this page to other hostels
            </p>
            <p className="mt-px text-[11px] text-muted-foreground">
              Coming soon — each hostel keeps its own page for now
            </p>
          </div>
        </div>
      </div>
    </MarketingSheet>
  );
}
