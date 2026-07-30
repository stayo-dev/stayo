import { Sparkles, Pencil } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, stepBtn, genBtn } from '../stepStyles';

interface FloorsStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
  generated: boolean;
  onGenerate: () => void;
}

const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor', 'Fifth Floor', 'Sixth Floor', 'Seventh Floor'];

export function FloorsStep({ data, setD, generated, onGenerate }: FloorsStepProps) {
  const floorList = Array.from({ length: data.floors }, (_, i) => FLOOR_NAMES[i] ?? `${i + 1}th Floor`);
  return (
    <div>
      <div className={eyebrow}>RAISE THE FLOORS</div>
      <h1 className={h1}>Let&apos;s build your floors.</h1>
      <p className={sub}>We generate them all at once — no adding one by one.</p>
      <div className="mb-4.5 flex max-w-[440px] items-end gap-3.5">
        <div className="flex-1">
          <span className={fieldLabel}>NUMBER OF FLOORS</span>
          <div className="mt-2 flex items-center gap-3.5">
            <button type="button" onClick={() => setD({ floors: Math.max(1, data.floors - 1) })} className={stepBtn}>
              −
            </button>
            <span className="min-w-[40px] text-center font-display text-2xl font-extrabold">{data.floors}</span>
            <button type="button" onClick={() => setD({ floors: Math.min(8, data.floors + 1) })} className={stepBtn}>
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
        <div className="flex max-w-[440px] flex-col gap-2">
          {floorList.map((name, i) => (
            <div
              key={name}
              style={{ animation: 'stayoRiseIn .4s ease both', animationDelay: `${i * 70}ms` }}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <span className="font-display text-[14.5px] font-bold text-foreground">{name}</span>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary">
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                Edit
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
