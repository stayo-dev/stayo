export type SegmentedTab = { key: string; label: string };

/** The design's pill-in-tray control, used for view switches within a screen. */
export function SegmentedTabs({
  tabs, active, onChange,
}: {
  tabs: SegmentedTab[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    // <sm: full-width, equal-width segments so three labels never wrap or spill
    // past the card edge at phone width. ≥sm: the design's fit-content pill tray.
    <div className="grid w-full grid-cols-3 gap-[5px] rounded-xl bg-[#EAE1D6] p-1 sm:flex sm:w-fit">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`whitespace-nowrap rounded-[9px] px-2 py-2 text-[11px] font-semibold transition sm:px-[18px] sm:text-[12.5px] ${
              on ? 'bg-white text-[#221E1A] shadow-[0_1px_3px_rgba(40,30,20,.12)]' : 'text-[#7A6F63]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
