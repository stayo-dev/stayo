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
    <div className="flex w-fit gap-[5px] rounded-xl bg-[#EAE1D6] p-1">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-[9px] px-[18px] py-2 text-[12.5px] font-semibold transition ${
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
