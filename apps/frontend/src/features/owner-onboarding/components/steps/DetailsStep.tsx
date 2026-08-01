import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, tile, tileTitle, tileSub, stepBtn } from '../stepStyles';

interface DetailsStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
}

export function DetailsStep({ data, setD }: DetailsStepProps) {
  return (
    <div>
      <div className={eyebrow}>SHAPE THE STRUCTURE</div>
      <h1 className={h1}>A few property details.</h1>
      <p className={sub}>Capacity, meals and money. You&apos;ll lay out floors and rooms next.</p>
      <div className="flex max-w-[460px] flex-col gap-3.5">
        <div className={tile}>
          <div>
            <div className={tileTitle}>Approx. capacity</div>
            <div className={tileSub}>Total beds</div>
          </div>
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={() => setD({ capacity: Math.max(0, data.capacity - 4) })} className={stepBtn}>
              −
            </button>
            <span className="min-w-[64px] text-center font-display text-xl font-extrabold">{data.capacity}</span>
            <button type="button" onClick={() => setD({ capacity: data.capacity + 4 })} className={stepBtn}>
              +
            </button>
          </div>
        </div>
        <div className={tile}>
          <div className={tileTitle}>Food available?</div>
          <div className="flex gap-2">
            {(['Yes', 'No'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setD({ food: v })}
                className={`rounded-xl border-[1.5px] px-4 py-2.5 font-display text-sm font-bold transition-all ${
                  data.food === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground/80'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className={tile}>
          <div className={tileTitle}>Security deposit</div>
          <div className="flex items-center gap-1 font-display text-lg font-bold text-foreground">
            ₹
            <input
              value={data.deposit}
              onChange={(e) => setD({ deposit: e.target.value.replace(/[^0-9]/g, '') })}
              inputMode="numeric"
              className="w-24 border-0 border-b-2 border-border bg-transparent px-0.5 py-1 text-right font-display text-lg font-bold text-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        <div className={tile}>
          <div>
            <div className={tileTitle}>Starting monthly rent</div>
            <div className={tileSub}>Applied to every room — change any room later</div>
          </div>
          <div className="flex items-center gap-1 font-display text-lg font-bold text-foreground">
            ₹
            <input
              value={data.monthlyRent}
              onChange={(e) => setD({ monthlyRent: e.target.value.replace(/[^0-9]/g, '') })}
              inputMode="numeric"
              placeholder="6500"
              className="w-24 border-0 border-b-2 border-border bg-transparent px-0.5 py-1 text-right font-display text-lg font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
