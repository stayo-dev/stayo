/**
 * "Has the owner actually changed anything?" — the single answer every
 * configuration screen uses to decide whether a Save button exists.
 *
 * **Why.** Every config screen rendered a permanently visible Save bar, so the
 * owner could not tell an untouched screen from an edited one, and tapping Save
 * on a screen they had only read still issued a PATCH — writing a policy
 * version and an entry in the change log for a change that never happened.
 * Save now appears only once the form differs from what was loaded.
 *
 * The comparison is against a **baseline captured from the loaded policy**, not
 * a "touched" flag: typing 3 over a 3, or toggling something off and back on,
 * correctly leaves the screen clean.
 *
 * Pure, so screens stay thin renderers over a tested decision.
 */

/**
 * Deep structural equality, limited to the shapes form state actually holds:
 * primitives, plain objects, and arrays. Key order is irrelevant.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // NaN never equals itself, but two NaN fields mean "both blank", not a change.
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Whether `current` differs from the loaded `baseline`.
 *
 * A null baseline means the policy has not arrived yet — nothing has been
 * edited, so this is deliberately `false` rather than "everything changed".
 */
export function hasChanges<T>(baseline: T | null | undefined, current: T): boolean {
  if (baseline === null || baseline === undefined) return false;
  return !deepEqual(baseline, current);
}
