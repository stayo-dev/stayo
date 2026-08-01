import type { ReactNode } from 'react';
import { AlertTriangle, Building2, X } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ActivationProgress, type ActivationVisualStep } from './ActivationProgress';

interface ActivationLayoutProps {
  hostelName: string;
  hostelLogoUrl?: string | null;
  activeStep: ActivationVisualStep;
  currentStep: ActivationVisualStep;
  completedSteps: Set<string>;
  onStepClick: (step: ActivationVisualStep) => void;
  /** Non-blocking banner; the caller owns dismissal. */
  error?: string;
  onDismissError?: () => void;
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * Chrome for the tenant activation flow, in the Stayo product theme.
 *
 * Replaces the hand-rolled shell in `portal/pages/ActivateAccountPage.tsx`,
 * which painted a navy `#1B2D5B → #243A72` gradient with an orange `#F07B1D`
 * accent — the retired Shri Adithya identity ([[ADR-033]]), hardcoded as inline
 * styles so no theme change could reach it. This is the first screen a tenant
 * sees after the WhatsApp invitation, so it was also the most visible surface
 * still carrying the old brand.
 *
 * First slice of the `portal → platforms/tenant` extraction: the chrome lives
 * here only, and the legacy page consumes it, so there is exactly one source of
 * truth for it while the step bodies are moved across.
 */
export function ActivationLayout({
  hostelName,
  hostelLogoUrl,
  activeStep,
  currentStep,
  completedSteps,
  onStepClick,
  error,
  onDismissError,
  aside,
  children,
}: ActivationLayoutProps) {
  return (
    <ThemeProvider theme="product">
      <div className="min-h-screen bg-background [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px]">
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
                <button
                  type="button"
                  onClick={onDismissError}
                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 lg:grid-cols-[330px_1fr] lg:py-10">
          <aside className="h-fit overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            {/* Was an inline navy gradient; now the product theme's own dark surface. */}
            <div className="flex items-center gap-3 bg-foreground px-5 py-4">
              <span className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-[14px] bg-background/15 ring-1 ring-background/20">
                {hostelLogoUrl ? (
                  <img src={hostelLogoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="h-5 w-5 text-background/80" strokeWidth={1.8} />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-background/55">Tenant admission</p>
                <h1 className="truncate font-display text-[17px] font-extrabold leading-tight text-background">
                  {hostelName}
                </h1>
              </div>
            </div>

            <div className="p-5">
              <ActivationProgress
                activeStep={activeStep}
                currentStep={currentStep}
                completedSteps={completedSteps}
                onStepClick={onStepClick}
              />
              {aside}
            </div>
          </aside>

          <section className="min-w-0">{children}</section>
        </main>
      </div>
    </ThemeProvider>
  );
}
