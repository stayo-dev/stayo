import { toLinearGradient, type Stop } from './skyContrast';

/**
 * Time-of-day sky theme shared by the intro splash and the wizard's header —
 * both surfaces in `Stayo Onboarding.dc.html` derive their background from the
 * same `skyEnv()` logic, just with a different stop list (`introStops` for the
 * splash's full-bleed scene, `bandStops` for the wizard's header band).
 * Extracted here so both stay in sync rather than duplicating the colour
 * definitions.
 *
 * Every text colour here is chosen *for the stretch of sky it sits on*, and
 * `skyTheme.test.ts` proves it: each one clears WCAG AA against the actual
 * gradient rows under it, in all three phases. Change a colour or a stop and
 * that test says whether the text is still readable — don't judge it by eye
 * in whichever phase the clock happens to be showing.
 *
 * Palette: Stayo's brand (Stayo-Brand-Assetes/color/colors.txt) — Warm Clay
 * #B46A55, Terra Cotta #A45D44, Dusty Orange #D2986C, Latte #EBD9C4, Charcoal
 * #2F2F2F, Cream #F7F3EE — plus deeper/lighter shades of those for text that
 * has to hold contrast on a sky. The only cool colours are the pale daytime
 * sky and the moon, which are scenery, not accents.
 */

export type ThemePhase = 'day' | 'dusk' | 'night';

export type SkyEnv = {
  phase: ThemePhase;
  greeting: string;
  /** Splash sky, as percentages of the splash's height (the viewport). */
  introStops: readonly Stop[];
  gradient: string;
  /**
   * Wizard header sky, as percentages of the header band's own height — not the
   * page's. See ActivationLayout for why the sky stops at the header.
   * Always ends on `FLOW_GROUND`, so the band meets the step body seamlessly.
   */
  bandStops: readonly Stop[];
  flowGradient: string;
  showSun: boolean;
  showMoon: boolean;
  sunTop: string;
  sunFill: string;
  sunGlow: string;
  starOpacity: number;
  cloudFill: string;
  cloudFill2: string;
  /** Splash: "Tenant Admission". */
  eyebrow: string;
  /** Splash: "Welcome to Stayo". */
  title: string;
  titleShadow: string;
  pillBg: string;
  pillBorder: string;
  /** Splash: "You're joining …", and the greeting pill's text. */
  pillText: string;
  /** Splash: the "Good Afternoon" accent inside the pill. */
  greetAccent: string;
  /** Splash room card's glass. Its text is `INTRO_CARD_INK`, the same in every phase. */
  cardBg: string;
  cardBorder: string;
  /** Wizard header: "Tenant Admission" over the band sky. */
  lockupEyebrow: string;
  /** Wizard header: the hostel name over the band sky. */
  lockupTitle: string;
  /** Wizard header: the "×" between the two brand badges (decorative). */
  lockupSep: string;
  /**
   * The frosted progress panel's fill.
   *
   * Its contents are dark ink (`PANEL_INK`) on translucent white, so
   * legibility depends on what shows through. Over the daytime band it can be
   * quite clear; after dark the panel has to be nearly opaque, or the muted
   * labels ("3 steps left", pending step names) drop to ~2.4:1.
   */
  panelBg: string;
  panelBorder: string;
};

/**
 * The wizard's step body ground — the colour every header band fades into,
 * the sticky action bar's scrim, and what every step's heading and field
 * labels actually sit on.
 */
export const FLOW_GROUND = '#F6F1EA';

/**
 * Text that renders directly on `FLOW_GROUND` — step titles, subtitles, the
 * small uppercase field labels. The ground is the same at every hour, so so is
 * the ink.
 *
 * These were previously phase-dependent (`onSkyTitle`/`onSkyBody`/`onSkyLabel`)
 * because the steps sat on a sky gradient sized to the whole page: where a
 * label landed on that gradient depended on how long the step was, so no
 * single colour per phase could work — at night, labels high on a long form
 * sat on dark sky and labels lower down sat on cream.
 */
export const FLOW_INK = {
  title: '#2A2521',
  body: '#6E635A',
  label: '#6E635A',
  /** "Step 1 of 5" above a step's title — Terra Cotta deepened, since #A45D44 itself is 4.4:1 here. */
  stepEyebrow: '#8F4E39',
} as const;

/** Text inside the progress panel (ActivationProgress). Checked through `panelBg` in every phase. */
export const PANEL_INK = {
  /** "Step 2 of 5", and the current step's name. */
  active: '#8F4E39',
  /** "3 steps left". */
  muted: '#5A5147',
  /** Names of steps not reached yet. */
  pending: '#6E635A',
  /** Names of completed steps. */
  done: '#1F7A52',
} as const;

/** Text on the splash's room card. Checked through `cardBg` in every phase. */
export const INTRO_CARD_INK = {
  /** "Your room is ready". */
  eyebrow: '#EBD9C4',
  /** "Room 401 · ₹8,500". */
  text: '#FFFFFF',
  /** "/mo". */
  muted: '#E3D9CE',
  /** "Reserved & waiting — move in from …". */
  body: '#EDE4D6',
} as const;

export const THEME_CYCLE: (ThemePhase | null)[] = [null, 'day', 'dusk', 'night'];

function withGradients(env: Omit<SkyEnv, 'gradient' | 'flowGradient'>): SkyEnv {
  return { ...env, gradient: toLinearGradient(env.introStops), flowGradient: toLinearGradient(env.bandStops) };
}

