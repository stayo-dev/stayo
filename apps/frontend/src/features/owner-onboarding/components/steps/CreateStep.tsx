import { Check, User, UserRound, Users, Briefcase } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, okNote } from '../stepStyles';

interface CreateStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
}

const TYPES: { value: OwnerOnboardingData['type']; label: string; icon: typeof User }[] = [
  { value: 'Boys', label: 'Boys', icon: User },
  { value: 'Girls', label: 'Girls', icon: UserRound },
  { value: 'Co-Living', label: 'Co-Living', icon: Users },
  { value: 'Working Pros', label: 'Working Pros', icon: Briefcase },
];

export function CreateStep({ data, setD }: CreateStepProps) {
  const hostelNameOk = data.hostelName.trim().length > 2;
  return (
    <div>
      <div className={eyebrow}>STAKE YOUR GROUND</div>
      <h1 className={h1}>Name your hostel.</h1>
      <p className={sub}>Give it an identity. Its sign appears on the land as you type.</p>
      <div className="flex max-w-[440px] flex-col gap-6">
        <label className="block">
          <span className={fieldLabel}>HOSTEL NAME</span>
          <input
            value={data.hostelName}
            onChange={(e) => setD({ hostelName: e.target.value })}
            placeholder="e.g. Green Nest Hostel"
            className="mt-2 w-full border-0 border-b-2 border-border bg-transparent px-0.5 py-2.5 font-display text-2xl font-bold text-foreground transition-colors focus:border-primary focus:outline-none"
          />
          {hostelNameOk && (
            <span className={okNote}>
              <Check className="h-3 w-3" strokeWidth={2.8} />
              Looks good.
            </span>
          )}
        </label>
        <div>
          <span className={fieldLabel}>HOSTEL TYPE</span>
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {TYPES.map(({ value, label, icon: Icon }) => {
              const active = data.type === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setD({ type: value })}
                  className={`inline-flex items-center gap-1.5 rounded-xl border-[1.5px] px-3.5 py-2.5 font-display text-sm font-bold transition-all ${
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground/80'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
