import { Search } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel } from '../stepStyles';

interface LocationStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
}

export function LocationStep({ data, setD }: LocationStepProps) {
  return (
    <div>
      <div className={eyebrow}>PIN THE PLACE</div>
      <h1 className={h1}>Where does it stand?</h1>
      <p className={sub}>Where should students look for you? Street, area and city.</p>
      <label className="mb-4 block max-w-[440px]">
        <span className={fieldLabel}>STREET ADDRESS</span>
        <div className="mt-1.5 flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3.5">
          <Search className="h-4.5 w-4.5 flex-none text-primary" strokeWidth={2.2} />
          <input
            value={data.address}
            onChange={(e) => setD({ address: e.target.value })}
            placeholder="House / street / area or landmark"
            autoComplete="street-address"
            className="flex-1 border-0 bg-transparent text-[15px] font-semibold text-foreground focus:outline-none"
          />
        </div>
      </label>
      <label className="mb-4 block max-w-[440px]">
        <span className={fieldLabel}>CITY</span>
        <div className="mt-1.5 rounded-2xl border border-border bg-card px-4 py-3.5">
          <input
            value={data.city}
            onChange={(e) => setD({ city: e.target.value })}
            placeholder="e.g. Bengaluru"
            autoComplete="address-level2"
            className="w-full border-0 bg-transparent text-[15px] font-semibold text-foreground focus:outline-none"
          />
        </div>
      </label>
      {/* Reflects what the owner actually typed. This card used to assert
          "Location verified · Hyderabad, Telangana · Near JNTU" for everyone
          regardless of input, with invented college distances. */}
      {(data.address.trim() || data.city.trim()) && (
        <div className="max-w-[440px] rounded-2xl border border-border bg-card p-4">
          <div className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-primary">
            Your address so far
          </div>
          <div className="font-display text-[17px] font-bold text-foreground">
            {data.address.trim() || 'Add a street address'}
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-muted-foreground">
            {data.city.trim() || 'Add a city'}
          </div>
          <div className="mt-3 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            We verify the address and map nearby colleges after you publish — you can edit it any time before then.
          </div>
        </div>
      )}
    </div>
  );
}
