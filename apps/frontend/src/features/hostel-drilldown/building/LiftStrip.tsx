import type { Ref } from 'react';

export interface LiftStop {
  id: string;
  name: string;
  plate: string;
  free: number;
  overdue: number;
}

/**
 * The lift panel: one button per floor, ground first like the buttons in a
 * lift. Each shows the floor's free beds and a red dot when someone there is
 * overdue — the whole building's summary while its middle is on screen. It
 * sticks under the tabs (under the sticky tab row on desktop).
 */
export function LiftStrip({ stops, activeId, onJump, stripRef }: { stops: LiftStop[]; activeId: string | null; onJump: (id: string) => void; stripRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={stripRef} className="sticky top-0 z-[5] -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur-sm lg:top-[41px]">
      <nav aria-label="Floors" className="flex gap-1 overflow-x-auto rounded-[13px] bg-accent p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {stops.map((stop) => {
          const on = stop.id === activeId;
          return (
            <button
              key={stop.id}
              type="button"
              onClick={() => onJump(stop.id)}
              aria-current={on ? 'true' : undefined}
              aria-label={`${stop.name}: ${stop.free} free bed${stop.free === 1 ? '' : 's'}${stop.overdue ? `, ${stop.overdue} overdue` : ''}`}
              className={`relative flex min-w-[44px] flex-1 flex-col items-center gap-0.5 rounded-[10px] border px-1 pb-1 pt-1.5 transition-colors ${
                on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground'
              }`}
            >
              <span className="font-display text-[12px] font-extrabold leading-none">{stop.plate}</span>
              <span className={`text-[8.5px] leading-none ${on ? 'text-background/75' : 'text-muted-foreground'}`}>{stop.free} free</span>
              {stop.overdue > 0 && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
