import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerOnboardingState } from '../hooks/useOwnerOnboardingState';
import { HostelScene } from '@shared/ui/brand';
import { onboardingSceneState } from '../components/onboardingScene';
import { WelcomeStep } from '../components/steps/WelcomeStep';
import { KycStep } from '../components/steps/KycStep';
import { SuccessStep } from '../components/steps/SuccessStep';

const MILESTONE_NAMES = ['Verified', 'Ready'];
const MILESTONE_MAP: Record<string, number> = {
  kyc: 0,
  success: 1,
};

const CONFETTI_COLORS = ['#A45D44', '#D2986C', '#EBD9C4', '#1F8A5B', '#F4C67A'];

function buildConfetti() {
  return Array.from({ length: 46 }, (_, i) => {
    const left = Math.round(((i * 137.5) % 100) + (i % 5) * 2);
    const size = 7 + (i % 4) * 3;
    const dur = 2.6 + (i % 5) * 0.5;
    const delay = (i % 9) * 0.18;
    const rot = `${i % 2 ? '' : '-'}${200 + (i % 5) * 140}deg`;
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const round = i % 3 === 0 ? '50%' : '2px';
    return { id: i, left, size, dur, delay, rot, color, round };
  });
}

/**
 * The onboarding wizard, per Owner Onboarding.dc.html — a single route with
 * internal step state, not one route per step (matches the design's own
 * implementation).
 *
 * Account creation no longer happens here (owner-acquisition funnel phase
 * 3): a lead-approved owner activates their account at `/activation/:token`
 * (OwnerActivationPage) and lands straight on the dashboard already logged
 * in. This wizard is what's left — KYC — and is only reachable by an
 * authenticated owner (gated by `ProtectedRoute` in OwnerJourneyRoutes.tsx).
 */
