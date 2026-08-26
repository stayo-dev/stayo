import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { C, FONT } from '@/app/pages/discover/discoverTheme';

/**
 * Stayo's list vocabulary — the one row, group and heading every
 * Discover-palette screen is built from.
 *
 * It exists because two screens built a week apart drifted: the Help Centre
 * used 36px icons in `px-4 py-3.5` rows, the profile hub used 30px icons in
 * `px-3.5 py-3`, and their sticky headers had different top padding. Nothing
 * was wrong in either — they were just written twice, which is all it takes.
 * Aligning them by hand would only postpone the next drift, so the shape lives
 * here and the screens render it.
 *
 * These live under `features/` rather than `shared/ui` because they carry the
 * Discover palette, and `shared/` is forbidden from importing `app/` by
 * `check-architecture.mjs` — keeping the terracotta in one module is the same
 * reason `discoverTheme` exists at all.
 */

/** The one measurement everything else hangs off. */
export const SCREEN_HEADER_CLASS =
  'sticky top-0 z-30 flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(2.5rem,env(safe-area-inset-top))]';

export const SCREEN_HEADER_STYLE = { background: C.cardWarm, borderColor: C.line } as const;

/**
 * A section heading, optionally carrying one figure on the right.
 *
 * A heading is a grouping device: over a single row it is only height, so
 * prefer folding a lone row into a neighbouring group over giving it a
 * heading of its own.
 */
export function SectionHead({
  title,
  meta,
  tone = 'calm',
}: {
  title: string;
  meta?: string | null;
  tone?: 'warn' | 'calm';
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between px-0.5">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
        {title}
      </h2>
      {meta && (
        <span className="text-[11px] font-bold" style={{ color: tone === 'warn' ? '#A4482F' : C.textGhost }}>
          {meta}
        </span>
      )}
    </div>
  );
}

/** One rounded container per group, hairlines between rows — never a card each. */
export function ListGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border bg-white"
      style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
    >
      {children}
    </div>
  );
}

/**
 * The row.
 *
 * `meta` is the right-hand side and is the row's only variable: a count, a gap
 * ("Add college"), or a badge wanting attention. **`null` means nothing to
 * say**, and that silence is load-bearing — it is what makes a hint mean
 * something when it appears (ADR-118).
 *
 * `sub` is for the rows whose title genuinely under-describes them, and is
 * otherwise left off; a subtitle on every row is how a list stops being
 * scannable.
 */
export function ListRowItem({
  icon: Icon,
  title,
  sub,
  meta,
  metaTone = 'quiet',
  first,
  onClick,
}: {
  icon: typeof ChevronRight;
  title: string;
  sub?: string;
  meta?: string | null;
  metaTone?: 'warn' | 'quiet';
  first?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      style={{ borderTop: first ? 'none' : `1px solid ${C.lineSoft}` }}
    >
      <span
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px]"
        style={{ background: '#F4EEE7' }}
      >
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} style={{ color: C.textMuted }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>
          {title}
        </span>
        {sub && (
          <span className="mt-0.5 block truncate text-[11px]" style={{ color: C.textFaint }}>
            {sub}
          </span>
        )}
      </span>
      {meta && (
        <span
          className="flex-none text-[11.5px] font-bold"
          style={
            metaTone === 'warn'
              ? { background: C.clayPaleBg, color: '#A4482F', borderRadius: 999, padding: '3px 9px' }
              : { color: C.textGhost }
          }
        >
          {meta}
        </span>
      )}
      <ChevronRight className="h-4 w-4 flex-none" style={{ color: '#C9BFB4' }} />
    </button>
  );
}

/** The page title in a screen header. One size, one weight, everywhere. */
export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <h1
      className="text-[20px] font-extrabold tracking-[-0.02em]"
      style={{ fontFamily: FONT.display, color: C.text }}
    >
      {children}
    </h1>
  );
}
