import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ActivationProgress, type ActivationVisualStep } from './ActivationProgress';
import { hostelInitials, skyEnv, THEME_CYCLE, type ThemePhase } from './skyTheme';

interface ActivationLayoutProps {
  activeStep: ActivationVisualStep;
  currentStep: ActivationVisualStep;
  completedSteps: Set<string>;
  onStepClick: (step: ActivationVisualStep) => void;
  /** From `activation_state.agreement_required` — hides the Agreement stage when false. */
  agreementRequired?: boolean;
  /** Dual-brand header (Stayo icon × hostel badge), ADR-070. */
  hostelName?: string;
  hostelLogoUrl?: string;
  /** Non-blocking banner; the caller owns dismissal. */
  error?: string;
  onDismissError?: () => void;
  children: ReactNode;
}

/**
 * Flow chrome for the tenant activation wizard, rebuilt 2026-08-13 to match
 * `Stayo Onboarding.dc.html`'s actual "FLOW" header — the previous version
 * (a plain dark bar + hostel name/logo) was a reasonable StayO-themed shell
 * but didn't match the design source at all once compared side by side: no
 * time-of-day gradient carrying through from the intro screen, no Stayo "S"
 * logo mark, and a 4-pill text tracker instead of the design's 5-icon
 * journey track (now `ActivationProgress.tsx`).
 *
 * Body content renders directly over the gradient (no enclosing white
 * card) — matching the design, where only specific elements (room-summary
 * tiles, form fields, the sticky action bar) are their own cards, not the
 * whole step.
 *
 * 2026-08-14 (ADR-070): header became a dual-brand lockup (Stayo icon ×
 * hostel badge/initials) showing the real hostel name instead of a static
 * "Stayo", matching the newer `stayo onbaording/` design source; Identity
 * moved before Agreement in `ActivationProgress.tsx`'s node order.
 */
export function ActivationLayout({
  activeStep,
  currentStep,
  completedSteps,
  onStepClick,
  agreementRequired,
  hostelName,
  hostelLogoUrl,
  error,
  onDismissError,
  children,
}: ActivationLayoutProps) {
  const [themeOverride, setThemeOverride] = useState<ThemePhase | null>(null);
  const sky = useMemo(() => skyEnv(new Date().getHours(), themeOverride), [themeOverride]);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeOverride);
    setThemeOverride(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  return (
    <div className="relative min-h-screen" style={{ background: sky.flowGradient, transition: 'background 1.2s ease' }}>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed left-1/2 top-4 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-destructive/25 bg-card px-4 py-3 shadow-[0_10px_28px_rgba(34,30,26,0.18)]"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-destructive" strokeWidth={1.9} />
            <p className="min-w-0 flex-1 text-[12.5px] font-semibold leading-relaxed text-foreground">{error}</p>
            {onDismissError && (
              <button type="button" onClick={onDismissError} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted" aria-label="Dismiss notification">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {sky.showSun && (
        <button
          type="button"
          onClick={cycleTheme}
          title="Tap to change theme"
          className="absolute right-8 top-11 z-[3] h-10 w-10 animate-pulse rounded-full"
          style={{ background: sky.sunFill, boxShadow: sky.sunGlow }}
        />
      )}
      {sky.showMoon && (
        <button
          type="button"
          onClick={cycleTheme}
          title="Tap to change theme"
          className="absolute right-8 top-11 z-[3] h-[38px] w-[38px] rounded-full"
          style={{ background: '#EDE9DE', boxShadow: '0 0 26px rgba(220,225,240,.4), inset -11px -5px 0 -2px rgba(160,168,190,.35)' }}
        />
      )}

      <div className="mx-auto w-full max-w-md">
        <div className="relative z-[2] px-3 pb-2 pt-11">
          <div className="flex items-center gap-2 px-1 pb-3.5">
            <img src="/stayo-icon.png" alt="Stayo" className="h-[38px] w-[38px] flex-none rounded-[11px]" style={{ boxShadow: '0 4px 12px rgba(180,106,85,.4)' }} />
            <span className="flex-none text-[15px]" style={{ color: '#C9BDAF' }}>
              ×
            </span>
            {hostelLogoUrl ? (
              <img src={hostelLogoUrl} alt={hostelName || 'Hostel'} className="h-[38px] w-[38px] flex-none rounded-[11px] object-cover" style={{ boxShadow: '0 4px 12px rgba(34,30,26,.32)' }} />
            ) : (
              <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]" style={{ background: '#221E1A', boxShadow: '0 4px 12px rgba(34,30,26,.32)' }}>
                <span className="font-display text-sm font-extrabold" style={{ color: '#F0E4D6' }}>
                  {hostelInitials(hostelName || '')}
                </span>
              </div>
            )}
            <div className="ml-0.5 min-w-0">
              <div className="text-[9.5px] font-bold uppercase tracking-[.14em]" style={{ color: '#B7ADA2' }}>
                Tenant Admission
              </div>
              <div className="mt-0.5 truncate font-display text-[15px] font-extrabold tracking-tight text-white">{hostelName || 'Stayo'}</div>
            </div>
          </div>

          <div
            className="rounded-2xl border p-3.5 pb-3"
            style={{
              background: 'rgba(255,255,255,.55)',
              backdropFilter: 'blur(16px) saturate(150%)',
              WebkitBackdropFilter: 'blur(16px) saturate(150%)',
              borderColor: 'rgba(255,255,255,.6)',
              boxShadow: '0 8px 26px rgba(20,16,13,.16)',
            }}
          >
            <ActivationProgress activeStep={activeStep} currentStep={currentStep} completedSteps={completedSteps} onStepClick={onStepClick} agreementRequired={agreementRequired} />
          </div>
        </div>

        <div className="relative z-[1] px-3.5 pb-24 pt-3">{children}</div>
      </div>
    </div>
  );
}
