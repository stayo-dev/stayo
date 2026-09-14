import { Plus } from 'lucide-react';
import { StayoDog } from '@shared/ui/brand';

/**
 * A hostel with no floors yet: the building's outline with one obvious thing
 * to do. The Stayo dog is here because an empty state is one of the owner
 * app's allowed dog moments (ADR-191) — never a loader.
 */
export function EmptyBuilding({ onAddFloor }: { onAddFloor: () => void }) {
  return (
    <div className="flex flex-col items-center px-2 pb-2 pt-4 text-center">
      <StayoDog expression="happy" className="w-[92px]" />
      <h2 className="mt-2 font-display text-[16px] font-extrabold text-foreground">Let&apos;s build your hostel</h2>
      <p className="mt-1 max-w-[18rem] text-[12.5px] leading-[1.55] text-muted-foreground">
        Add your floors and rooms once. After that, this page shows every tenant in the room they live in.
      </p>
      <div className="mt-5 w-full">
        <div className="mx-6 h-6 bg-accent [clip-path:polygon(7%_0,93%_0,100%_100%,0_100%)]" />
        <button
          type="button"
          onClick={onAddFloor}
          className="flex h-20 w-full items-center justify-center gap-1.5 border-x-[1.5px] border-dashed border-primary/50 bg-card/60 font-display text-[13px] font-bold text-primary hover:bg-primary/5"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Add your first floor
        </button>
        <div className="h-2.5 bg-accent" />
      </div>
    </div>
  );
}
