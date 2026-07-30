import { Check } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, textInput, okNote } from '../stepStyles';

interface AccountStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
  password: string;
  setPassword: (value: string) => void;
}

export function AccountStep({ data, setD, password, setPassword }: AccountStepProps) {
  const nameOk = data.name.trim().length > 1;
  return (
    <div>
      <div className={eyebrow}>MEET THE OWNER</div>
      <h1 className={h1}>Let&apos;s start with you.</h1>
      <p className={sub}>Three quick details. This is you stepping onto the land.</p>
      <div className="flex max-w-[430px] flex-col gap-5">
        <label className="block">
          <span className={fieldLabel}>WHAT SHOULD WE CALL YOU?</span>
          <input
            value={data.name}
            onChange={(e) => setD({ name: e.target.value })}
            placeholder="Your name"
            className={textInput}
          />
          {nameOk && (
            <span className={okNote}>
              <Check className="h-3 w-3" strokeWidth={2.8} />
              Nice to meet you, {data.name}.
            </span>
          )}
        </label>
        <label className="block">
          <span className={fieldLabel}>MOBILE NUMBER</span>
          <input
            value={data.mobile}
            onChange={(e) => setD({ mobile: e.target.value })}
            placeholder="+91 90000 00000"
            inputMode="tel"
            className={textInput}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>EMAIL</span>
          <input
            value={data.email}
            onChange={(e) => setD({ email: e.target.value })}
            placeholder="you@hostel.com"
            inputMode="email"
            className={textInput}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>CREATE A PASSWORD</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            type="password"
            className={textInput}
          />
        </label>
      </div>
    </div>
  );
}