export function OwnerOnboardingWizard() {
  const navigate = useNavigate();
  const s = useOwnerOnboardingState();


  const isWelcome = s.screenId === 'welcome';
  const isSuccess = s.screenId === 'success';
  const showJourney = !isWelcome;
  const cur = MILESTONE_MAP[s.screenId] ?? -1;
  const nM = MILESTONE_NAMES.length;
  const curFrac = cur <= 0 ? 0 : Math.min(1, cur / (nM - 1));
  const leftAt = (frac: number) => `calc(${(11 - frac * 22).toFixed(2)}px + ${(frac * 100).toFixed(3)}%)`;
  const journeyFill = `calc(${(curFrac * 100).toFixed(3)}% - ${(curFrac * 22).toFixed(2)}px)`;
  const journeyText = isSuccess ? `Step ${nM} of ${nM} · Live` : `Step ${cur + 1} of ${nM} · ${MILESTONE_NAMES[Math.max(0, Math.min(nM - 1, cur))]}`;


  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <HostelScene {...onboardingSceneState(s.step, s.screenId, s.data.hostelName)} />

      {/* atmospheric scrim keeps the form crisp & legible over the scene */}
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_srgb,var(--background)_94%,transparent)_28%,color-mix(in_srgb,var(--background)_55%,transparent)_52%,transparent_78%)]" />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_60%,transparent)_0%,transparent_16%,transparent_82%,color-mix(in_srgb,var(--background)_55%,transparent)_100%)]" />

      <div className="relative z-[2] flex min-h-screen flex-col">
        {/* TOP BAR + JOURNEY */}
        <div className="sticky top-0 z-40 border-b border-border/60 bg-background/72 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-7.5">
            <a href="/owners" className="flex flex-none items-center gap-2">
              <span className="font-display text-xl font-extrabold tracking-tight text-primary">Stayo</span>
            </a>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => stayoToast.info('Progress saved')}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-2 font-display text-[13px] font-bold text-foreground/80 transition-transform active:scale-[0.97]"
            >
              <Save className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              <span className="hidden sm:inline">Save draft</span>
            </button>
          </div>
          {showJourney && (
            <div className="mx-auto max-w-6xl px-4 pb-4 pt-1.5 sm:px-7.5">
              <div className="mb-2 text-center font-display text-xs font-bold text-primary sm:hidden">{journeyText}</div>
              <div className="relative h-10.5">
                <div className="absolute left-2.5 right-2.5 top-3.5 h-2.5 rounded-full bg-secondary shadow-[inset_0_1px_2px_rgba(120,80,60,0.12)]" />
                <div
                  className="absolute left-2.5 top-3.5 h-2.5 rounded-full bg-gradient-to-r from-[#CB8C61] to-primary transition-[width] duration-700"
                  style={{ width: journeyFill }}
                />
                {MILESTONE_NAMES.map((name, i) => {
                  const done = i < cur || isSuccess;
                  const current = i === cur && !isSuccess;
                  return (
                    <div key={name} className="absolute top-2.5 flex -translate-x-1/2 flex-col items-center gap-1.5" style={{ left: leftAt(i / (nM - 1)) }}>
                      <span
                        className={`flex h-4.5 w-4.5 items-center justify-center rounded-full shadow-[0_0_0_3px_var(--background)] transition-all duration-400 ${
                          done ? 'bg-primary' : current ? 'border-[2.5px] border-primary bg-card' : 'bg-[#E1D1BD]'
                        }`}
                        style={current ? { animation: 'stayoNodePulse 2s ease-in-out infinite' } : undefined}
                      >
                        {done && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3.6} />}
                      </span>
                      <span
                        className={`hidden whitespace-nowrap text-center font-display text-[10px] font-bold transition-colors sm:block ${
                          done || current ? 'text-primary' : 'text-[#B9AC9C]'
                        }`}
                      >
                        {name}
                      </span>
                    </div>
                  );
                })}
                <div
                  className="absolute -top-1.5 transition-[left] duration-700"
                  style={{ left: leftAt(curFrac), animation: 'stayoBobPin 1.6s ease-in-out infinite' }}
                >
                  <svg width="19" height="23" viewBox="0 0 24 28">
                    <path d="M12 1C7 1 3 5 3 10c0 6 9 17 9 17s9-11 9-17c0-5-4-9-9-9Z" fill="var(--foreground)" />
                    <circle cx="12" cy="10" r="4" fill="#F4C67A" />
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BODY */}
        <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-9 sm:px-7.5">
          <div key={s.screenId} className="w-full max-w-[540px]" style={{ animation: 'stayoScreenIn .45s cubic-bezier(.2,.8,.2,1) both' }}>
            {/* Nothing here is lost on reload — say so, and offer the way out.
                A silent restore is disorienting: the owner sees answers they
                do not remember giving on this visit. */}
            {s.draftRestored && !isSuccess && (
              <div className="mb-5 flex items-start gap-3 rounded-[14px] border border-border bg-card/80 p-3.5">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-foreground">Picking up where you left off</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    We kept everything you had already filled in.
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={s.dismissDraftBanner}
                    className="text-[12px] font-bold text-muted-foreground hover:text-foreground"
                  >
                    Got it
                  </button>
                  <button
                    type="button"
                    onClick={s.startOver}
                    className="text-[12px] font-semibold text-muted-foreground underline hover:text-destructive"
                  >
                    Start over
                  </button>
                </div>
              </div>
            )}
            {s.screenId === 'welcome' && <WelcomeStep />}
            {s.screenId === 'kyc' && <KycStep kyc={s.kyc} setKyc={s.setKyc} />}
            {s.screenId === 'success' && <SuccessStep onExplore={() => navigate('/owner/home')} />}
          </div>
        </div>

        {/* FOOTER NAV */}
        <div className="sticky bottom-0 z-40 border-t border-border/60 bg-background/78 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-3.5 px-4 py-3.5 sm:px-7.5">
            {s.canBack && (
              <button
                type="button"
                onClick={s.back}
                className="inline-flex items-center gap-1.5 px-2 py-3 font-display text-[15px] font-bold text-foreground/80 transition-colors hover:text-primary"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
                Back
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                if (isSuccess) return navigate('/owner/home');

                // Every step must be complete and correctly formatted before
                // the wizard will move on — a half-filled hostel is far more
                // expensive to unpick after publish.
                const stepError = s.currentStepError();
                if (stepError) {
                  stayoToast.error(stepError);
                  return;
                }

                return s.next();
              }}
              className="inline-flex items-center gap-2 rounded-[13px] bg-primary px-7.5 py-3.5 font-display text-base font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60"
            >
              {s.continueLabel}
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      {/* CONFETTI */}
      {isSuccess && (
        <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
          {buildConfetti().map((p) => (
            <span
              key={p.id}
              className="absolute -top-5"
              style={
                {
                  left: `${p.left}%`,
                  width: p.size,
                  height: p.size + 2,
                  background: p.color,
                  borderRadius: p.round,
                  '--stayo-confetti-rot': p.rot,
                  animation: `stayoConfettiFall ${p.dur}s linear ${p.delay}s forwards`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
