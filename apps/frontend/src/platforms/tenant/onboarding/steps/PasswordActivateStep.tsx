import { useState } from 'react';
import { CheckCircle2, Download, Eye, EyeOff } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationContext, ActivationStep } from '../activationTypes';
import { currency } from '../activationTypes';
import { passwordStrength } from './passwordPolicy';
import { AgreementPreviewModal, BackButton } from './shared';

/**
 * Step 4 — "Set Your Password": password + confirm. Rebuilt 2026-08-14 to
 * match `Stayo Onboarding.dc.html`'s Step 4 exactly — inline hex
 * colors/cards/copy read directly from the design source (same treatment as
 * `AgreementStep.tsx`), not approximated via semantic Tailwind tokens.
 * Billing-cycle selection lives in `AccountStep` (Step 1) — matches the
 * design source's actual field placement. The value is still only submitted
 * at the real `ACTIVATE` step, which is where the backend expects it.
 *
 * The onboarding checklist and signed-agreement preview card have no
 * equivalent in the design mockup (its `checklist` state array is defined
 * but never rendered anywhere in the source) — both are real, backend-useful
 * summaries kept from the prior version, restyled into the design's
 * cream/white card language instead of removed.
 */
interface PasswordActivateStepProps {
  ctx: ActivationContext;
  accountPhone: string;
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
  ctx,
  accountPhone,
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
  const [showAgreementPreview, setShowAgreementPreview] = useState(false);
  const strength = passwordStrength(password);
  const showMatch = confirmPassword.length > 0;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  return (
    <div style={{ animation: 'obFade .25s ease' }}>
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

      <div className="mt-3.5 rounded-[13px] p-3.5" style={{ background: '#F6F1EA' }}>
        <div className="text-[10px] font-extrabold uppercase" style={{ color: '#9A8F84', letterSpacing: '.08em' }}>
          Onboarding Verification Checklist
        </div>
        <div className="mt-2.5 flex flex-col gap-2.5">
          {[
            { title: '1. Stay & Allocation Confirmed', sub: `Room ${ctx.room_summary.room_number || 'Assigned'} · ${currency(ctx.room_summary.monthly_rent)}/month` },
            { title: '2. Primary Mobile Verified', sub: `+91 ${accountPhone || ctx.profile?.phone || ctx.tenant?.phone_1}` },
            { title: '3. Hostel Agreement Signed', sub: `Signed as "${ctx.agreement?.tenant_signature_name || ctx.profile?.name}"` },
            { title: '4. Identity Profile Verified', sub: 'Gender, Date of Birth & Guardian details confirmed' },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" style={{ color: '#1F9D57' }} />
              <div>
                <div className="text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
                  {item.title}
                </div>
                <div className="text-[11.5px]" style={{ color: '#8A7F75' }}>
                  {item.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {ctx?.agreement && (
        <div className="mt-3.5 rounded-[13px] p-3.5" style={{ background: '#fff', border: '1px solid #EFE6DA', boxShadow: '0 1px 2px rgba(40,30,20,.04),0 4px 12px rgba(40,30,20,.045)' }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg" style={{ background: '#F3E7E0', color: '#B46A55' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3h7l4 4v14H7z" />
                  <path d="M14 3v4h4M10 12h6M10 16h6" />
                </svg>
              </div>
              <div>
                <div className="font-display text-[13px] font-bold" style={{ color: '#1A1A1A' }}>
                  Signed Rental Agreement
                </div>
                <div className="text-[11.5px]" style={{ color: '#8A7F75' }}>
                  {ctx.agreement.tenant_signature_name ? `Signed by ${ctx.agreement.tenant_signature_name}` : 'Digitally Signed'}
                  {ctx.agreement.tenant_signed_at && ` on ${new Date(ctx.agreement.tenant_signed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAgreementPreview(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
                style={{ background: '#F6F1EA', border: '1px solid #E7DDCE', color: '#3A342E' }}
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </button>
              {ctx.agreement.pdf_url ? (
                <a
                  href={ctx.agreement.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                  style={{ background: '#B46A55', boxShadow: '0 4px 11px rgba(180,106,85,.28)' }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PDF
                </a>
              ) : (
                <span className="text-xs italic" style={{ color: '#8A7F75' }}>
                  Generating PDF...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3.5 rounded-[13px] p-3.5" style={{ background: '#fff', border: '1px solid #EFE6DA', boxShadow: '0 1px 2px rgba(40,30,20,.04),0 4px 12px rgba(40,30,20,.045)' }}>
        <div className="font-display text-[15px] font-extrabold" style={{ color: '#1A1A1A' }}>
          Set Account Password
        </div>
        <div className="mt-0.5 text-xs leading-snug" style={{ color: '#6E6459' }}>
          Choose a strong password for future logins.
        </div>

        <div className="mt-3.5 text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
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

        <div className="mt-3.5 text-[12.5px] font-bold" style={{ color: '#3A342E' }}>
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
            {passwordsMatch ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>✕</span>}
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

      <div className="mt-5 flex items-center gap-2.5 rounded-[15px] p-2.5" style={{ background: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.6)' }}>
        <BackButton title="Back to Agreement" onClick={() => goToStep('AGREEMENT')} />
        <button
          type="button"
          onClick={onActivate}
          disabled={submitting || password.length < 8 || password !== confirmPassword}
          className="flex flex-1 items-center justify-center gap-2 rounded-[11px] py-3.5 font-display text-sm font-bold text-white disabled:opacity-60"
          style={{ background: '#B46A55', boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
        >
          {submitting ? <StayoLoader size="sm" label={null} /> : <CheckCircle2 className="h-4 w-4" />}
          Activate Account
        </button>
      </div>

      {showAgreementPreview && ctx?.agreement && <AgreementPreviewModal agreement={ctx.agreement} onClose={() => setShowAgreementPreview(false)} />}
    </div>
  );
}
