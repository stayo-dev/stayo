import { IdCard, FileText, Image as ImageIcon } from 'lucide-react';
import type { OwnerOnboardingKyc } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub } from '../stepStyles';

interface KycStepProps {
  kyc: OwnerOnboardingKyc;
  setKyc: (updater: (prev: OwnerOnboardingKyc) => OwnerOnboardingKyc) => void;
}

const ITEMS: { key: keyof OwnerOnboardingKyc; title: string; meta: string; icon: typeof IdCard }[] = [
  { key: 'aadhaar', title: 'Aadhaar', meta: 'Required before you go live', icon: IdCard },
  { key: 'pan', title: 'PAN', meta: 'Optional', icon: FileText },
  { key: 'photo', title: 'Profile photo', meta: 'Helps tenants trust you', icon: ImageIcon },
];

export function KycStep({ kyc, setKyc }: KycStepProps) {
  return (
    <div>
      <div className={eyebrow}>EARN YOUR BADGE</div>
      <h1 className={h1}>Let&apos;s verify it&apos;s really you.</h1>
      <p className={sub}>
        Mark what you have ready. Our team collects and verifies these after you publish — nothing is
        uploaded or checked on this screen yet.
      </p>
      <div className="flex max-w-[440px] flex-col gap-3.5">
        {ITEMS.map(({ key, title, meta, icon: Icon }) => {
          const done = kyc[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setKyc((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={`flex items-center gap-3.5 rounded-2xl border-[1.5px] bg-card/95 px-4.5 py-4 text-left transition-colors ${
                done ? 'border-success/45' : 'border-border'
              }`}
            >
              <span className={`flex h-11.5 w-11.5 flex-none items-center justify-center rounded-xl ${done ? 'bg-success/10' : 'bg-secondary'}`}>
                <Icon className="h-5.5 w-5.5 text-primary" strokeWidth={1.9} />
              </span>
              <span className="flex-1 text-left">
                <span className="block font-display text-[15px] font-bold text-foreground">{title}</span>
                <span className="text-[12.5px] font-medium text-muted-foreground">{meta}</span>
              </span>
              <span
                className={`flex-none rounded-full px-2.5 py-1 font-display text-[11px] font-bold ${
                  done ? 'bg-success/10 text-success' : 'bg-secondary text-primary'
                }`}
              >
                {done ? 'Uploaded' : 'Upload'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
