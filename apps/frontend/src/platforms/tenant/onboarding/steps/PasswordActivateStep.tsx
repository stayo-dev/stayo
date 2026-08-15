import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationStep } from '../activationTypes';
import { passwordStrength } from './passwordPolicy';
import { BackButton, PrimaryActionButton, StepActionBar } from './shared';

/**
 * Step 4 — "Set Your Password", matching `Stayo Onboarding.dc.html`'s Step 4
 * exactly: the lock header and a single white card (new password + strength
 * meter + confirm + match line). Nothing else.
 *
 * 2026-08-15: the onboarding verification checklist and the signed-agreement
 * preview/download card were **removed**. Both were pre-redesign carryovers
 * kept through earlier passes under a "keep extra backend-useful surfaces,
 * restyle them" policy; the user overrode that here in favour of exact design
 * fidelity — the design's Step 4 shows neither, and its `checklist` state
 * array is defined but never rendered anywhere in the source.
 *
 * Removing them also fixed a correctness bug: both asserted an agreement had
 * been signed regardless of whether one had been. The checklist's third row
 * was hardcoded with a green tick and fell back to `ctx.profile.name` when
 * there was no signature name; the preview card rendered on `ctx.agreement`
 * existing alone and printed "Digitally Signed" with no signature. On a
 * hostel with `agreement_required: false` — where the Agreement stage is
 * dropped from the track and nothing is ever signed — this step told the
 * tenant they had signed one. See [[Bugs]].
 *
 * The activation progress bar is not in the design (which has no async
 * anything) and is deliberately kept: it renders only while the real
 * `ACTIVATE` call is in flight, which takes seconds.
 */
interface PasswordActivateStepProps {
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  submitting: boolean;
  activationProgressWidth: string;
  activationMessage: string;
  goToStep: (step: ActivationStep) => void;
  onActivate: () => void;
}

const inputWrap = { background: '#F6F1EA', border: '1px solid #E7DDCE', borderRadius: 10, padding: '0 13px', marginTop: 6 };
const inputBase = { width: '100%', border: 'none', outline: 'none', background: 'transparent', color: '#2A2521', padding: '11px 0' };

export function PasswordActivateStep({
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  submitting,
  activationProgressWidth,
  activationMessage,
  goToStep,
  onActivate,
}: PasswordActivateStepProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const strength = passwordStrength(password);
  const showMatch = confirmPassword.length > 0;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  return (
    <div className="ob-fade-fast">
      <div className="flex items-start gap-[11px]">
        <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]" style={{ background: '#F3E7E0', color: '#B46A55' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <div>
          <div className="font-display text-[18px] font-extrabold tracking-tight" style={{ color: '#1A1A1A' }}>
            Set Your Password
          </div>
          <div className="mt-1 text-xs leading-relaxed" style={{ color: '#6E6459' }}>
            Create a login password to secure your Stayo account.
          </div>
        </div>
      </div>

      <div className="mt-[15px] rounded-[13px] p-3.5" style={{ background: '#fff', border: '1px solid #EFE6DA', boxShadow: '0 1px 2px rgba(40,30,20,.04),0 4px 12px rgba(40,30,20,.045)' }}>
        <div className="font-display text-[15px] font-extrabold" style={{ color: '#1A1A1A' }}>
          Set Account Password
        </div>
        <div className="mt-0.5 text-xs leading-snug" style={{ color: '#6E6459' }}>
          Choose a strong password for future logins.
        </div>

        <div className="mt-[13px] text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
          New Password <span style={{ color: '#D0473A' }}>*</span>
        </div>
        <div className="flex items-center gap-2" style={inputWrap}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password"
            className="min-w-0 flex-1 text-sm font-medium"
            style={inputBase}
          />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="flex-none" style={{ color: '#8A7F75' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {password && (
          <>
            <div className="mt-2.5 h-[5px] overflow-hidden rounded-full" style={{ background: '#EDE4D6' }}>
              <div className={`h-full ${strength.color} rounded-full transition-all`} style={{ width: strength.width }} />
            </div>
            <div className={`mt-1.5 text-[11.5px] font-bold ${strength.textColor}`}>Password strength: {strength.label}</div>
          </>
        )}

        <div className="mt-[13px] text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
          Confirm Password <span style={{ color: '#D0473A' }}>*</span>
        </div>
        <div className="flex items-center gap-2" style={inputWrap}>
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            className="min-w-0 flex-1 text-sm font-medium"
            style={inputBase}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword((v) => !v)}
            className="flex-none"
            style={{ color: '#8A7F75' }}
            aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {showMatch && (
          <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: passwordsMatch ? '#1F7A52' : '#D0473A' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
              <path d={passwordsMatch ? 'M5 12.5l4.5 4.5L19 6' : 'M6 6l12 12M18 6L6 18'} />
            </svg>
            {passwordsMatch ? 'Passwords match' : "Passwords don't match yet"}
          </div>
        )}
      </div>

      {submitting && (
        <div className="mt-3.5 rounded-[13px] p-3.5" style={{ background: '#F6F1EA' }}>
          <div className="flex items-center gap-2.5">
            <StayoLoader size="md" className="text-primary" />
            <p className="text-sm font-bold" style={{ color: '#3A342E' }}>
              {activationMessage}
            </p>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ background: '#EDE4D6' }}>
            <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: activationProgressWidth, background: '#B46A55' }} />
          </div>
        </div>
      )}

      <StepActionBar>
        <BackButton title="Back" onClick={() => goToStep('AGREEMENT')} />
        <PrimaryActionButton onClick={onActivate} disabled={submitting || password.length < 8 || password !== confirmPassword}>
          {submitting ? <StayoLoader size="sm" label={null} /> : <CheckCircle2 className="h-4 w-4" />}
          Create Account &amp; Continue
        </PrimaryActionButton>
      </StepActionBar>
    </div>
  );
}
