import { useState } from 'react';
import { CheckCircle2, Download, Eye, EyeOff, FileText } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationContext, ActivationStep } from '../activationTypes';
import { currency } from '../activationTypes';
import { passwordStrength } from './passwordPolicy';
import { fieldClass } from './stepStyles';
import { AgreementPreviewModal, BackButton, SectionHeading } from './shared';

/**
 * Step 4 — "Set Your Password": password + confirm. Billing-cycle selection
 * lives in `AccountStep` (Step 1) — matches the design source's actual field
 * placement (moved there 2026-08-13 after direct comparison; the earlier
 * placement here was based on the legacy page's submit-timing, not the
 * design's field layout). The value is still only submitted at the real
 * `ACTIVATE` step, which is where the backend expects it.
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

  return (
    <div className="space-y-6">
      <SectionHeading icon={<CheckCircle2 className="w-5 h-5 text-success" />} title="Activate Your Account" text="Secure your account and complete activation to log in to the tenant portal." />

      <div className="rounded-2xl border border-border bg-secondary/15 p-4.5 space-y-3 shadow-sm">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Onboarding Verification Checklist</h3>
        <div className="space-y-2.5">
          <div className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-success" />
            <div>
              <span className="font-semibold text-foreground block">1. Stay & Allocation Confirmed</span>
              <span className="text-xs text-muted-foreground">
                Room {ctx.room_summary.room_number || 'Assigned'} • {currency(ctx.room_summary.monthly_rent)}/month
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-success" />
            <div>
              <span className="font-semibold text-foreground block">2. Primary Mobile Verified</span>
              <span className="text-xs text-muted-foreground">+91 {accountPhone || ctx.profile?.phone || ctx.tenant?.phone_1}</span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-success" />
            <div>
              <span className="font-semibold text-foreground block">3. Hostel Agreement Signed</span>
              <span className="text-xs text-muted-foreground">Signed as "{ctx.agreement?.tenant_signature_name || ctx.profile?.name}"</span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-success" />
            <div>
              <span className="font-semibold text-foreground block">4. Identity Profile Verified</span>
              <span className="text-xs text-muted-foreground">Gender, Date of Birth & Guardian details confirmed</span>
            </div>
          </div>
        </div>
      </div>

      {ctx?.agreement && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Signed Rental Agreement</h4>
                <p className="text-xs text-muted-foreground">
                  {ctx.agreement.tenant_signature_name ? `Signed by ${ctx.agreement.tenant_signature_name}` : 'Digitally Signed'}
                  {ctx.agreement.tenant_signed_at && ` on ${new Date(ctx.agreement.tenant_signed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAgreementPreview(true)}
                className="px-3.5 py-2 rounded-xl border border-border bg-background hover:bg-secondary text-xs font-semibold text-foreground transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Eye className="w-3.5 h-3.5" />
                View
              </button>
              {ctx.agreement.pdf_url ? (
                <a
                  href={ctx.agreement.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/95 text-xs font-semibold text-primary-foreground transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm shadow-primary/15"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </a>
              ) : (
                <span className="text-xs text-muted-foreground italic">Generating PDF...</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-foreground">Set Account Password</h3>
          <p className="text-xs text-muted-foreground">Choose a strong password to access your dashboard in the future.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">New Password *</span>
            <div className="relative mt-1.5">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldClass} mt-0 pr-11`} placeholder="Min 8 characters" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password && (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${strength.color} transition-all`} style={{ width: strength.width }} />
                </div>
                <p className={`mt-1 text-[10px] font-bold ${strength.textColor}`}>Password strength: {strength.label}</p>
              </>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Confirm Password *</span>
            <div className="relative mt-1.5">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`${fieldClass} mt-0 pr-11`}
                placeholder="Re-enter password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        </div>
      </div>

      {submitting && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <StayoLoader size="md" className="text-primary" />
            <p className="text-sm font-bold text-foreground">{activationMessage}</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: activationProgressWidth }} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <BackButton title="Back to Identity" onClick={() => goToStep('PROFILE')} />
        <button
          type="button"
          onClick={onActivate}
          disabled={submitting || password.length < 8 || password !== confirmPassword}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
        >
          {submitting ? <StayoLoader size="sm" label={null} /> : <CheckCircle2 className="w-4 h-4" />}
          Activate Account
        </button>
      </div>

      {showAgreementPreview && ctx?.agreement && <AgreementPreviewModal agreement={ctx.agreement} onClose={() => setShowAgreementPreview(false)} />}
    </div>
  );
}
