import type { MentionChip } from '../reviewMentionFilter';
import { C, FONT } from '../discoverTheme';

/**
 * Interactive "what tenants mention" chips — dedicated Reviews page only.
 * Single-select with toggle-off: click a chip to filter, click the same one
 * again to clear, click a different one to switch. Simplest predictable
 * model, and keeps a chip from ever landing on zero results the way an
 * intersection of several mentions easily could.
 */
export function ReviewMentionFilters({
  chips,
  active,
  onChange,
}: {
  chips: MentionChip[];
  active: string | null;
  onChange: (key: string | null) => void;
}) {
  if (chips.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => {
        const on = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : chip.key)}
            className="flex-none rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition"
            style={{
              fontFamily: FONT.display,
              borderColor: on ? C.clayDeep : C.line,
              background: on ? C.clayDeep : '#fff',
              color: on ? '#fff' : C.textBody,
            }}
          >
            {chip.label} · {chip.count}
          </button>
        );
      })}
    </div>
  );
}
