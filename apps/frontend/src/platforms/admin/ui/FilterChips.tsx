import { ChevronDown } from 'lucide-react';

export type FilterChip = { key: string; label: string; count?: number };

function chipText(chip: FilterChip): string {
  return chip.count == null ? chip.label : `${chip.label} · ${chip.count}`;
}

/** The design's rounded outline chips, used for filtering a queue. Collapses to a dropdown on phone widths. */
export function FilterChips({
  chips, active, onChange,
}: {
  chips: FilterChip[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <>
      <div className="relative w-full sm:hidden">
        <select
          value={active}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-border bg-white px-3.5 py-2.5 text-[12.5px] font-semibold text-[#2A2521] outline-none"
        >
          {chips.map((chip) => (
            <option key={chip.key} value={chip.key}>
              {chipText(chip)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#988D82]" />
      </div>
      <div className="hidden flex-wrap gap-2 sm:flex">
        {chips.map((chip) => {
          const on = chip.key === active;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.key)}
              className={`rounded-full border px-[15px] py-2 text-[12.5px] font-semibold transition ${
                on ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-border bg-white text-[#5A5147]'
              }`}
            >
              {chipText(chip)}
            </button>
          );
        })}
      </div>
    </>
  );
}
