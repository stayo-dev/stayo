import { useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import './ActivationIntroScreen.css';
import { hostelInitials, skyEnv, THEME_CYCLE, type ThemePhase } from './skyTheme';

/**
 * The animated splash screen shown before the activation wizard starts —
 * ported from `stayo onbaording/Stayo Onboarding.dc.html`'s intro scene
 * (2026-08-14, ADR-070 — supersedes the earlier `Stayo SaaS redesign/`
 * source): a time-of-day sky, a pixel-art Stayo building with a swinging
 * door and "Checking in…/Checking out…" speech bubbles, three looping actor
 * sprites (an arriving tenant, a departing resident with luggage, a passing
 * cyclist), twinkling stars, drifting clouds, a dual-brand header (Stayo
 * icon × hostel badge), and a tap-to-cycle sun/moon theme override. Real
 * data (room/rent/move-in, tenant's first name, hostel name/logo) replaces
 * the design's hardcoded placeholders. Sky color logic lives in
 * `./skyTheme.ts`, shared with `ActivationLayout.tsx`.
 */

interface ActivationIntroScreenProps {
  hostelName: string;
  hostelLogoUrl?: string;
  tenantFirstName?: string;
  roomNumber?: string | number | null;
  monthlyRent?: string | number | null;
  moveInLabel?: string;
  onBeginAdmission: () => void;
}

export function ActivationIntroScreen({
  hostelName,
  hostelLogoUrl,
  tenantFirstName,
  roomNumber,
  monthlyRent,
  moveInLabel,
  onBeginAdmission,
}: ActivationIntroScreenProps) {
  const [themeOverride, setThemeOverride] = useState<ThemePhase | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const sky = useMemo(() => skyEnv(new Date().getHours(), themeOverride), [themeOverride]);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeOverride);
    setThemeOverride(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    if (!next) return;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      const ctx = (audioCtxRef.current ??= new Ctor());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Ambient sound is decorative; a blocked/unavailable AudioContext is a silent no-op.
    }
  };

  return (
    <div
      className="ob-intro-fade relative mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden"
      style={{ background: sky.gradient, transition: 'background 1.2s ease' }}
    >
      {/* stars + clouds */}
      <div className="pointer-events-none absolute inset-0 z-[1]" style={{ opacity: sky.starOpacity, transition: 'opacity 1.2s ease' }}>
        <span className="ob-twinkle absolute h-[3px] w-[3px] rounded-full bg-white" style={{ top: 60, left: '30%' }} />
        <span className="ob-twinkle absolute h-[3px] w-[3px] rounded-full bg-white" style={{ top: 96, left: '54%', animationDelay: '.8s' }} />
        <span className="ob-twinkle absolute h-[2px] w-[2px] rounded-full bg-white" style={{ top: 78, left: '12%', animationDelay: '.4s' }} />
        <span className="ob-twinkle absolute h-[2px] w-[2px] rounded-full bg-white" style={{ top: 110, left: '64%', animationDelay: '1.1s' }} />
      </div>
      <div className="ob-drift pointer-events-none absolute z-[1] h-[15px] w-[56px] rounded-full" style={{ top: 120, left: 60, background: sky.cloudFill }} />
      <div className="ob-drift2 pointer-events-none absolute z-[1] h-[12px] w-[42px] rounded-full" style={{ top: 150, left: '46%', background: sky.cloudFill2 }} />

      {/* sun / moon toggle */}
      {sky.showSun && (
        <button
          type="button"
          onClick={cycleTheme}
          title="Tap to change theme"
          className="ob-glow absolute right-8 z-[7] h-11 w-11 rounded-full"
          style={{ top: sky.sunTop, background: sky.sunFill, boxShadow: sky.sunGlow, transition: 'top 1.2s ease' }}
        />
      )}
      {sky.showMoon && (
        <button
          type="button"
          onClick={cycleTheme}
          title="Tap to change theme"
          className="absolute right-8 top-10 z-[7] h-[42px] w-[42px] rounded-full"
          style={{ background: '#EDE9DE', boxShadow: '0 0 30px rgba(220,225,240,.4), inset -12px -6px 0 -2px rgba(160,168,190,.35)' }}
        />
      )}

      {/* sound toggle */}
      <button
        type="button"
        onClick={toggleSound}
        className="absolute left-5 top-[58px] z-[6] flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-white/20 bg-white/15 text-white backdrop-blur-sm"
      >
        {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>

      {/* title + welcome centerpiece */}
      <div className="relative z-[3] flex flex-none flex-col items-center pt-12 text-center">
        <div className="ob-intro-up text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: sky.eyebrow, animationDelay: '.1s' }}>
          Tenant Admission
        </div>

        <div className="ob-intro-up mt-3 flex items-center gap-2.5" style={{ animationDelay: '.18s' }}>
          <img src="/stayo-icon.png" alt="Stayo" className="h-12 w-12 rounded-2xl" style={{ boxShadow: '0 8px 20px rgba(180,106,85,.42)' }} />
          <span className="text-xl" style={{ color: sky.pillText, opacity: 0.55 }}>
            ×
          </span>
          {hostelLogoUrl ? (
            <img src={hostelLogoUrl} alt={hostelName} className="h-12 w-12 rounded-2xl object-cover" style={{ boxShadow: '0 8px 20px rgba(34,30,26,.4)' }} />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: '#221E1A', boxShadow: '0 8px 20px rgba(34,30,26,.4)' }}>
              <span className="font-display text-lg font-extrabold" style={{ color: '#F0E4D6' }}>
                {hostelInitials(hostelName)}
              </span>
            </div>
          )}
        </div>

        <div
          className="ob-intro-up mt-3 whitespace-nowrap font-display text-[24px] font-extrabold leading-tight tracking-tight"
          style={{ color: sky.title, textShadow: sky.titleShadow, animationDelay: '.25s' }}
        >
          Welcome to Stayo
        </div>
        <div className="ob-intro-up mt-1.5 text-xs font-semibold" style={{ color: sky.pillText, animationDelay: '.3s' }}>
          You're joining <b className="font-extrabold">{hostelName}</b>
        </div>

        <div
          className="ob-intro-up mt-3 inline-flex items-center gap-[7px] rounded-full border py-1.5 pl-2 pr-3.5 backdrop-blur-sm"
          style={{ background: sky.pillBg, borderColor: sky.pillBorder, animationDelay: '.34s' }}
        >
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full font-display text-[11px] font-extrabold text-white" style={{ background: 'linear-gradient(135deg,#D2986C,#B46A55)' }}>
            S
          </span>
          <span className="text-xs font-bold" style={{ color: sky.pillText }}>
            {tenantFirstName ? `Hello, ${tenantFirstName}` : 'Hello'} <span className="opacity-60">·</span> <span style={{ color: sky.greetAccent }}>{sky.greeting}</span>
          </span>
        </div>

        <div
          className="ob-intro-up mt-3 w-[236px] rounded-2xl border p-3.5 backdrop-blur-md"
          style={{ background: sky.cardBg, borderColor: sky.cardBorder, boxShadow: '0 10px 30px rgba(15,12,11,.35)', animationDelay: '.42s' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(180,106,85,.9)', boxShadow: '0 4px 12px rgba(180,106,85,.4)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11l9-8 9 8" />
                <path d="M5 10v10h14V10" />
                <path d="M10 20v-6h4v6" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-[9px] font-bold uppercase tracking-[.12em]" style={{ color: '#E6C9A6' }}>
                Your room is ready
              </div>
              <div className="mt-0.5 font-display text-[15px] font-extrabold text-white">
                Room {roomNumber || '—'} · {monthlyRent ? `₹${Number(monthlyRent).toLocaleString('en-IN')}` : '—'}
                <span className="text-[11px] font-semibold" style={{ color: '#D9CFC3' }}>
                  /mo
                </span>
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5" style={{ borderColor: 'rgba(255,255,255,.14)' }}>
            <span className="ob-glow-fast h-[7px] w-[7px] flex-none rounded-full" style={{ background: '#5FCB8F', boxShadow: '0 0 8px #5FCB8F' }} />
            <span className="text-[11.5px] font-semibold" style={{ color: '#EDE4D6' }}>
              Reserved &amp; waiting{moveInLabel ? ` — move in from ${moveInLabel}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* SCENE: horizon, building, actors */}
      <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-[198px]" style={{ background: 'linear-gradient(180deg,#EDE4D6,#E4D8C4)' }} />
        <div
          className="absolute inset-x-0 h-[3px]"
          style={{ bottom: 198, background: 'repeating-linear-gradient(90deg,#C9BBA8 0 16px,transparent 16px 30px)' }}
        />

        {/* building */}
        <div className="absolute z-[2] w-[160px]" style={{ bottom: 198, right: 6, height: 210 }}>
          <div className="absolute" style={{ top: -2, left: -10, right: -10, height: 32, background: '#0F0C0B', clipPath: 'polygon(5% 100%,50% 0,95% 100%)' }} />
          <div
            className="absolute rounded-t-[9px]"
            style={{ top: 28, left: 0, right: 0, bottom: 0, background: 'linear-gradient(180deg,#2F2A25,#231E1A)', boxShadow: '0 18px 40px rgba(15,12,11,.45)' }}
          />
          <div
            className="absolute rounded-[5px] font-display text-[12px] font-extrabold tracking-[.16em] text-white"
            style={{ top: 42, left: '50%', transform: 'translateX(-50%)', background: '#B46A55', padding: '4px 13px', boxShadow: '0 0 18px rgba(180,106,85,.6)' }}
          >
            STAYO
          </div>
          <div className="absolute grid grid-cols-3 grid-rows-2" style={{ top: 80, left: '50%', transform: 'translateX(-50%)', gap: '13px 15px' }}>
            <div className="rounded-[3px]" style={{ width: 26, height: 22, background: '#FCE9B8', boxShadow: '0 0 9px rgba(252,233,184,.45)' }} />
            <div className="rounded-[3px]" style={{ width: 26, height: 22, background: '#FCE9B8', opacity: 0.85 }} />
            <div className="ob-glow-window rounded-[3px]" style={{ width: 26, height: 22, background: '#FCE9B8', boxShadow: '0 0 9px rgba(252,233,184,.45)' }} />
            <div className="rounded-[3px]" style={{ width: 26, height: 22, background: '#FCE9B8', opacity: 0.8 }} />
            <div className="rounded-[3px]" style={{ width: 26, height: 22, background: '#6B5E4E' }} />
            <div className="rounded-[3px]" style={{ width: 26, height: 22, background: '#FCE9B8', opacity: 0.9 }} />
          </div>
          <div className="absolute overflow-hidden rounded-t-[7px]" style={{ bottom: 0, left: '50%', marginLeft: -25, width: 50, height: 72, background: '#0C0A09' }}>
            <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 130%,#52463A,#0C0A09 70%)' }} />
          </div>
          <div className="ob-door absolute" style={{ bottom: 0, left: '50%', marginLeft: -25, width: 50, height: 72, transformOrigin: 'left center' }}>
            <div
              className="absolute inset-0 rounded-t-[7px]"
              style={{ background: 'linear-gradient(90deg,#3C332B,#2A241F)', borderRight: '2px solid #17130F', boxShadow: 'inset 0 0 0 3px rgba(0,0,0,.12)' }}
            >
              <div className="absolute right-1.5 h-[5px] w-[5px] rounded-full" style={{ top: '52%', background: '#E0B15E', transform: 'translateY(-50%)' }} />
            </div>
          </div>

          {/* check-in / check-out speech bubbles, above the door, synced to the actor loop */}
          <div className="ob-chk-in absolute z-[6]" style={{ bottom: 80, left: '50%', transform: 'translateX(-50%)', opacity: 0, transformOrigin: 'bottom center' }}>
            <div className="relative flex items-center gap-1.5 whitespace-nowrap rounded-[11px] bg-white px-3 py-1.5" style={{ boxShadow: '0 6px 16px rgba(20,16,13,.24)' }}>
              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: '#1F9D57', boxShadow: '0 0 7px #1F9D57' }} />
              <span className="font-display text-[10.5px] font-extrabold" style={{ color: '#1A1A1A' }}>
                Checking in…
              </span>
              <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
            </div>
          </div>
          <div className="ob-chk-out absolute z-[6]" style={{ bottom: 80, left: '50%', transform: 'translateX(-50%)', opacity: 0, transformOrigin: 'bottom center' }}>
            <div className="relative flex items-center gap-1.5 whitespace-nowrap rounded-[11px] bg-white px-3 py-1.5" style={{ boxShadow: '0 6px 16px rgba(20,16,13,.24)' }}>
              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: '#B46A55', boxShadow: '0 0 7px #B46A55' }} />
              <span className="font-display text-[10.5px] font-extrabold" style={{ color: '#1A1A1A' }}>
                Checking out…
              </span>
              <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
            </div>
          </div>
        </div>

        {/* actor A: tenant walks in */}
        <div className="ob-actor-a absolute z-[4] h-[66px] w-[38px]" style={{ bottom: 198 }}>
          <div className="ob-bob-a relative h-[66px] w-[38px]">
            <div className="ob-dust absolute rounded-full" style={{ left: 2, bottom: -3, width: 30, height: 8, background: 'rgba(20,16,13,.2)' }} />
            <div className="absolute rounded-full" style={{ top: 0, left: 10, width: 17, height: 17, background: '#E8B88C' }} />
            <div className="absolute rounded-t-full" style={{ top: -2, left: 8, width: 22, height: 10, background: '#2F2F2F' }} />
            <div className="ob-armb-a absolute rounded-full" style={{ top: 20, left: 16, width: 5, height: 19, background: '#A45D44', transformOrigin: 'top center' }} />
            <div className="absolute rounded-[7px]" style={{ top: 17, left: 9, width: 19, height: 26, background: '#B46A55' }} />
            <div className="absolute rounded-[5px]" style={{ top: 19, left: 5, width: 9, height: 21, background: '#A45D44' }} />
            <div className="ob-legb-a absolute rounded-full" style={{ top: 40, left: 13, width: 6, height: 21, background: '#2F2F2F', transformOrigin: 'top center' }} />
            <div className="ob-legf-a absolute rounded-full" style={{ top: 40, left: 19, width: 6, height: 21, background: '#3A322C', transformOrigin: 'top center' }} />
            <div className="ob-armf-a absolute rounded-full" style={{ top: 20, left: 21, width: 5, height: 19, background: '#B46A55', transformOrigin: 'top center' }} />
          </div>
        </div>

        {/* actor B: resident leaves with luggage */}
        <div className="ob-actor-b absolute z-[4] h-[66px] w-[46px]" style={{ bottom: 198 }}>
          <div className="relative h-[66px] w-[46px]" style={{ transform: 'scaleX(-1)' }}>
            <div className="ob-bob-b relative h-[66px] w-[38px]">
              <div className="ob-dust absolute rounded-full" style={{ left: 2, bottom: -3, width: 30, height: 8, background: 'rgba(20,16,13,.2)' }} />
              <div className="absolute rounded-full" style={{ top: 0, left: 10, width: 17, height: 17, background: '#E8B88C' }} />
              <div className="absolute rounded-t-full" style={{ top: -2, left: 8, width: 22, height: 10, background: '#2F2F2F' }} />
              <div className="ob-armb-b absolute rounded-full" style={{ top: 20, left: 16, width: 5, height: 19, background: '#4A433C', transformOrigin: 'top center' }} />
              <div className="absolute rounded-[7px]" style={{ top: 17, left: 9, width: 19, height: 26, background: '#2F2F2F' }} />
              <div className="ob-legb-b absolute rounded-full" style={{ top: 40, left: 13, width: 6, height: 21, background: '#3A322C', transformOrigin: 'top center' }} />
              <div className="ob-legf-b absolute rounded-full" style={{ top: 40, left: 19, width: 6, height: 21, background: '#23201C', transformOrigin: 'top center' }} />
              <div className="ob-armf-b absolute rounded-full" style={{ top: 20, left: 21, width: 5, height: 19, background: '#4A433C', transformOrigin: 'top center' }} />
            </div>
            <div className="absolute rounded-[3px]" style={{ bottom: 0, left: -14, width: 15, height: 23, background: '#D2986C', border: '1px solid rgba(0,0,0,.22)' }}>
              <div className="absolute inset-x-0.5 top-[3px] h-px" style={{ background: 'rgba(0,0,0,.18)' }} />
              <div className="absolute rounded-[2px]" style={{ top: -15, left: 6, width: 3, height: 16, background: '#2F2F2F' }} />
              <div className="absolute rounded-[2px]" style={{ top: -15, left: 2, width: 11, height: 3, background: '#2F2F2F' }} />
            </div>
          </div>
        </div>

        {/* actor C: cyclist rides in */}
        <div className="ob-actor-c absolute z-[4] h-[60px] w-[62px]" style={{ bottom: 192 }}>
          <div className="absolute inset-0" style={{ transform: 'scaleX(-1)' }}>
            <div className="ob-wheel absolute rounded-full" style={{ bottom: 0, left: 3, width: 24, height: 24, border: '3px solid #23201C' }} />
            <div className="ob-wheel absolute rounded-full" style={{ bottom: 0, left: 35, width: 24, height: 24, border: '3px solid #23201C' }} />
            <div className="absolute" style={{ bottom: 11, left: 14, width: 30, height: 3, background: '#B46A55', transformOrigin: 'left', transform: 'rotate(-4deg)' }} />
            <div className="absolute" style={{ bottom: 11, left: 15, width: 3, height: 20, background: '#B46A55', transformOrigin: 'bottom', transform: 'rotate(26deg)' }} />
            <div className="absolute" style={{ bottom: 11, left: 38, width: 3, height: 20, background: '#B46A55', transformOrigin: 'bottom', transform: 'rotate(-18deg)' }} />
            <div className="absolute rounded-[2px]" style={{ bottom: 29, left: 8, width: 12, height: 3, background: '#23201C' }} />
            <div className="absolute rounded-[2px]" style={{ bottom: 27, left: 30, width: 11, height: 4, background: '#23201C' }} />
            <div className="absolute" style={{ bottom: 30, left: 20, width: 20, height: 26 }}>
              <div className="absolute rounded-[7px]" style={{ top: -2, left: 8, width: 14, height: 20, background: '#A45D44', transform: 'rotate(14deg)' }} />
              <div className="absolute rounded-full" style={{ top: -14, left: 12, width: 15, height: 15, background: '#E8B88C' }} />
              <div className="absolute rounded-t-full" style={{ top: -16, left: 11, width: 18, height: 8, background: '#2F2F2F' }} />
              <div className="ob-legf-c absolute rounded-full" style={{ top: 16, left: 2, width: 5, height: 15, background: '#2F2F2F', transformOrigin: 'top' }} />
              <div className="ob-legb-c absolute rounded-full" style={{ top: 16, left: 8, width: 5, height: 15, background: '#23201C', transformOrigin: 'top' }} />
            </div>
          </div>
        </div>
      </div>

      {/* bottom control sheet */}
      <div
        className="relative z-[5] mt-auto flex flex-none flex-col gap-2.5 px-6 pb-8 pt-5"
        style={{ background: 'linear-gradient(180deg,transparent,#F3ECE0 30%)' }}
      >
        <p className="ob-intro-up text-center text-xs font-medium leading-relaxed text-[#6E6459]" style={{ animationDelay: '.5s' }}>
          Your room is reserved and waiting. Let's finish your admission in 5 quick steps.
        </p>
        <button
          type="button"
          onClick={onBeginAdmission}
          className="ob-intro-up rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,.34)]"
          style={{ animationDelay: '.62s' }}
        >
          Begin Admission →
        </button>
      </div>
    </div>
  );
}
