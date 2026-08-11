import type { HostelSceneState } from '@shared/ui/brand';
import { MAX_DRAWN_FLOORS } from '@shared/ui/brand';
import type { BuilderStage } from './useHostelBuilder';

/**
 * Maps the builder onto the illustrated scene behind it.
 *
 * The point is that the drawing tracks what the owner is actually doing: a
 * storey appears the moment they raise the floor count, windows are cut into
 * the walls as rooms appear on the floor being filled, and those windows
 * light up with beds inside once the rooms have been given a sharing size and
 * rent. Same artwork as onboarding — the building is just raised here, where
 * the owner decides its shape, instead of during signup.
 */
export function builderSceneState(input: {
  stage: BuilderStage;
  hostelName: string;
  /** Floors the owner has committed to (drives the building's height). */
  floorCount: number;
  /** Rooms on the floor currently being filled (drives window density). */
  activeRoomCount: number;
  /** The active floor's rooms all have a sharing size and rent. */
  activeFloorFurnished: boolean;
  /** Every floor has its rooms. */
  isComplete: boolean;
}): HostelSceneState {
  const { stage, hostelName, floorCount, activeRoomCount, activeFloorFurnished, isComplete } = input;

  const named = Boolean(hostelName.trim());
  const raising = stage === 'floors';
  const filling = stage === 'fill';
  const reviewing = stage === 'review';

  return {
    hostelName: hostelName.trim() || 'Your hostel',
    // The owner is already on their plot in this flow — they are not being
    // introduced, they are building.
    approach: 2,
    sceneStarted: true,
    ownerVerified: true,
    showSign: named,
    showSite: true,
    // The pin belongs to choosing a location, which this flow does not do.
    showPin: false,
    floorsBuilt: Math.min(MAX_DRAWN_FLOORS, Math.max(0, floorCount)),
    // Scaffolding stays up until the last floor is furnished.
    underConstruction: (raising || filling) && !isComplete,
    showRoof: floorCount > 0 && !raising,
    roomsPerFloor: activeRoomCount,
    showWindows: filling ? activeRoomCount > 0 : reviewing,
    litWindows: filling ? activeRoomCount > 0 && activeFloorFurnished : reviewing,
    showChimney: reviewing || isComplete,
    showBadge: isComplete,
    celebrate: reviewing && isComplete,
    ownerWaving: reviewing && isComplete,
  };
}
