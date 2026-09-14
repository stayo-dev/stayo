import { describe, it, expect } from "vitest";
import {
  DOG_COLORS,
  DOG_CONCERNED,
  DOG_HAPPY,
  stayoMark,
} from "@/app/api/payments/pay/[token]/brand";

/**
 * The payment page is served as one self-contained HTML response, so its brand
 * art is a hand-maintained copy of the SPA's. These assertions cover the things
 * a copy can get wrong on its own — malformed SVG, a pose that lost its
 * expression, art that is announced to a screen reader — not drift against the
 * SPA, which no pure test can see.
 */

const balanced = (svg: string) => {
  const open = (svg.match(/<svg\b/g) || []).length;
  const close = (svg.match(/<\/svg>/g) || []).length;
  return open === close && open === 1;
};

describe("the Stayo mark on the payment page", () => {
  it("scales to the brand vector's aspect ratio", () => {
    const svg = stayoMark(15);
    expect(svg).toContain('viewBox="0 0 539 727"');
    expect(svg).toContain('width="15"');
    // 15 × 727 / 539 ≈ 20
    expect(svg).toContain('height="20"');
    expect(balanced(svg)).toBe(true);
  });

  it("inherits its colour rather than hard-coding one", () => {
    expect(stayoMark(20)).toContain('fill="currentColor"');
  });

  it("carries the four window panes the mark is built around", () => {
    expect((stayoMark(20).match(/<rect /g) || []).length).toBe(4);
  });

  it("is decorative, never announced", () => {
    expect(stayoMark(20)).toContain('aria-hidden="true"');
  });
});

describe("the Stayo dog on the payment page", () => {
  const poses: Array<[string, string]> = [
    ["happy", DOG_HAPPY],
    ["concerned", DOG_CONCERNED],
  ];

  it.each(poses)("%s is well-formed SVG", (_name, svg) => {
    expect(balanced(svg)).toBe(true);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  /** ADR-191: decorative by contract — aria-hidden, no tab stop, no text. */
  it.each(poses)("%s is decorative by contract", (_name, svg) => {
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).not.toContain("<text");
  });

  it.each(poses)("%s is drawn in the mascot palette", (_name, svg) => {
    expect(svg).toContain(DOG_COLORS.clay);
    expect(svg).toContain(DOG_COLORS.terra);
    expect(svg).toContain(DOG_COLORS.latte);
  });

  /**
   * The forearms are drawn at the origin in `dogParts.tsx` and only land once
   * the rig transforms them. A static copy that included them would render two
   * limbs stranded in the corner, so their absence is the assertion.
   */
  it.each(poses)("%s omits the rig-positioned forearms", (_name, svg) => {
    expect(svg).not.toContain("M-12 80 L-12 -20");
  });

  it("reads as happy: creased eyes, open mouth with tongue, sparkles", () => {
    expect(DOG_HAPPY).toContain(DOG_COLORS.tongue);
    expect(DOG_HAPPY).toContain(DOG_COLORS.dusty); // the sparkles
    // Creased eyes are arcs, not pupils.
    expect(DOG_HAPPY).not.toContain('<circle cx="130" cy="112"');
  });

  it("reads as concerned: open eyes, angled brows, no celebration", () => {
    expect(DOG_CONCERNED).toContain('<circle cx="130" cy="112"');
    expect(DOG_CONCERNED).not.toContain(DOG_COLORS.tongue);
    expect(DOG_CONCERNED).not.toContain(DOG_COLORS.dusty); // no sparkles
  });

  it("gives the two poses genuinely different tails", () => {
    const tail = (svg: string) => svg.slice(svg.indexOf("<path"), svg.indexOf("<path") + 60);
    expect(tail(DOG_HAPPY)).not.toBe(tail(DOG_CONCERNED));
  });
});
