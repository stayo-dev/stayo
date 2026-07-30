import type { MockFoodPoll } from '@shared/mocks/food';
import type { PollTab } from '../../types';

const TABS: { key: PollTab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'closed', label: 'Closed' },
];

interface PollSegmentedControlProps {
  polls: MockFoodPoll[];
  pollTab: PollTab;
  onChange: (tab: PollTab) => void;
}

/** Active/Scheduled/Closed pill row with live counts derived from `polls`. */
export function PollSegmentedControl({ polls, pollTab, onChange }: PollSegmentedControlProps) {
  return (
    <div className="flex gap-1.5 rounded-xl bg-muted p-1">
      {TABS.map((t) => {
        const count = polls.filter((p) => p.status === t.key).length;
        const active = pollTab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex-1 rounded-lg py-2.5 text-center font-display text-[11.5px] font-bold tabular-nums transition-colors ${
              active ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            {t.label} {count}
          </button>
        );
      })}
    </div>
  );
}
