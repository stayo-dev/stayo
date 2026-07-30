import { Sparkles } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, stepBtn, genBtn } from '../stepStyles';

interface RoomsStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
  generated: boolean;
  onGenerate: () => void;
}

export function RoomsStep({ data, setD, generated, onGenerate }: RoomsStepProps) {
  const roomList = Array.from({ length: data.roomsPerFloor }, (_, i) => `GF-1${String(i + 1).padStart(2, '0')}`);
  return (
    <div>
      <div className={eyebrow}>OPEN THE ROOMS</div>
      <h1 className={h1}>Now, the rooms.</h1>
      <p className={sub}>Set rooms per floor — windows appear across the building.</p>
      <div className="mb-4.5 flex max-w-[440px] items-end gap-3.5">
        <div className="flex-1">
          <span className={fieldLabel}>ROOMS PER FLOOR</span>
          <div className="mt-2 flex items-center gap-3.5">
            <button type="button" onClick={() => setD({ roomsPerFloor: Math.max(1, data.roomsPerFloor - 1) })} className={stepBtn}>
              −
            </button>
            <span className="min-w-[40px] text-center font-display text-2xl font-extrabold">{data.roomsPerFloor}</span>
            <button type="button" onClick={() => setD({ roomsPerFloor: Math.min(20, data.roomsPerFloor + 1) })} className={stepBtn}>
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
          <div className="mb-2 text-[12.5px] font-semibold text-muted-foreground">
            Ground Floor · {data.roomsPerFloor} rooms
          </div>
          <div className="grid grid-cols-5 gap-2">
            {roomList.map((name, i) => (
              <span
                key={name}
                style={{ animation: 'stayoPopIn .3s ease both', animationDelay: `${i * 45}ms` }}
                className="rounded-[10px] border border-border bg-card px-1 py-2.5 text-center font-display text-[12.5px] font-bold text-foreground"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
