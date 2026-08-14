import { InputHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { currency } from '../activationTypes';
import { fieldClass } from './stepStyles';

/**
 * Small presentational pieces shared by the activation step components.
 * Ported from `portal/pages/ActivateAccountPage.tsx` (same markup/behavior),
 * relocated here so `AccountStep`/`AgreementStep`/`ProfileStep`/
 * `PasswordActivateStep` can share one definition instead of duplicating it.
 */

export function SectionHeading({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">{icon}</div>
      <div>
        <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

export function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-background p-4">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  helperText,
  inputMode,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  helperText?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
        disabled={disabled}
      />
      {helperText ? <span className="mt-1 block text-xs text-muted-foreground">{helperText}</span> : null}
    </label>
  );
}

export function PrimaryButton({ loading, disabled, children }: { loading: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:scale-[0.98] transition-transform shadow-sm"
    >
      {loading ? <StayoLoader size="sm" label={null} /> : null}
      {children}
    </button>
  );
}

/** The 44px back tile from the design's sticky footer. */
export function BackButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-[11px] border transition-transform active:scale-[0.98]"
      style={{ background: 'rgba(246,241,234,.8)', borderColor: '#EDE3D5', color: '#4A433C' }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
    </button>
  );
}

/**
 * The design's sticky footer: a glass pill holding the back tile and the
 * step's primary action, pinned to the bottom of the flow column over a
 * gradient scrim so scrolling content fades out beneath it rather than
 * ending flush against it. Previously each step rendered this bar inline at
 * the end of its content, so on any step taller than the viewport — every
 * step but the last, in practice — the primary action was below the fold.
 *
 * `ActivationLayout` reserves 108px of bottom padding for this.
 */