export function skyEnv(hour: number, override: ThemePhase | null): SkyEnv {
  const phase: ThemePhase = override ?? (hour >= 7 && hour < 17 ? 'day' : (hour >= 5 && hour < 7) || (hour >= 17 && hour < 20) ? 'dusk' : 'night');

  let greeting: string;
  if (hour >= 5 && hour < 12) greeting = 'Good Morning';
  else if (hour >= 12 && hour < 17) greeting = 'Good Afternoon';
  else if (hour >= 17 && hour < 21) greeting = 'Good Evening';
  else greeting = 'Good Night';

  if (phase === 'day') {
    return withGradients({
      phase,
      greeting,
      introStops: [['#9DBAC6', 0], ['#BFD0CC', 26], ['#DCD6C6', 44], ['#EBD9C4', 54], ['#EDE4D6', 70], ['#F3ECE0', 100]],
      bandStops: [['#9DBAC6', 0], ['#BFD0CC', 36], ['#D8D2C2', 61], ['#E7DFCE', 80], [FLOW_GROUND, 100]],
      showSun: true,
      showMoon: false,
      sunTop: '40px',
      sunFill: 'radial-gradient(circle,#FDEFCB,#F0B466)',
      sunGlow: '0 0 30px rgba(210,152,108,.55)',
      starOpacity: 0,
      cloudFill: 'rgba(255,251,244,.75)',
      cloudFill2: 'rgba(255,248,238,.6)',
      eyebrow: '#6B3A2A',
      title: '#2F2F2F',
      titleShadow: '0 1px 12px rgba(255,255,255,.5)',
      pillBg: 'rgba(255,252,247,.55)',
      pillBorder: 'rgba(47,47,47,.14)',
      pillText: '#2F2F2F',
      greetAccent: '#8F4E39',
      cardBg: 'rgba(47,42,38,.74)',
      cardBorder: 'rgba(255,255,255,.4)',
      lockupEyebrow: '#6B3A2A',
      lockupTitle: '#2F2F2F',
      lockupSep: 'rgba(47,47,47,.4)',
      panelBg: 'rgba(255,255,255,.7)',
      panelBorder: 'rgba(255,255,255,.6)',
    });
  }
  if (phase === 'dusk') {
    return withGradients({
      phase,
      greeting,
      introStops: [['#2B2420', 0], ['#6E4A4A', 24], ['#C57456', 42], ['#E39A5E', 52], ['#D9BE95', 62], ['#EDE4D6', 76], ['#F3ECE0', 100]],
      bandStops: [['#2B2420', 0], ['#6E4A4A', 40], ['#C57456', 60], ['#E39A5E', 74], ['#E6D3B2', 88], [FLOW_GROUND, 100]],
      showSun: true,
      showMoon: false,
      sunTop: '92px',
      sunFill: 'radial-gradient(circle,#FFE0A8,#FF9E4D)',
      sunGlow: '0 0 40px rgba(255,140,60,.6)',
      starOpacity: 0.25,
      cloudFill: 'rgba(255,210,170,.28)',
      cloudFill2: 'rgba(255,190,150,.22)',
      eyebrow: '#E8D3C4',
      title: '#fff',
      titleShadow: '0 2px 14px rgba(0,0,0,.3)',
      pillBg: 'rgba(43,30,26,.36)',
      pillBorder: 'rgba(255,255,255,.24)',
      pillText: '#F6ECE2',
      greetAccent: '#FFCF94',
      cardBg: 'rgba(47,42,38,.7)',
      cardBorder: 'rgba(255,255,255,.22)',
      lockupEyebrow: '#EAD9CC',
      lockupTitle: '#FFFFFF',
      lockupSep: '#C9BDAF',
      panelBg: 'rgba(255,250,244,.95)',
      panelBorder: 'rgba(255,255,255,.7)',
    });
  }
  return withGradients({
    phase,
    greeting,
    introStops: [['#141110', 0], ['#221B18', 28], ['#332621', 44], ['#4A3A31', 54], ['#6E5642', 62], ['#D3C1A6', 74], ['#EDE4D6', 82], ['#F3ECE0', 100]],
    bandStops: [['#141110', 0], ['#221B18', 32], ['#332621', 54], ['#4A3A31', 72], ['#C9B79C', 87], ['#EFE6DA', 95], [FLOW_GROUND, 100]],
    showSun: false,
    showMoon: true,
    sunTop: '40px',
    sunFill: '',
    sunGlow: '',
    starOpacity: 1,
    cloudFill: 'rgba(255,255,255,.08)',
    cloudFill2: 'rgba(255,255,255,.06)',
    eyebrow: '#B7ADA2',
    title: '#fff',
    titleShadow: '0 2px 16px rgba(0,0,0,.35)',
    pillBg: 'rgba(255,255,255,.12)',
    pillBorder: 'rgba(255,255,255,.2)',
    pillText: '#F3ECE0',
    greetAccent: '#F0C48A',
    cardBg: 'rgba(47,42,38,.32)',
    cardBorder: 'rgba(255,255,255,.22)',
    lockupEyebrow: '#B7ADA2',
    lockupTitle: '#FFFFFF',
    lockupSep: '#C9BDAF',
    panelBg: 'rgba(252,248,242,.96)',
    panelBorder: 'rgba(255,255,255,.6)',
  });
}

/**
 * Initials badge fallback for the dual-brand header (Stayo icon × hostel
 * badge) when a hostel has no `logo_url` — up to 2 letters, one per word,
 * matching the design source's static "SA" for "Sunrise Residency".
 */
export function hostelInitials(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
