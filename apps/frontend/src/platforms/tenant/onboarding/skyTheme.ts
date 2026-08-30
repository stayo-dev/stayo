/**
 * Time-of-day sky theme shared by the intro splash and the wizard's flow
 * header — both surfaces in `Stayo Onboarding.dc.html` derive their
 * background from the same `skyEnv()` logic, just with a different gradient
 * stop list (`gradient` for the intro's full-bleed scene, `flowGradient` for
 * the shorter wizard chrome). Extracted here so both stay in sync rather
 * than duplicating ~80 lines of color definitions.
 */

export type ThemePhase = 'day' | 'dusk' | 'night';

export type SkyEnv = {
  phase: ThemePhase;
  gradient: string;
  flowGradient: string;
  greeting: string;
  showSun: boolean;
  showMoon: boolean;
  sunTop: string;
  sunFill: string;
  sunGlow: string;
  starOpacity: number;
  cloudFill: string;
  cloudFill2: string;
  eyebrow: string;
  title: string;
  titleShadow: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  greetAccent: string;
  cardBg: string;
  cardBorder: string;
  /**
   * Text that sits **directly on the sky gradient** rather than inside an opaque
   * card — step titles, subtitles and the small uppercase field labels.
   *
   * The wizard body renders straight over `flowGradient` with no surface of its
   * own (see ActivationLayout: "Body content renders directly over the
   * gradient"), while the step components used fixed warm greys (#7A6F63,
   * #8A7F75) chosen for the daytime cream. Those greys are close to invisible
   * against the dusk and night gradients, so labels faded out at exactly the
   * hours most people open the link.
   *
   * Text inside an opaque card keeps its own dark ink — only text over the sky
   * uses these.
   */
  onSkyTitle: string;
  onSkyBody: string;
  onSkyLabel: string;
  onSkyShadow: string;
  /**
   * The frosted progress panel's fill.
   *
   * Its contents are dark ink on translucent white, so legibility depends
   * entirely on what shows through. At `.55` over the daytime gradient the panel
   * resolves near-white and reads fine; over the night gradient it resolves to
   * mid-grey and the muted labels ("3 steps left", the pending step names) fall
   * to roughly 2.4:1. Raising the opacity after dark keeps the glass look while
   * putting the text back on a light surface — the right fix for text on a
   * panel, as opposed to the `onSky*` tokens which are for text on the sky
   * itself.
   */
  panelBg: string;
  panelBorder: string;
};

export const THEME_CYCLE: (ThemePhase | null)[] = [null, 'day', 'dusk', 'night'];

export function skyEnv(hour: number, override: ThemePhase | null): SkyEnv {
  const phase: ThemePhase = override ?? (hour >= 7 && hour < 17 ? 'day' : (hour >= 5 && hour < 7) || (hour >= 17 && hour < 20) ? 'dusk' : 'night');

  let greeting: string;
  if (hour >= 5 && hour < 12) greeting = 'Good Morning';
  else if (hour >= 12 && hour < 17) greeting = 'Good Afternoon';
  else if (hour >= 17 && hour < 21) greeting = 'Good Evening';
  else greeting = 'Good Night';

  if (phase === 'day') {
    return {
      phase,
      greeting,
      gradient: 'linear-gradient(180deg,#9DBAC6 0%,#BFD0CC 26%,#DCD6C6 44%,#EBD9C4 54%,#EDE4D6 70%,#F3ECE0 100%)',
      flowGradient: 'linear-gradient(180deg,#9DBAC6 0%,#BFD0CC 15%,#D8D2C2 25%,#E7DFCE 33%,#F3ECE0 41%,#F6F1EA 100%)',
      showSun: true,
      showMoon: false,
      sunTop: '40px',
      sunFill: 'radial-gradient(circle,#FDEFCB,#F0B466)',
      sunGlow: '0 0 30px rgba(210,152,108,.55)',
      starOpacity: 0,
      cloudFill: 'rgba(255,251,244,.75)',
      cloudFill2: 'rgba(255,248,238,.6)',
      eyebrow: '#7A4A38',
      title: '#2F2F2F',
      titleShadow: '0 1px 12px rgba(255,255,255,.5)',
      pillBg: 'rgba(255,252,247,.55)',
      pillBorder: 'rgba(47,47,47,.14)',
      pillText: '#2F2F2F',
      greetAccent: '#A45D44',
      cardBg: 'rgba(47,42,38,.32)',
      cardBorder: 'rgba(255,255,255,.4)',
      // Daytime keeps the original warm greys: the gradient is cream here and
      // dark ink is correct.
      onSkyTitle: '#2A2521',
      onSkyBody: '#6E635A',
      onSkyLabel: '#7A6F63',
      onSkyShadow: 'none',
      panelBg: 'rgba(255,255,255,.55)',
      panelBorder: 'rgba(255,255,255,.6)',
    };
  }
  if (phase === 'dusk') {
    return {
      phase,
      greeting,
      gradient: 'linear-gradient(180deg,#2B2420 0%,#6E4A4A 24%,#C57456 42%,#E39A5E 52%,#D9BE95 62%,#EDE4D6 76%,#F3ECE0 100%)',
      flowGradient: 'linear-gradient(180deg,#2B2420 0%,#6E4A4A 13%,#C57456 23%,#E39A5E 30%,#E6D3B2 37%,#F6F1EA 44%,#F6F1EA 100%)',
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
      pillBg: 'rgba(255,255,255,.14)',
      pillBorder: 'rgba(255,255,255,.24)',
      pillText: '#F6ECE2',
      greetAccent: '#FFCF94',
      cardBg: 'rgba(255,255,255,.13)',
      cardBorder: 'rgba(255,255,255,.22)',
      // Warm sky, so the body text is tinted rather than pure grey — pure grey
      // reads as dirty against orange.
      onSkyTitle: '#FFF6EC',
      onSkyBody: 'rgba(255,244,232,.82)',
      onSkyLabel: 'rgba(255,236,220,.78)',
      onSkyShadow: '0 1px 8px rgba(60,26,10,.35)',
      panelBg: 'rgba(255,250,244,.86)',
      panelBorder: 'rgba(255,255,255,.7)',
    };
  }
  return {
    phase,
    greeting,
    gradient: 'linear-gradient(180deg,#141110 0%,#221B18 28%,#332621 44%,#4A3A31 54%,#6E5642 62%,#D3C1A6 74%,#EDE4D6 82%,#F3ECE0 100%)',
    flowGradient: 'linear-gradient(180deg,#141110 0%,#221B18 15%,#332621 25%,#4A3A31 33%,#C9B79C 40%,#EFE6DA 46%,#F6F1EA 100%)',
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
    cardBg: 'rgba(255,255,255,.13)',
    cardBorder: 'rgba(255,255,255,.22)',
    onSkyTitle: '#FFFFFF',
    onSkyBody: 'rgba(246,241,234,.80)',
    onSkyLabel: 'rgba(238,230,220,.76)',
    onSkyShadow: '0 1px 10px rgba(0,0,0,.45)',
    panelBg: 'rgba(252,248,242,.90)',
    panelBorder: 'rgba(255,255,255,.6)',
  };
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
