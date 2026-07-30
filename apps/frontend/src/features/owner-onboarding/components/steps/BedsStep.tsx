import { Sparkles, BedDouble } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, stepBtn, genBtn } from '../stepStyles';

interface BedsStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
  generated: boolean;
  onGenerate: () => void;
}

export function BedsStep({ data, setD, generated, onGenerate }: BedsStepProps) {
  const bedList = Array.from({ length: data.bedsPerRoom }, (_, i) => String.fromCharCode(65 + i));
  return (
    <div>
      <div className={eyebrow}>LIGHT THE BEDS</div>
      <h1 className={h1}>Finally — the beds.</h1>
      <p className={sub}>Beds per room. The last piece before the lights turn on.</p>
      <div className="mb-4.5 flex max-w-[440px] items-end gap-3.5">
        <div className="flex-1">
          <span className={fieldLabel}>BEDS PER ROOM</span>
          <div className="mt-2 flex items-center gap-3.5">
            <button type="button" onClick={() => setD({ bedsPerRoom: Math.max(1, data.bedsPerRoom - 1) })} className={stepBtn}>
              −
            </button>
            <span className="min-w-[40px] text-center font-display text-2xl font-extrabold">{data.bedsPerRoom}</span>
            <button type="button" onClick={() => setD({ bedsPerRoom: Math.min(8, data.bedsPerRoom + 1) })} className={stepBtn}>
              +
            </button>
          </div>
        </div>
        <button type="button" onClick={onGenerate} className={genBtn}>
          <Sparkles className="h-3.5 w-3.5 text-background" />
          Generate
        </button>
      </div>
      {generated && (
        <div className="max-w-[440px]">
          <div className="mb-2 text-[12.5px] font-semibold text-muted-foreground">Room GF-101</div>
          <div className="flex flex-wrap gap-2">
            {bedList.map((name, i) => (
              <span
                key={name}
                style={{ animation: 'stayoPopIn .3s ease both', animationDelay: `${i * 60}ms` }}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-2.5 font-display text-[13px] font-bold text-foreground"
              >
                <BedDouble className="h-4 w-3.5 text-primary" strokeWidth={1.9} />
                Bed {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
