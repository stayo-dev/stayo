import type { OnboardingScreen } from './hooks/useOwnerOnboardingState';

/**
 * The floors, rooms and beds steps each have an optional "Generate" button.
 * Nothing checked whether it had been pressed, so an owner could walk through
 * all three and finish onboarding having laid out nothing — with no indication
 * anything was missed. Reported as a blind spot, and it is one.
 *
 * Generating stays optional (a hostel can be laid out later from the
 * dashboard), so this asks rather than blocks.
 *
 * Pure: the decision and its copy live here so they are testable in the
 * node-only environment, and so all three steps behave identically.
 */

export type GenerationFlags = {
  floorsGen: boolean;
  roomsGen: boolean;
  bedsGen: boolean;
};

export type GenerationPrompt = {
  title: string;
  body: string;
  /** Stay on the step and lay it out now. */
  confirmLabel: string;
  /** Move on without generating. */
  skipLabel: string;
};

const PROMPTS: Partial<Record<OnboardingScreen, GenerationPrompt>> = {
  floors: {
    title: 'Set up your floors now?',
    body: "You haven't generated the floor list yet. You can lay it out now, or skip and do it later from your dashboard.",
    confirmLabel: 'Set them up',
    skipLabel: 'Skip for now',
  },
  rooms: {
    title: 'Set up your rooms now?',
    body: "You haven't generated the rooms yet. You can lay them out now, or skip and add them later from your dashboard.",
    confirmLabel: 'Set them up',
    skipLabel: 'Skip for now',
  },
  beds: {
    title: 'Set up your beds now?',
    body: "You haven't generated the beds yet. You can lay them out now, or skip and add them later from your dashboard.",
    confirmLabel: 'Set them up',
    skipLabel: 'Skip for now',
  },
};

/** Which generation flag belongs to which step. */
function flagFor(screen: OnboardingScreen, flags: GenerationFlags): boolean | null {
  switch (screen) {
    case 'floors':
      return flags.floorsGen;
    case 'rooms':
      return flags.roomsGen;
    case 'beds':
      return flags.bedsGen;
    default:
      return null;
  }
}

/**
 * The prompt to show before leaving this step, or null to continue straight
 * through. Returns null once the step has been generated, and for every step
 * that has no Generate button.
 */
export function generationPromptFor(
  screen: OnboardingScreen,
  flags: GenerationFlags,
): GenerationPrompt | null {
  const generated = flagFor(screen, flags);
  if (generated === null || generated) return null;
  return PROMPTS[screen] ?? null;
}

export function needsGenerationConfirm(screen: OnboardingScreen, flags: GenerationFlags): boolean {
  return generationPromptFor(screen, flags) !== null;
}
