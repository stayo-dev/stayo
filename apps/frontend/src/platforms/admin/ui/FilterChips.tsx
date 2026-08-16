export type FilterChip = { key: string; label: string; count?: number };

/** The design's rounded outline chips, used for filtering a queue. */
export function FilterChips({
  chips, active, onChange,
}: {
  chips: FilterChip[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const on = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange(chip.key)}
            className={`rounded-full border px-[15px] py-2 text-[12.5px] font-semibold transition ${
              on ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-[#EAE1D8] bg-white text-[#5A5147]'
            }`}
          >
            {chip.count == null ? chip.label : `${chip.label} · ${chip.count}`}
          </button>
        );
      })}
    </div>
  );
}
