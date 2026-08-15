import type { HostelSceneState } from '@shared/ui/brand';
import type { OnboardingScreen } from '../hooks/useOwnerOnboardingState';

/**
 * Maps an onboarding step onto the illustrated scene.
 *
 * The scene used to read the step index directly (`step >= 7` draws windows,
 * `step >= 8` lights them). Those thresholds now live here, in one readable
 * place, so the artwork itself is driven by hostel facts and can be reused by
 * the Add Hostel builder — see `@shared/ui/brand/HostelScene`.
 *
 * Onboarding no longer collects floors or rooms, so the building never rises
 * during signup: this stage of the story is the owner arriving, being
 * verified, and their hostel getting a name. The building is raised in the
 * builder, where the owner actually decides its shape.
 */
export function onboardingSceneState(
  step: number,
  screenId: OnboardingScreen,
  hostelName: string,
): HostelSceneState {
  return {
    hostelName,
    approach: step <= 1 ? 0 : step === 2 ? 1 : 2,
    sceneStarted: step >= 1,
    ownerVerified: step >= 2,
    showSign: Boolean(hostelName.trim()),
    showSite: step >= 3,
    showPin: step >= 3 && screenId !== 'success',
    floorsBuilt: 0,
    underConstruction: false,
    showRoof: false,
    roomsPerFloor: 0,
    showWindows: false,
    litWindows: false,
    showChimney: false,
    showBadge: screenId === 'success',
    celebrate: screenId === 'success',
    ownerWaving: screenId === 'success',
  };
}
