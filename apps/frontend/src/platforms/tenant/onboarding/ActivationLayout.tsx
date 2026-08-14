import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import './onboarding.css';
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
  /** Gender picked on the Identity step — re-skins the journey-track avatar. */
  gender?: string;
  /** Non-blocking banner; the caller owns dismissal. */
  error?: string;
  onDismissError?: () => void;
  children: ReactNode;
}

/** The design's idle threshold before the journey-track avatar sits down and dozes. */
const IDLE_MS = 11000;

/**
 * `bored` in the design source: 11s without a state-changing interaction and
 * the tenant on the track sits down. Any pointer/key/scroll activity, or a
 * change of step, wakes them back up.
 */
function useIdleBored(resetKey: unknown): boolean {
  const [bored, setBored] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const arm = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setBored(true), IDLE_MS);
    };
    const wake = () => {
      setBored((was) => (was ? false : was));
      arm();
    };
    arm();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [resetKey]);

  return bored;
}

/**
 * Flow chrome for the tenant activation wizard, matching `Stayo
 * Onboarding.dc.html`'s "FLOW" screen: the time-of-day gradient carried
 * through from the intro screen, its stars/clouds/sun-moon sky furniture, a
 * dual-brand lockup (Stayo icon × hostel badge/initials, ADR-070) and the
 * 5-node journey track (`ActivationProgress.tsx`).
 *
 * Body content renders directly over the gradient (no enclosing white
 * card) — matching the design, where only specific elements (room-summary
 * tiles, form fields, the sticky action bar) are their own cards, not the
 * whole step. Bottom padding clears the sticky action bar each step renders
 * via `StepActionBar` (`steps/shared.tsx`).
 */
export function ActivationLayout({
  activeStep,
  currentStep,
  completedSteps,
  onStepClick,
  agreementRequired,
  hostelName,
  hostelLogoUrl,
  gender,
  error,
  onDismissError,
  children,
}: ActivationLayoutProps) {
  const [themeOverride, setThemeOverride] = useState<ThemePhase | null>(null);
  const sky = useMemo(() => skyEnv(new Date().getHours(), themeOverride), [themeOverride]);
  const bored = useIdleBored(activeStep);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeOverride);
    setThemeOverride(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: sky.flowGradient, transition: 'background 1.2s ease' }}>
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

      {/* `relative` so the sky furniture's percentage offsets resolve against this
          column, not the viewport — the design authors them against a 402px frame. */}
      <div className="relative mx-auto w-full max-w-md">
        {/* sky furniture — stars, clouds and the tap-to-cycle sun/moon */}
        <div className="pointer-events-none absolute inset-0 z-0" style={{ opacity: sky.starOpacity, transition: 'opacity 1.2s ease' }}>
          <span className="ob-twinkle absolute h-0.5 w-0.5 rounded-full bg-white" style={{ top: 76, left: '32.8%', animationDelay: '.3s' }} />
          <span className="ob-twinkle absolute h-0.5 w-0.5 rounded-full bg-white" style={{ top: 112, left: '17.4%', animationDuration: '3s', animationDelay: '.7s' }} />
          <span className="ob-twinkle absolute h-0.5 w-0.5 rounded-full bg-white" style={{ top: 58, left: '52.2%', animationDuration: '3.3s', animationDelay: '1s' }} />
        </div>
        <div className="ob-drift-flow pointer-events-none absolute z-0 h-[14px] w-[52px] rounded-full" style={{ top: 70, left: '6.5%', background: sky.cloudFill }} />
        <div className="ob-drift2-flow pointer-events-none absolute z-0 h-[11px] w-10 rounded-full" style={{ top: 120, left: '52.2%', background: sky.cloudFill2 }} />

        {sky.showSun && (
          <button
            type="button"
            onClick={cycleTheme}
            title="Tap to change theme"
            aria-label="Change sky theme"
            className="ob-glow-flow absolute right-[30px] top-11 z-[3] h-10 w-10 rounded-full"
            style={{ background: sky.sunFill, boxShadow: sky.sunGlow }}
          />
        )}
        {sky.showMoon && (
          <button
            type="button"
            onClick={cycleTheme}
            title="Tap to change theme"
            aria-label="Change sky theme"
            className="absolute right-[30px] top-11 z-[3] h-[38px] w-[38px] rounded-full"
            style={{ background: '#EDE9DE', boxShadow: '0 0 26px rgba(220,225,240,.4), inset -11px -5px 0 -2px rgba(160,168,190,.35)' }}
          />
        )}

        <div className="relative z-[2] px-3 pb-2 pt-11">
          <div className="flex items-center gap-[9px] px-1 pb-3.5">
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
              <div className="mt-px truncate font-display text-[15px] font-extrabold tracking-tight text-white">{hostelName || 'Stayo'}</div>
            </div>
          </div>

          <div
            className="rounded-2xl border"
            style={{
              background: 'rgba(255,255,255,.55)',
              backdropFilter: 'blur(16px) saturate(150%)',
              WebkitBackdropFilter: 'blur(16px) saturate(150%)',
              borderColor: 'rgba(255,255,255,.6)',
              boxShadow: '0 8px 26px rgba(20,16,13,.16)',
              padding: '11px 14px 12px',
            }}
          >
            <ActivationProgress
              activeStep={activeStep}
              currentStep={currentStep}
              completedSteps={completedSteps}
              onStepClick={onStepClick}
              agreementRequired={agreementRequired}
              bored={bored}
              gender={gender}
            />
          </div>
        </div>

        <div className="relative z-[1]" style={{ padding: '14px 14px 108px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
