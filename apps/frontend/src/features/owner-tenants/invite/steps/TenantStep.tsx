import type { InviteWizardData } from '../../types';
import type { TenancyConflict } from '@features/tenants/tenancyConflict';
import {
  sanitizeIndianPhone,
  isValidIndianPhone,
  isValidTenantEmail,
  isValidTenantName,
} from '../validation';

interface TenantStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
  /** Pre-submit tenancy-eligibility check on the phone field — see useInviteWizard. */
  isCheckingEligibility?: boolean;
  eligibilityConflict?: TenancyConflict | null;
  hasExistingAccount?: boolean;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

/** Step 1/4 of the Invite Tenant wizard — who's moving in. */
export function TenantStep({
  data,
  setD,
  isCheckingEligibility = false,
  eligibilityConflict = null,
  hasExistingAccount = false,
}: TenantStepProps) {
  const rawPhone = data.tenantPhone;
  const cleanedPhone = sanitizeIndianPhone(rawPhone);

  const showNameError = data.tenantName.trim().length > 0 && !isValidTenantName(data.tenantName);
  const showPhoneError = rawPhone.trim().length > 0 && !isValidIndianPhone(rawPhone);
  const showEmailError = data.tenantEmail.trim().length > 0 && !isValidTenantEmail(data.tenantEmail);

  let phoneHelpText = '';
  if (showPhoneError) {
    if (cleanedPhone.length > 0 && !/^[6-9]/.test(cleanedPhone)) {
      phoneHelpText = 'Mobile number must start with 6, 7, 8, or 9.';
    } else {
      phoneHelpText = `Please enter a complete 10-digit mobile number (${10 - cleanedPhone.length} digits left).`;
    }
  }

  return (
    <div className="flex flex-col gap-4.5">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Who&apos;s moving in? We&apos;ll WhatsApp them an invite to complete KYC.
      </p>

      {/* Full Name */}
      <label className="block">
        <span className={labelStyle}>Full name *</span>
        <input
          value={data.tenantName}
          onChange={(e) => setD({ tenantName: e.target.value })}
          placeholder="Tenant's full name"
          className={`${inputStyle} ${showNameError ? 'border-destructive focus:border-destructive' : ''}`}
        />
        {showNameError && (
          <span className="mt-1 block text-[11.5px] font-medium text-destructive">
            Full name must be at least 2 characters.
          </span>
        )}
      </label>

      {/* Phone Number */}
      <label className="block">
        <span className={labelStyle}>Phone *</span>
        <div className={`flex items-center rounded-[11px] border bg-card px-3.5 ${showPhoneError ? 'border-destructive' : 'border-border'}`}>
          <span className="text-sm font-semibold text-muted-foreground">+91</span>
          <input
            value={data.tenantPhone}
            onChange={(e) => setD({ tenantPhone: sanitizeIndianPhone(e.target.value) })}
            placeholder="90000 00000"
            inputMode="tel"
            maxLength={10}
            className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none"
          />
        </div>
        {showPhoneError && (
          <span className="mt-1 block text-[11.5px] font-medium text-destructive">
            {phoneHelpText}
          </span>
        )}
        {!showPhoneError && isCheckingEligibility && (
          <span className="mt-1.5 block text-[11.5px] font-medium text-muted-foreground">
            Checking this number…
          </span>
        )}
        {!showPhoneError && !isCheckingEligibility && eligibilityConflict && (
          <div className="mt-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
            <p className="mb-0.5 font-bold">{eligibilityConflict.title}</p>
            <p className="font-medium">{eligibilityConflict.body}</p>
          </div>
        )}
        {/*
         * State B (existing account, currently eligible): deliberately no
         * hostel name, history, or score here — hostel_id isn't chosen until
         * the Stay step, and ADR-075 never intended history disclosure at
         * invite-composition time. The "ask them to share their history"
         * affordance (tenantHistoryService.request) is built but needs a
         * hostel_id this step doesn't have, so it's not wired in here.
         */}
        {!showPhoneError && !isCheckingEligibility && !eligibilityConflict && hasExistingAccount && (
          <p className="mt-1.5 block text-[11.5px] leading-relaxed text-muted-foreground">
            This phone number already has a Stayo account. You&apos;ll be inviting an existing user, not creating a new one.
          </p>
        )}
      </label>

      {/* Email Address */}
      <label className="block">
        <span className={labelStyle}>
          Email <span className="font-normal normal-case tracking-normal text-muted-foreground/70">— optional</span>
        </span>
        <input
          value={data.tenantEmail}
          onChange={(e) => setD({ tenantEmail: e.target.value })}
          placeholder="tenant@example.com"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          className={`${inputStyle} ${showEmailError ? 'border-destructive focus:border-destructive' : ''}`}
        />
        {showEmailError ? (
          <span className="mt-1 block text-[11.5px] font-medium text-destructive">
            Please enter a valid email address (e.g. tenant@example.com) or leave it empty.
          </span>
        ) : (
          <span className="mt-1.5 block text-[11.5px] leading-relaxed text-muted-foreground">
            Used only if WhatsApp can&apos;t deliver. Without it, a failed WhatsApp send has no fallback.
          </span>
        )}
      </label>
    </div>
  );
}

