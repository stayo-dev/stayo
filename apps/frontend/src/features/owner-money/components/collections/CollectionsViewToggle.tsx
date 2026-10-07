export type CollectionsView = 'due' | 'received';

interface CollectionsViewToggleProps {
  view: CollectionsView;
  onChange: (view: CollectionsView) => void;
  /** Tenants still owing, as the list below counts them. */
  dueCount: number;
  /** Already formatted ("₹1.2L"), or null while it loads. */
  receivedLabel: string | null;
}

/**
 * The two halves of Collections: who still owes, and who has paid. Each side
 * carries its own figure so the owner sees both answers before choosing.
 */
export function CollectionsViewToggle({ view, onChange, dueCount, receivedLabel }: CollectionsViewToggleProps) {
  const options: { id: CollectionsView; label: string; badge: string | null; tone: string }[] = [
    { id: 'due', label: 'To collect', badge: String(dueCount), tone: 'bg-destructive/10 text-destructive' },
    { id: 'received', label: 'Received', badge: receivedLabel, tone: 'bg-success/10 text-success' },
  ];
  return (
    <div role="tablist" aria-label="Collections view" className="grid grid-cols-2 gap-1 rounded-[13px] bg-[#EDE6DE] p-[3px]">
      {options.map((o) => {
        const active = view === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`flex items-center justify-center gap-2 rounded-[10px] px-3 py-2 font-display text-[13px] font-bold transition-colors ${
              active ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(40,30,20,0.08)]' : 'text-[#8A7F75]'
            }`}
          >
            {o.label}
            {o.badge != null && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${active ? o.tone : 'bg-black/5 text-[#8A7F75]'}`}>
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
