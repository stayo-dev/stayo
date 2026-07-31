import { useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel, textInput, okNote } from '../stepStyles';

interface AccountStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
  password: string;
  setPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
}

const MIN_PASSWORD = 8;

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
  const passwordOk = password.length >= MIN_PASSWORD;
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
              placeholder={`At least ${MIN_PASSWORD} characters`}
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
          {/* Live strength hint — nudges without blocking. */}
          {password.length > 0 && (
            <span
              className={`mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold ${
                passwordOk ? 'text-success' : 'text-muted-foreground'
              }`}
            >
              {passwordOk && <Check className="h-3 w-3" strokeWidth={2.8} />}
              {passwordOk
                ? 'Strong enough.'
                : `${MIN_PASSWORD - password.length} more character${MIN_PASSWORD - password.length === 1 ? '' : 's'} to go.`}
            </span>
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