export function StepActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed bottom-0 left-1/2 z-[2] w-full max-w-md -translate-x-1/2 p-3" style={{ background: 'linear-gradient(180deg,transparent,#F6F1EA 30%)' }}>
      <div
        className="flex items-center gap-2.5 rounded-[15px] border p-2.5"
        style={{
          background: 'rgba(255,255,255,.7)',
          backdropFilter: 'blur(18px) saturate(150%)',
          WebkitBackdropFilter: 'blur(18px) saturate(150%)',
          borderColor: 'rgba(255,255,255,.6)',
          boxShadow: '0 8px 24px rgba(20,16,13,.14)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The design's primary footer button — terracotta by default, ink on the final "Enter Stayo" step. */
export function PrimaryActionButton({
  type = 'button',
  onClick,
  disabled,
  dark,
  children,
}: {
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      // eslint-disable-next-line react/button-has-type -- narrowed to 'button' | 'submit' by the prop type
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-2 rounded-[11px] py-3.5 font-display text-sm font-bold text-white disabled:opacity-60"
      style={{ background: dark ? '#1B1714' : '#B46A55', boxShadow: dark ? '0 6px 16px rgba(27,23,20,.3)' : '0 6px 16px rgba(180,106,85,.3)' }}
    >
      {children}
    </button>
  );
}

interface AgreementPreviewModalProps {
  agreement: NonNullable<import('../activationTypes').ActivationContext['agreement']>;
  onClose: () => void;
}

export function AgreementPreviewModal({ agreement, onClose }: AgreementPreviewModalProps) {
  const ruleCategories = agreement?.content_snapshot?.hostel_rules?.categories || [];

  const body = (
    <div className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-0 sm:p-4">
      <div className="w-full h-full sm:h-[85vh] sm:max-w-4xl bg-card rounded-none sm:rounded-3xl border-0 sm:border border-border/80 shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-muted/30 flex justify-between items-center">
          <div>
            <h3 className="font-extrabold text-foreground text-lg tracking-tight">Rental Agreement Preview</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Hostel: {agreement.content_snapshot.hostel_name}</p>
          </div>
          <div className="flex items-center gap-2.5">
            {agreement.pdf_url && (
              <a
                href={agreement.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition-all active:scale-[0.98] shadow-sm shadow-primary/20 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6 flex-1 overflow-y-auto select-none bg-secondary/5">
          <div className="rounded-2xl border border-border bg-background p-6 md:p-8 space-y-5 text-sm leading-relaxed text-foreground shadow-sm">
            <div className="text-center border-b pb-4 mb-4">
              <h3 className="font-extrabold text-base tracking-tight text-slate-800 uppercase">HOSTEL RESIDENCY AGREEMENT</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Hostel: {agreement.content_snapshot.hostel_name}</p>
            </div>

            <p>
              This agreement is made and entered into by and between the Hostel Management of{' '}
              <strong>{agreement.content_snapshot.hostel_name}</strong> (represented by{' '}
              <strong>{agreement.content_snapshot.owner_name}</strong>) and the Tenant{' '}
              <strong>{agreement.content_snapshot.tenant_name}</strong>.
            </p>

            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-3 mb-1">1. Room & Financial Summary</h4>
            <div className="bg-muted/40 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs border border-border/50">
              <div>
                <span className="text-muted-foreground">Assigned Room:</span>{' '}
                <strong className="text-foreground">{agreement.content_snapshot.room_number}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Joining Date:</span>{' '}
                <strong className="text-foreground">{agreement.content_snapshot.joining_date}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Monthly Rent:</span>{' '}
                <strong className="text-foreground">{currency(agreement.content_snapshot.monthly_rent)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Security Deposit:</span>{' '}
                <strong className="text-foreground">{currency(agreement.content_snapshot.advance_deposit)}</strong>
              </div>
              {agreement.content_snapshot.maintenance_charge > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Maintenance Charge:</span>{' '}
                  <strong className="text-foreground">
                    {currency(agreement.content_snapshot.maintenance_charge)} ({agreement.content_snapshot.maintenance_type})
                  </strong>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Payment Cycle:</span>{' '}
                <strong className="text-foreground">{agreement.content_snapshot.payment_frequency}</strong>
              </div>
            </div>

            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">2. Terms of Residency & Rules Compliance</h4>
            <ul className="list-disc pl-5 space-y-2 text-xs text-muted-foreground">
              <li>The Tenant shall use the allocated room solely for residential purposes. Sub-letting or transferring the room to any other person is strictly prohibited.</li>
              <li>
                The Tenant agrees to pay the monthly rent of {currency(agreement.content_snapshot.monthly_rent)} on or before the due date as
                defined by the hostel policy. Late payments may attract fees or lead to suspension of access.
              </li>
              <li>
                A refundable security deposit of {currency(agreement.content_snapshot.advance_deposit)} is deposited with the management, which
                will be settled/refunded upon successful move-out compliance checks, subject to clearance of all pending dues and room inspection
                for damages.
              </li>
              <li>Either party must provide at least 30 days written notice prior to terminating this residency agreement.</li>
              <li className="text-foreground font-medium bg-secondary/20 p-2.5 rounded border border-border/50 list-none mt-1">
                <strong>Hostel Rules Binding Clause:</strong> The Tenant explicitly agrees to follow, comply with, and be legally bound by each and
                every rule, policy, and regulation of the hostel. This includes all guidelines concerning fee refunds, hostel discipline, guest
                policies, late fee obligations, and property damage liabilities. Any breach of these rules constitutes a violation of this
                residency agreement and may result in immediate termination of stay.
              </li>
            </ul>

            {ruleCategories.length > 0 && (
              <>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">3. Hostel Rules & Regulations</h4>
                <div className="space-y-4 pl-2 text-xs text-muted-foreground border-l-2 border-slate-100 ml-1">
                  {ruleCategories.map((category: any) => (
                    <div key={category.id} className="space-y-1.5">
                      <h5 className="font-bold text-slate-800">{category.title}</h5>
                      <ul className="list-disc pl-5 space-y-1">
                        {(category.highlights || []).map((hl: string, idx: number) => (
                          <li key={`hl-${idx}`} className="italic text-foreground font-medium">
                            {hl}
                          </li>
                        ))}
                        {(category.rules || []).map((rule: string, idx: number) => (
                          <li key={`rule-${idx}`}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}

            {agreement.content_snapshot.custom_rules && (
              <>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mt-4 mb-1">4. Additional Custom Rules</h4>
                <p className="text-xs whitespace-pre-line text-muted-foreground bg-amber-50/20 border border-amber-500/10 rounded-lg p-3 italic">
                  {agreement.content_snapshot.custom_rules}
                </p>
              </>
            )}

            {(agreement.tenant_signature_name || agreement.guardian_signature_name) && (
              <div className="border-t border-dashed pt-4 mt-4 space-y-3">
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">Digital Signatures & Verification Details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  {agreement.tenant_signature_name && (
                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="font-bold block text-foreground">Lessee (Tenant) Signature</span>
                      <span className="text-muted-foreground block">Name: {agreement.tenant_signature_name}</span>
                      {agreement.tenant_signed_at && (
                        <span className="block text-[10px] text-muted-foreground/80">
                          Date:{' '}
                          {new Date(agreement.tenant_signed_at).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  )}
                  {agreement.guardian_signature_name && (
                    <div className="p-3 rounded-xl border bg-muted/20 space-y-1">
                      <span className="font-bold block text-foreground">Parent/Guardian Signature</span>
                      <span className="text-muted-foreground block">
                        Name: {agreement.guardian_signature_name} ({agreement.guardian_relation || 'Parent'})
                      </span>
                      {agreement.guardian_signed_at && (
                        <span className="block text-[10px] text-muted-foreground/80">
                          Date:{' '}
                          {new Date(agreement.guardian_signed_at).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground mt-4 pt-4 border-t border-dashed">
              This electronic document is valid under the Information Technology Act. Digital signatures and IP details collected during
              onboarding are legally binding.
            </p>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-border bg-muted/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-95 transition-all cursor-pointer"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(body, document.body);
}
