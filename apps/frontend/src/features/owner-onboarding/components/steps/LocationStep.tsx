import { Search, Check } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub } from '../stepStyles';

interface LocationStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
}

export function LocationStep({ data, setD }: LocationStepProps) {
  return (
    <div>
      <div className={eyebrow}>PIN THE PLACE</div>
      <h1 className={h1}>Where does it stand?</h1>
      <p className={sub}>Drop the pin. We draw the road and find nearby colleges.</p>
      <div className="mb-4 flex max-w-[440px] items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3.5">
        <Search className="h-4.5 w-4.5 text-primary" strokeWidth={2.2} />
        <input
          value={data.address}
          onChange={(e) => setD({ address: e.target.value })}
          placeholder="Search address, area or landmark"
          className="flex-1 border-0 bg-transparent text-[15px] font-semibold text-foreground focus:outline-none"
        />
      </div>
      <div className="mb-4 max-w-[440px] rounded-2xl border border-border bg-card px-4 py-3.5">
        <input
          value={data.city}
          onChange={(e) => setD({ city: e.target.value })}
          placeholder="City"
          className="w-full border-0 bg-transparent text-[15px] font-semibold text-foreground focus:outline-none"
        />
      </div>
      <div className="max-w-[440px] rounded-2xl border border-border bg-card p-4">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} />
          <span className="font-display text-[13px] font-bold text-success">Location verified</span>
        </div>
        <div className="font-display text-[17px] font-bold text-foreground">Hyderabad, Telangana</div>
        <div className="mt-0.5 text-[13.5px] font-medium text-muted-foreground">Near JNTU · Kukatpally</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-secondary px-2.5 py-1.5 text-xs font-semibold text-primary">JNTU Hyderabad · 0.8 km</span>
          <span className="rounded-full bg-secondary px-2.5 py-1.5 text-xs font-semibold text-primary">VNR VJIET · 2.1 km</span>
        </div>
      </div>
    </div>
  );
}
