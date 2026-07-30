import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, statCard, statK } from '../stepStyles';

interface ReviewStepProps {
  data: OwnerOnboardingData;
  hostelDisplay: string;
  totalRooms: number;
  totalBeds: number;
}

export function ReviewStep({ data, hostelDisplay, totalRooms, totalBeds }: ReviewStepProps) {
  return (
    <div>
      <div className={eyebrow}>STEP BACK &amp; LOOK</div>
      <h1 className={h1}>Your hostel is ready.</h1>
      <p className={sub}>Everything you built, on one card. Take a proud look.</p>
      <div className="grid max-w-[440px] grid-cols-2 gap-3">
        <div className={statCard}>
          <div className={statK}>Hostel</div>
          <div className="font-display text-[19px] font-extrabold text-foreground">{hostelDisplay}</div>
        </div>
        <div className={statCard}>
          <div className={statK}>Type</div>
          <div className="font-display text-[19px] font-extrabold text-foreground">{data.type}</div>
        </div>
        <div className={statCard}>
          <div className={statK}>Floors</div>
          <div className="font-display text-2xl font-extrabold text-primary">{data.floors}</div>
        </div>
        <div className={statCard}>
          <div className={statK}>Rooms</div>
          <div className="font-display text-2xl font-extrabold text-primary">{totalRooms}</div>
        </div>
        <div className="rounded-2xl bg-foreground p-4.5">
          <div className="text-xs font-medium text-background/60">Beds</div>
          <div className="font-display text-2xl font-extrabold text-background">{totalBeds}</div>
        </div>
        <div className="rounded-2xl bg-foreground p-4.5">
          <div className="text-xs font-medium text-background/60">Capacity</div>
          <div className="font-display text-2xl font-extrabold text-background">{totalBeds}</div>
        </div>
      </div>
    </div>
  );
}
