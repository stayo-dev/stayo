import type { BuilderStage } from './useHostelBuilder';
import { agreementStepBlocker, type AgreementChoice } from './agreementSetup';

/**
 * Where the owner is in the build, and how much is left.
 *
 * The header used to say "Step 3 of 4 · Rooms 2/3", which is two counters
 * disagreeing about what a step is: filling a five-floor building is five
 * screens, not a third of one. The bar below tracks the real work — the Rooms
 * phase fills floor by floor — while the label names the floor the owner is
 * actually standing on.
 *
 * Pure, because `apps/frontend` tests run without a DOM and a progress
 * indicator that lies is worse than none.
 */

export interface JourneyPosition {
  /** Short label for the header, e.g. "Ground floor · 1 of 3". */
  label: string;
  /** The phase name, e.g. "Rooms". */
  phase: string;
  /** 0–100. Monotonic: it never goes backwards while moving forwards. */
  percent: number;
}

const PHASES: Record<BuilderStage, string> = {
  name: 'Name',
  floors: 'Floors',
  fill: 'Rooms',
  review: 'Review',
  agreement: 'Agreement',
};

/** Where the Rooms phase starts and ends on the bar. */
const ROOMS_FROM = 30;
const ROOMS_TO = 90;

export function builderJourney(
  stage: BuilderStage,
  options: { activeIndex?: number; floorCount?: number } = {},
): JourneyPosition {
  const { activeIndex = 0, floorCount = 0 } = options;
  const phase = PHASES[stage];

  if (stage === 'name') {
    // Never zero: an empty bar reads as broken rather than as "not started".
    return { label: 'Name your hostel', phase, percent: 6 };
  }

  if (stage === 'floors') {
    return { label: 'How many floors', phase, percent: ROOMS_FROM };
  }

  if (stage === 'fill') {
    const total = Math.max(1, floorCount);
    const position = Math.min(Math.max(activeIndex, 0), total - 1);
    const done = position / total;
    return {
      // Deliberately does **not** name the floor. The floor strip highlights
      // it and the step's heading says it, and before this the screen told the
      // owner where they were five separate times — pushing the first control
      // to 42% down a phone. See ADR-108's strip.
      label: `${position + 1} of ${total}`,
      phase,
      percent: Math.round(ROOMS_FROM + (ROOMS_TO - ROOMS_FROM) * done),
    };
  }

  if (stage === 'review') {
    // Not the last screen any more — the agreement decision follows it — so
    // this no longer claims 100.
    return { label: 'Review', phase, percent: 96 };
  }

  return { label: 'Agreement', phase, percent: 100 };
}

/**
 * Why the primary button cannot be pressed, or null when it can.
 *
 * The button used to simply dim. The message written for the empty-name case
 * lived inside the click handler, which a disabled button never reaches — so
 * the owner got a grey button and no explanation at all. Saying it next to the
 * button costs nothing and removes the guessing.
 */
export function continueBlocker(
  stage: BuilderStage,
  state: {
    hostelName: string;
    hostelType?: string | null;
    floorBlocker: string | null;
    agreementChoice?: AgreementChoice;
    hasSignature?: boolean;
  },
): string | null {
  if (stage === 'name') {
    if (!state.hostelName.trim()) return 'Enter a name to continue';
    // Asked once, here, because it is the answer that decides whether every
    // future tenant of this hostel is asked their gender. Left unset it is
    // not a neutral default — it silently means "ask everyone, forever".
    if (!state.hostelType) return 'Choose who stays here to continue';
    return null;
  }
  if (stage === 'fill') return state.floorBlocker;
  if (stage === 'agreement') return agreementStepBlocker(state.agreementChoice ?? null, Boolean(state.hasSignature));
  return null;
}
