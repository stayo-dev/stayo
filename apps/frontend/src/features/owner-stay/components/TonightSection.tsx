import { StatCard } from '@shared/ui-patterns/StatCard';
import type { TonightCards } from '@features/stay/stayState';

/**
 * Owner Home's answer to "how is my hostel tonight?" — three numbers, each a
 * question answered, all opening the Stay board. Rendered only once someone
 * lives here (`tonightCards` returns null before that). See ADR-194.
 */
export function TonightSection({ cards, onOpen }: { cards: TonightCards; onOpen: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tonight</h2>
        <button type="button" onClick={onOpen} className="text-[12.5px] font-semibold text-primary">
          Open
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          variant="action"
          label="Here tonight"
          value={cards.hereTonight.value}
          caption={cards.hereTonight.caption}
          onClick={onOpen}
          ariaLabel="Who is here tonight"
        />
        <StatCard
          variant="action"
          label="Back today"
          value={cards.backToday.value}
          caption={
            cards.backToday.tone === 'danger' ? (
              <span className="font-semibold text-destructive">{cards.backToday.caption}</span>
            ) : (
              cards.backToday.caption
            )
          }
          onClick={onOpen}
          ariaLabel="Who is back today"
        />
        <StatCard
          variant="action"
          label="Rooms to check"
          value={cards.roomsToCheck.value}
          caption={cards.roomsToCheck.caption}
          onClick={onOpen}
          ariaLabel="Rooms that need attention"
        />
      </div>
    </section>
  );
}
