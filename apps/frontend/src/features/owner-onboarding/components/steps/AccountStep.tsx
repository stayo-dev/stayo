import { useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, textInput, okNote } from '../stepStyles';
import {
  PASSWORD_CRITERIA,
  PASSWORD_STRENGTH_LABEL,
  evaluatePassword,
} from '../../passwordPolicy';

interface AccountStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
  password: string;
  setPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
}

/** Loose check — the real validation is the server's; this only catches typos early. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountStep({
  data,
  setD,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
}: AccountStepProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const nameOk = data.name.trim().length > 1;
  const emailOk = EMAIL_RE.test(data.email.trim());
  const mobileDigits = data.mobile.replace(/\D/g, '');
  const mobileOk = mobileDigits.length >= 10;
  const passwordEval = evaluatePassword(password);
  const passwordOk = passwordEval.allMet;
  const matchOk = confirmPassword.length > 0 && confirmPassword === password;

  const markTouched = (key: string) => setTouched((t) => ({ ...t, [key]: true }));

  /** Errors only appear once a field has been left — not while still typing. */
  const errorFor = (key: string, ok: boolean, message: string) =>
    touched[key] && !ok ? (
      <span className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-destructive">
        <AlertCircle className="h-3 w-3" strokeWidth={2.6} />
        {message}
      </span>
    ) : null;

  return (
    <div>
      <div className={eyebrow}>MEET THE OWNER</div>
      <h1 className={h1}>Let&apos;s start with you.</h1>
      <p className={sub}>Four quick details. This is you stepping onto the land.</p>

      <div className="flex max-w-[430px] flex-col gap-5">
        <label className="block">
          <span className={fieldLabel}>WHAT SHOULD WE CALL YOU?</span>
          <input
            value={data.name}
            onChange={(e) => setD({ name: e.target.value })}
            onBlur={() => markTouched('name')}
            placeholder="Your name"
            autoComplete="name"
            className={textInput}
          />
          {nameOk && (
            <span className={okNote}>
              <Check className="h-3 w-3" strokeWidth={2.8} />
              Nice to meet you, {data.name.trim()}.
            </span>
          )}
          {errorFor('name', nameOk, 'Please tell us your name.')}
        </label>

        <label className="block">
          <span className={fieldLabel}>MOBILE NUMBER</span>
          <input
            value={data.mobile}
            onChange={(e) => setD({ mobile: e.target.value })}
            onBlur={() => markTouched('mobile')}
            placeholder="+91 90000 00000"
            inputMode="tel"
            autoComplete="tel"
            className={textInput}
          />
          {errorFor('mobile', mobileOk, 'Enter a 10-digit mobile number.')}
        </label>

        <label className="block">
          <span className={fieldLabel}>EMAIL</span>
          <input
            value={data.email}
            onChange={(e) => setD({ email: e.target.value })}
            onBlur={() => markTouched('email')}
            placeholder="you@hostel.com"
            inputMode="email"
            autoComplete="email"
            className={textInput}
          />
          {errorFor('email', emailOk, "That doesn't look like an email address.")}
        </label>

        <label className="block">
          <span className={fieldLabel}>CREATE A PASSWORD</span>
          <div className="relative">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => markTouched('password')}
              placeholder="Pick something only you would know"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className={`${textInput} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {/* Every rule is stated up front and ticks live. The previous version
              checked only length and showed one hint, so the rest of the
              requirements were discovered by being refused. */}
          {password.length > 0 && (
            <div className="mt-2.5">
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i < passwordEval.met.length
                          ? passwordOk
                            ? 'bg-success'
                            : 'bg-primary'
                          : 'bg-border'
                      }`}
                    />
                  ))}
                </div>
                <span
                  className={`text-[11.5px] font-bold ${passwordOk ? 'text-success' : 'text-muted-foreground'}`}
                >
                  {PASSWORD_STRENGTH_LABEL[passwordEval.strength]}
                </span>
              </div>
              <ul className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                {PASSWORD_CRITERIA.map((criterion) => {
                  const met = passwordEval.met.includes(criterion.id);
                  return (
                    <li
                      key={criterion.id}
                      className={`flex items-center gap-1.5 text-[12px] font-semibold ${
                        met ? 'text-success' : 'text-muted-foreground'
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full ${
                          met ? 'bg-success/15' : 'bg-border/60'
                        }`}
                      >
                        {met ? (
                          <Check className="h-2.5 w-2.5" strokeWidth={3.4} />
                        ) : (
                          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                        )}
                      </span>
                      {criterion.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </label>

        <label className="block">
          <span className={fieldLabel}>CONFIRM PASSWORD</span>
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => markTouched('confirm')}
            placeholder="Type it once more"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className={textInput}
          />
          {matchOk && (
            <span className={okNote}>
              <Check className="h-3 w-3" strokeWidth={2.8} />
              Passwords match.
            </span>
          )}
          {confirmPassword.length > 0 && !matchOk && (
            <span className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-destructive">
              <AlertCircle className="h-3 w-3" strokeWidth={2.6} />
              These don&apos;t match yet.
            </span>
          )}
        </label>
      </div>
    </div>
  );
}
