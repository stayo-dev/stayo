import { useState } from 'react';
import { Info } from 'lucide-react';

export interface MoneyStatTile {
  key: string;
  label: string;
  value: string;
  valueClassName?: string;
  info?: string;
}

interface MoneyStatTilesProps {
  tiles: MoneyStatTile[];
}

/** Reusable 3-tile stat row with an optional per-tile info toggle — used by both Pulse and Expenses, per Stayo App.dc.html. */
export function MoneyStatTiles({ tiles }: MoneyStatTilesProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div key={t.key} className="rounded-2xl border border-border bg-card px-2.5 py-3 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-center gap-1">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[#9C9186]">{t.label}</span>
            {t.info && (
              <button
                type="button"
                onClick={() => setOpenKey((k) => (k === t.key ? null : t.key))}
                aria-label="More info"
                className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full bg-[#EDE2D6] text-[#8A7F75]"
              >
                <Info className="h-2.5 w-2.5" strokeWidth={2.4} />
              </button>
            )}
          </div>
          <div className={`font-display text-lg font-extrabold tabular-nums ${t.valueClassName ?? 'text-foreground'}`}>{t.value}</div>
          {openKey === t.key && t.info && <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t.info}</div>}
        </div>
      ))}
    </div>
  );
}
