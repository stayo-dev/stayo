/**
 * The detail drawer's identity lives in the URL (`?detail=kyc:<uuid>`) rather
 * than in component state, so a drawer can be linked to a colleague and
 * survives a refresh mid-review.
 *
 * An unknown or malformed value resolves to null: opening an empty drawer
 * would read as a loading state that never finishes.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */
export type DrawerKind = 'lead' | 'owner' | 'kyc' | 'listing' | 'client' | 'settlement';

export type DrawerTarget = { kind: DrawerKind; id: string };

const KINDS: readonly DrawerKind[] = ['lead', 'owner', 'kyc', 'listing', 'client', 'settlement'];

export function parseDetailParam(raw: string | null): DrawerTarget | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length !== 2) return null;
  const [kind, id] = parts;
  if (!id || !KINDS.includes(kind as DrawerKind)) return null;
  return { kind: kind as DrawerKind, id };
}

export function serializeDetail(target: DrawerTarget): string {
  return `${target.kind}:${target.id}`;
}
