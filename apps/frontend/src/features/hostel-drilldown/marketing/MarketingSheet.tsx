import type { ReactNode } from 'react';

import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

import { M } from './marketingTheme';

interface MarketingSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The second line the design puts under every sheet title. */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The sheet chrome shared by the marketing page's five bottom sheets, per the
 * `MODAL: MARKETING *` blocks of `Stayo App.dc.html`.
 *
 * Built on the shared `BottomSheet` in `hideHeader` mode rather than a fresh
 * scrim/drag implementation — that primitive already owns the overlay, drag
 * and focus mechanics for every sheet in the app, and it documents
 * `hideHeader` for exactly this case: a sheet whose own design spec gives it a
 * different header. What differs here is only the header itself — a title with
 * a subtitle under it and a filled circular close button, where the default is
 * a bare title and an outlined one.
 *
 * The design pins each sheet to a fixed offset from the top of the device
 * (96px for the mess editor, 200px for the short ones). That is a fixed-canvas
 * expression of "as tall as its content, capped near the top of the screen",
 * which is what `BottomSheet`'s content-driven height and `max-h-[88vh]`
 * already do on a real viewport — so the offsets are not reproduced literally.
 */
export function MarketingSheet({ open, onClose, title, subtitle, children, footer }: MarketingSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      hideHeader
      footer={footer}
    >
      <div
        className="-mx-4 mb-3 flex items-start justify-between px-5 pb-3"
        style={{ borderBottom: `1px solid ${M.sheetLine}` }}
      >
        <div>
          <h2 className="font-display text-[18px] font-extrabold text-foreground">{title}</h2>
          {subtitle && (
            <p className="mt-[3px] text-[11.5px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full text-[14px]"
          style={{ background: M.closeBg, color: M.closeText }}
        >
          ✕
        </button>
      </div>
      {children}
    </BottomSheet>
  );
}

/** The design's uppercase label above every field in a sheet. */
export function SheetLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-[7px] block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * The design's two footer shapes: a single full-width clay button, or a
 * secondary outline button beside it.
 */
export function SheetFooter({
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
  primaryDisabled,
}: {
  secondaryLabel?: string;
  onSecondary?: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      {secondaryLabel && (
        <button
          type="button"
          onClick={onSecondary}
          className="flex-none rounded-xl border-[1.5px] bg-card px-4 py-3.5 font-display text-[13px] font-bold"
          style={{ borderColor: M.outline, color: M.outlineText }}
        >
          {secondaryLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="flex-1 rounded-xl bg-primary py-3.5 font-display text-[14px] font-bold text-primary-foreground disabled:opacity-50"
      >
        {primaryLabel}
      </button>
    </div>
  );
}

/** A chip in the design's selectable rows (sharing size, mess type, day). */
export function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex-none rounded-[9px] px-[13px] py-2 font-display text-[12px]"
      style={
        active
          ? { background: M.ink, color: '#FFFFFF', fontWeight: 700, border: '1px solid transparent' }
          : { background: '#FFFFFF', color: M.chipText, fontWeight: 600, border: `1px solid ${M.inputLine}` }
      }
    >
      {label}
    </button>
  );
}

/** The design's text input inside a sheet. */
export function SheetInput({
  value,
  onChange,
  placeholder,
  /** The design highlights the sheet's *primary* field with a clay border. */
  primary,
  inputMode,
  maxLength,
  onEnter,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  primary?: boolean;
  inputMode?: 'text' | 'numeric';
  maxLength?: number;
  /** Enter commits, so a field that feeds a list doesn't need the mouse. */
  onEnter?: () => void;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !onEnter) return;
        event.preventDefault();
        onEnter();
      }}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      className="w-full rounded-[11px] bg-card px-3.5 py-3 text-[14px] font-semibold text-foreground outline-none"
      style={{
        border: primary ? '1.5px solid var(--primary)' : `1px solid ${M.inputLine}`,
      }}
    />
  );
}
