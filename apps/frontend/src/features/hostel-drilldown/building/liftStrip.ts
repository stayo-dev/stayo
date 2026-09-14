/**
 * The lift strip — the row of floor buttons that sticks above a tall building.
 *
 * A floor with many rooms wraps onto more rows rather than shrinking faces,
 * so a big hostel's building is taller than a phone. The strip keeps the
 * whole-building summary in view (free beds and a dues dot per floor), lights
 * the floor being looked at, and jumps to any other in one tap.
 *
 * PURE — runs under vitest's node environment.
 */

/** Below three floors the whole building fits on screen and the strip is noise. */
export function showLiftStrip(floorCount: number): boolean {
  return floorCount >= 3;
}

/**
 * The floor being looked at: the last one (top to bottom) whose top edge has
 * reached `line` — the bottom of the sticky strip, in viewport pixels. Before
 * any has, the top floor.
 */
export function activeFloorId(bands: { id: string; top: number }[], line: number): string | null {
  if (bands.length === 0) return null;
  let active = bands[0]!.id;
  for (const band of bands) {
    if (band.top <= line) active = band.id;
    else break;
  }
  return active;
}
