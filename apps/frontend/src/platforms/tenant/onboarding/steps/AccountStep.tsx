import { FormEvent } from 'react';
import { CheckCircle2, Lock, Receipt } from 'lucide-react';
import type { ActivationContext } from '../activationTypes';
import { currency, fmtDate } from '../activationTypes';
import { fieldClass } from './stepStyles';
import { PrimaryButton } from './shared';

/**
 * Step 1 — "Welcome to {hostel}": room-allocation summary (read-only), mobile
 * OTP verification, Gmail capture, and billing-cycle selection. Maps to the
 * backend's `ACCOUNT` step. Field set and order match `Stayo Onboarding.dc.html`'s
 * Step 1 exactly — billing cycle is collected here (per the design) but only
 * actually submitted at the real `ACTIVATE` step, which is where the backend
 * expects it (see `ActivationPage`'s `onActivate` handler).
 */

type AccountDraft = { phone: string; otp: string; email: string };

interface AccountStepProps {
  ctx: ActivationContext;
  account: AccountDraft;
  setAccount: (next: AccountDraft) => void;
  otpSent: boolean;
  otpSending: boolean;
  otpCountdown: number;
  onSendOtp: () => void;
  submitting: boolean;
  onSubmit: (e: FormEvent) => void;
  verified: boolean;
  onContinue: () => void;
  paymentFrequency: string;
  setPaymentFrequency: (v: string) => void;
}

export function AccountStep({
  ctx,
  account,
  setAccount,
  otpSent,
  otpSending,
  otpCountdown,
  onSendOtp,
  submitting,
  onSubmit,
  verified,
  onContinue,
  paymentFrequency,
  setPaymentFrequency,
}: AccountStepProps) {
  if (verified) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Step 1 of 5</p>
          <h2 className="mt-1 text-2xl font-black text-foreground tracking-tight">Welcome</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">Your mobile number has been successfully verified. Let's move to the next step.</p>
        </div>

        <div className="flex items-center justify-between p-4 bg-success/10 rounded-2xl border border-success/20">
          <div className="flex items-center gap-2.5 text-success font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>Mobile Verified</span>
          </div>
          <div className="text-sm font-semibold text-muted-foreground">
            +91 {account.phone || ctx.profile?.phone || ctx.tenant?.phone_1}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground active:scale-[0.98] transition-all shadow-sm cursor-pointer hover:bg-primary/90"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-primary">Step 1 of 5</p>
        <h2 className="mt-1 text-2xl font-black text-foreground tracking-tight">Welcome to {ctx.hostel.name}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">Confirm your stay details and verify your mobile number to begin.</p>
      </div>

      <div className="rounded-2xl border border-border bg-secondary/20 p-4 space-y-3.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/50 pb-2">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Room Allocation</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-bold text-success">Reserved</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-card border border-border/60 p-2.5">
            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Room</span>
            <span className="text-base font-extrabold text-foreground">{ctx.room_summary.room_number || 'Assigned'}</span>
          </div>
          <div className="rounded-xl bg-card border border-border/60 p-2.5">
            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Monthly Rent</span>
            <span className="text-base font-extrabold text-foreground">{currency(ctx.room_summary.monthly_rent)}</span>
          </div>
          <div className="rounded-xl bg-card border border-border/60 p-2.5">
            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Joining Date</span>
            <span className="text-xs font-extrabold text-foreground block mt-1">{fmtDate(ctx.room_summary.joining_date)}</span>
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="block">
          <span className="text-xs font-semibold text-muted-foreground">Primary Mobile Number *</span>
          <div className="flex gap-2 mt-1.5">
            <input
              type="tel"
              value={account.phone}
              onChange={(e) => setAccount({ ...account, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder="e.g. 9876543210"
              className={`${fieldClass} mt-0 flex-1`}
              disabled={otpSent && otpCountdown > 0}
            />
            <button
              type="button"
              disabled={otpSending || otpCountdown > 0 || account.phone.length !== 10}
              onClick={onSendOtp}
              className="px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-all shadow-sm shrink-0 whitespace-nowrap"
            >
              {otpSending ? 'Sending...' : otpCountdown > 0 ? `Resend in ${otpCountdown}s` : otpSent ? 'Resend code' : 'Send Code'}
            </button>
          </div>
        </div>

        {otpSent && (
          <div className="block max-w-sm">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" />
              Verification Code *
            </span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={account.otp}
              onChange={(e) => setAccount({ ...account, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              placeholder="Enter 6-digit code"
              className={`${fieldClass} tracking-widest text-center font-bold text-lg mt-1.5`}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-muted-foreground">We sent a verification code to your mobile number.</p>
          </div>
        )}

        <div className="block">
          <span className="text-xs font-semibold text-muted-foreground">
            Gmail ID <span className="text-destructive">*</span>
          </span>
          <input
            type="email"
            value={account.email}
            onChange={(e) => setAccount({ ...account, email: e.target.value.trim() })}
            placeholder="e.g. yourname@gmail.com"
            className={`${fieldClass} mt-1.5`}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Used for account notifications and hostel communications.</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Receipt className="h-4 w-4" />
            </div>
            <label className="text-xs font-semibold text-muted-foreground">
              Select Billing Cycle <span className="text-destructive">*</span>
            </label>
          </div>
          <select
            value={paymentFrequency}
            onChange={(e) => setPaymentFrequency(e.target.value)}
            className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="MONTHLY">Monthly (Pay rent every month)</option>
            <option value="QUARTERLY">Quarterly (Pay rent every 3 months)</option>
            <option value="HALF_YEARLY">Half Yearly (Pay rent every 6 months)</option>
            <option value="ACADEMIC_YEARLY">Academic Yearly (Pay rent every 12 months)</option>
          </select>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Changing this later will require submitting a change request to the hostel owner.</p>
        </div>

        <PrimaryButton loading={submitting} disabled={!otpSent || account.otp.length < 6}>
          Verify & Continue
        </PrimaryButton>
      </form>
    </div>
  );
}
