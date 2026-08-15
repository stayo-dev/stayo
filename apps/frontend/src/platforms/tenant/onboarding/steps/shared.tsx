import { InputHTMLAttributes, ReactNode } from 'react';
import { StayoLoader } from '@shared/ui/brand';
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
