import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLOW_GROUND, FLOW_INK, INTRO_CARD_INK, PANEL_INK, skyEnv, type ThemePhase } from './skyTheme';
import { contrast, hsl, parseColor, worstContrast, type Stop } from './skyContrast';

/**
 * Every piece of text the onboarding paints over the time-of-day sky, checked
 * against the rows of that sky it actually sits on, in every phase.
 *
 * WCAG AA: 4.5:1 for body text, 3:1 for large text (24px, or 18.66px bold).
 * The onboarding's labels run as small as 9.5px, so almost everything here
 * needs the full 4.5.
 */

const PHASES: ThemePhase[] = ['day', 'dusk', 'night'];
const AA = 4.5;
const AA_LARGE = 3;

/**
 * The splash's sky is sized to the splash, which is the viewport — so the
 * same text lands at a different gradient percentage on every phone. Check
 * the whole range a text row can occupy between the shortest and tallest
 * phones we support.
 */
const PHONE_HEIGHTS = { min: 640, max: 932 };
function introBand(topPx: number, bottomPx: number): [number, number] {
  return [(topPx / PHONE_HEIGHTS.max) * 100, (bottomPx / PHONE_HEIGHTS.min) * 100];
}

/**
 * The wizard's sky is sized to the header band only (see ActivationLayout),
 * whose height changes by one line when the link-expiry notice shows.
 */
const BAND_HEIGHTS = { min: 190, max: 245 };
function headerBand(topPx: number, bottomPx: number): [number, number] {
  return [(topPx / BAND_HEIGHTS.max) * 100, (bottomPx / BAND_HEIGHTS.min) * 100];
}

/** Vertical extents, in CSS px from the top, as laid out in ActivationIntroScreen / ActivationLayout. */
const INTRO_ROWS = {
  eyebrow: introBand(48, 64),
  title: introBand(128, 170),
  joining: introBand(165, 190),
  pill: introBand(188, 230),
  card: introBand(228, 375),
};
const FLOW_ROWS = {
  lockup: headerBand(44, 82),
  // From the panel's top edge to the band's bottom (the panel ends 8px above it).
  panel: [(88 / BAND_HEIGHTS.max) * 100, 100] as [number, number],
};

function stopsWith(stops: readonly Stop[]) {
  return (text: string, [from, to]: [number, number], surfaces: string[] = []) => worstContrast(text, stops, from, to, surfaces);
}

describe.each(PHASES)('%s sky — splash screen', (phase) => {
  const sky = skyEnv(12, phase);
  const on = stopsWith(sky.introStops);

  it('eyebrow reads over the top of the sky', () => {
    expect(on(sky.eyebrow, INTRO_ROWS.eyebrow)).toBeGreaterThanOrEqual(AA);
  });

  it('"Welcome to Stayo" reads as large text', () => {
    expect(on(sky.title, INTRO_ROWS.title)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('"You\'re joining …" reads over the sky', () => {
    expect(on(sky.pillText, INTRO_ROWS.joining)).toBeGreaterThanOrEqual(AA);
  });

  it('greeting pill text and accent read through the pill', () => {
    expect(on(sky.pillText, INTRO_ROWS.pill, [sky.pillBg])).toBeGreaterThanOrEqual(AA);
    expect(on(sky.greetAccent, INTRO_ROWS.pill, [sky.pillBg])).toBeGreaterThanOrEqual(AA);
  });

  it('every line on the room card reads through the glass', () => {
    for (const ink of Object.values(INTRO_CARD_INK)) {
      expect(on(ink, INTRO_ROWS.card, [sky.cardBg]), ink).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe.each(PHASES)('%s sky — wizard header', (phase) => {
  const sky = skyEnv(12, phase);
  const on = stopsWith(sky.bandStops);

  it('hostel name and "Tenant Admission" read over the header sky', () => {
    expect(on(sky.lockupTitle, FLOW_ROWS.lockup)).toBeGreaterThanOrEqual(AA);
    expect(on(sky.lockupEyebrow, FLOW_ROWS.lockup)).toBeGreaterThanOrEqual(AA);
  });

  it('every progress-panel label reads through the frosted panel', () => {
    for (const ink of Object.values(PANEL_INK)) {
      expect(on(ink, FLOW_ROWS.panel, [sky.panelBg]), ink).toBeGreaterThanOrEqual(AA);
    }
  });

  it('the header sky hands over to the step body without a seam', () => {
    const last = sky.bandStops[sky.bandStops.length - 1];
    expect(last[1]).toBe(100);
    expect(parseColor(last[0])).toEqual(parseColor(FLOW_GROUND));
  });
});

describe('wizard step body', () => {
  // The body renders on FLOW_GROUND at every hour, so one ink set serves all
  // three phases — which is exactly what makes it safe on a page of any length.
  it.each(Object.entries(FLOW_INK))('%s ink reads on the ground', (_name, ink) => {
    expect(contrast(parseColor(ink), parseColor(FLOW_GROUND))).toBeGreaterThanOrEqual(AA);
  });
});

describe('brand', () => {
  /**
   * Stayo's palette is warm (Warm Clay, Terra Cotta, Dusty Orange, Latte,
   * Charcoal, Cream — Stayo-Brand-Assetes/color/colors.txt). On 2026-09-10 the
   * whole onboarding was re-skinned blue in one commit and nothing noticed. A
   * saturated cool colour anywhere in these files is that happening again.
   *
   * Deliberately allowed: the pale daytime sky (#9DBAC6) and the moon's
   * grey-blue glow — both desaturated, both part of the scene rather than an
   * accent.
   */
  const ROOT = path.resolve(__dirname);
  const COLOUR = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;
  const COOL_CLASS = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration)-(?:blue|indigo|sky|violet|cyan|purple|info)(?:-\d{2,3})?\b/;

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sources(full);
      return /\.(tsx?|css)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [full] : [];
    });
  }

  it('no cool-hued accent colours anywhere in the onboarding', () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const where = `${path.relative(ROOT, file)}:${i + 1}`;
          if (COOL_CLASS.test(line)) offenders.push(`${where} ${line.trim()}`);
          for (const literal of line.match(COLOUR) ?? []) {
            let parsed;
            try {
              parsed = parseColor(literal);
            } catch {
              continue; // e.g. rgba(var(--x)) — not a literal colour
            }
            const { h, s, l } = hsl(parsed);
            if (h >= 180 && h <= 300 && s >= 0.35 && l >= 0.12 && l <= 0.88) offenders.push(`${where} ${literal}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
