import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Save, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerOnboardingState, type OwnerOnboardingData } from '../hooks/useOwnerOnboardingState';
import { useOnboardingSubmission } from '../hooks/useOnboardingSubmission';
import { OnboardingScene } from '../components/OnboardingScene';
import { WelcomeStep } from '../components/steps/WelcomeStep';
import { AccountStep } from '../components/steps/AccountStep';
import { KycStep } from '../components/steps/KycStep';
import { CreateStep } from '../components/steps/CreateStep';
import { LocationStep } from '../components/steps/LocationStep';
import { DetailsStep } from '../components/steps/DetailsStep';
import { FloorsStep } from '../components/steps/FloorsStep';
import { RoomsStep } from '../components/steps/RoomsStep';
import { BedsStep } from '../components/steps/BedsStep';
import { ReviewStep } from '../components/steps/ReviewStep';
import { PublishStep } from '../components/steps/PublishStep';
import { SuccessStep } from '../components/steps/SuccessStep';

const MILESTONE_NAMES = ['Owner', 'Verified', 'Location', 'Building', 'Rooms', 'Beds', 'Review', 'Live'];
const MILESTONE_MAP: Record<string, number> = {
  account: 0,
  kyc: 1,
  create: 2,
  location: 2,
  details: 3,
  floors: 3,
  rooms: 4,
  beds: 5,
  review: 6,
  publish: 7,
  success: 7,
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
 * The 12-step onboarding wizard, per Owner Onboarding.dc.html — a single
 * route with internal step state, not one route per step (matches the
 * design's own implementation). Gated by RequireMockOwnerJourney upstream
 * (see MockOwnerJourneyContext for why this replaces the real ProtectedRoute
 * assumption from the Phase-1 scaffold).
 *
 * Owner-acquisition funnel phase 2: if reached via a lead activation link
 * (OwnerLeadInvitePage), router state carries `{ prefill, token }` — read
 * once at mount to prefill the wizard and thread the token through to the
 * two backend auto-progression choke points (owner-signup, publish). A
 * normal, non-lead-originated visit has no state here and is unaffected.
 */
export function OwnerOnboardingWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const leadState = location.state as { prefill?: { name?: string; hostel_name?: string; phone?: string; google_email?: string; city?: string }; token?: string } | null;
  const leadToken = leadState?.token;
  const initialData = useMemo((): Partial<OwnerOnboardingData> | undefined => {
    const prefill = leadState?.prefill;
    if (!prefill) return undefined;
    return {
      name: prefill.name || '',
      mobile: prefill.phone || '',
      email: prefill.google_email || '',
      hostelName: prefill.hostel_name || '',
      city: prefill.city || '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const s = useOwnerOnboardingState(initialData);
  const submission = useOnboardingSubmission(s, leadToken);

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
      <OnboardingScene step={s.step} screenId={s.screenId} data={s.data} hostelDisplay={s.hostelDisplay} />

      {/* atmospheric scrim keeps the form crisp & legible over the scene */}
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(90deg,var(--background)_0%,color-mix(in_srgb,var(--background)_94%,transparent)_28%,color-mix(in_srgb,var(--background)_55%,transparent)_52%,transparent_78%)]" />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_60%,transparent)_0%,transparent_16%,transparent_82%,color-mix(in_srgb,var(--background)_55%,transparent)_100%)]" />

      <div className="relative z-[2] flex min-h-screen flex-col">
        {/* TOP BAR + JOURNEY */}
        <div className="sticky top-0 z-40 border-b border-border/60 bg-background/72 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-7.5">
            <a href="/" className="flex flex-none items-center gap-2">
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
            {s.screenId === 'welcome' && <WelcomeStep />}
            {s.screenId === 'account' && (
              <AccountStep data={s.data} setD={s.setD} password={submission.password} setPassword={submission.setPassword} />
            )}
            {s.screenId === 'kyc' && <KycStep kyc={s.kyc} setKyc={s.setKyc} />}
            {s.screenId === 'create' && <CreateStep data={s.data} setD={s.setD} />}
            {s.screenId === 'location' && <LocationStep data={s.data} setD={s.setD} />}
            {s.screenId === 'details' && <DetailsStep data={s.data} setD={s.setD} />}
            {s.screenId === 'floors' && <FloorsStep data={s.data} setD={s.setD} generated={s.floorsGen} onGenerate={() => s.setFloorsGen(true)} />}
            {s.screenId === 'rooms' && <RoomsStep data={s.data} setD={s.setD} generated={s.roomsGen} onGenerate={() => s.setRoomsGen(true)} />}
            {s.screenId === 'beds' && <BedsStep data={s.data} setD={s.setD} generated={s.bedsGen} onGenerate={() => s.setBedsGen(true)} />}
            {s.screenId === 'review' && (
              <ReviewStep data={s.data} hostelDisplay={s.hostelDisplay} totalRooms={s.totalRooms} totalBeds={s.totalBeds} />
            )}
            {s.screenId === 'publish' && <PublishStep publishChoice={s.publishChoice} setPublishChoice={s.setPublishChoice} />}
            {s.screenId === 'success' && (
              <SuccessStep
                hostelDisplay={s.hostelDisplay}
                publishChoice={s.publishChoice}
                onExplore={() => navigate('/owner/home')}
              />
            )}
          </div>
        </div>

        {/* FOOTER NAV */}
        {!s.otpOpen && (
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
                disabled={submission.sendingOtp || submission.publishing}
                onClick={
                  isSuccess
                    ? () => navigate('/owner/home')
                    : s.screenId === 'account'
                    ? submission.submitAccount
                    : s.screenId === 'publish'
                    ? submission.submitPublish
                    : s.next
                }
                className="inline-flex items-center gap-2 rounded-[13px] bg-primary px-7.5 py-3.5 font-display text-base font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60"
              >
                {s.screenId === 'account' && submission.sendingOtp
                  ? 'Creating account…'
                  : s.screenId === 'publish' && submission.publishing
                  ? 'Publishing…'
                  : s.continueLabel}
                <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* OTP SHEET */}
      <BottomSheet
        open={s.otpOpen}
        onOpenChange={s.setOtpOpen}
        title="Enter verification code"
        footer={
          <button
            type="button"
            disabled={submission.verifyingOtp}
            onClick={submission.submitOtp}
            className="w-full rounded-[13px] bg-primary py-4 font-display text-base font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {submission.verifyingOtp ? 'Verifying…' : 'Verify & Continue'}
          </button>
        }
      >
        <p className="mb-6 text-center text-sm text-muted-foreground">Sent to {s.data.mobile.trim() || '+91 90000 00000'}</p>
        <div className="mb-2 flex justify-center">
          <input
            value={submission.otpCode}
            onChange={(e) => submission.setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            inputMode="numeric"
            autoFocus
            className="w-40 rounded-xl border-[1.5px] border-border bg-card px-4 py-3 text-center font-display text-xl font-bold tracking-[0.3em] text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <div className="text-center text-[13px] font-medium text-muted-foreground">
          Didn&apos;t receive? <span className="font-bold text-primary">Resend in 28s</span>
        </div>
      </BottomSheet>

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
