import { describe, it, expect } from 'vitest';
import { builderSceneState } from './builderScene';

const base = {
  stage: 'floors' as const,
  hostelName: 'Sunrise Residency',
  floorCount: 0,
  activeRoomCount: 0,
  activeFloorFurnished: false,
  isComplete: false,
};

describe('builderSceneState', () => {
  it('raises a storey for every floor the owner adds', () => {
    expect(builderSceneState({ ...base, floorCount: 0 }).floorsBuilt).toBe(0);
    expect(builderSceneState({ ...base, floorCount: 3 }).floorsBuilt).toBe(3);
  });

  it('stops drawing storeys once the building would leave the frame', () => {
    expect(builderSceneState({ ...base, floorCount: 40 }).floorsBuilt).toBe(6);
  });

  it('holds the roof back while floors are still being raised', () => {
    expect(builderSceneState({ ...base, stage: 'floors', floorCount: 3 }).showRoof).toBe(false);
    expect(builderSceneState({ ...base, stage: 'fill', floorCount: 3 }).showRoof).toBe(true);
  });

  it('cuts windows into the walls as rooms appear on the floor being filled', () => {
    const empty = builderSceneState({ ...base, stage: 'fill', floorCount: 2, activeRoomCount: 0 });
    const withRooms = builderSceneState({ ...base, stage: 'fill', floorCount: 2, activeRoomCount: 4 });

    expect(empty.showWindows).toBe(false);
    expect(withRooms.showWindows).toBe(true);
    expect(withRooms.roomsPerFloor).toBe(4);
  });

  it('lights the windows only once the rooms are actually configured', () => {
    const bare = builderSceneState({ ...base, stage: 'fill', floorCount: 2, activeRoomCount: 4 });
    const furnished = builderSceneState({
      ...base,
      stage: 'fill',
      floorCount: 2,
      activeRoomCount: 4,
      activeFloorFurnished: true,
    });

    expect(bare.litWindows).toBe(false);
    expect(furnished.litWindows).toBe(true);
  });

  it('keeps the scaffolding up until the building is finished', () => {
    expect(builderSceneState({ ...base, stage: 'fill', floorCount: 2 }).underConstruction).toBe(true);
    expect(
      builderSceneState({ ...base, stage: 'review', floorCount: 2, isComplete: true }).underConstruction,
    ).toBe(false);
  });

  it('celebrates only when every floor is done', () => {
    const partial = builderSceneState({ ...base, stage: 'review', floorCount: 3, isComplete: false });
    const done = builderSceneState({ ...base, stage: 'review', floorCount: 3, isComplete: true });

    expect(partial.celebrate).toBe(false);
    expect(partial.showBadge).toBe(false);
    expect(done.celebrate).toBe(true);
    expect(done.showBadge).toBe(true);
    expect(done.ownerWaving).toBe(true);
  });

  it('shows the signboard as soon as the hostel has a name', () => {
    expect(builderSceneState({ ...base, stage: 'name', hostelName: '' }).showSign).toBe(false);
    expect(builderSceneState({ ...base, stage: 'name', hostelName: 'Sunrise' }).showSign).toBe(true);
  });

  it('falls back to a placeholder on the sign rather than rendering it blank', () => {
    expect(builderSceneState({ ...base, hostelName: '   ' }).hostelName).toBe('Your hostel');
  });

  it('never drops the location pin — this flow is not about choosing a site', () => {
    expect(builderSceneState({ ...base }).showPin).toBe(false);
  });
});
