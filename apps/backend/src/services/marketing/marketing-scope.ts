/**
 * Who may edit a hostel's marketing page.
 *
 * Owners are scoped to hostels they own — that scoping is what stops a
 * multi-hostel owner editing somebody else's listing by guessing an id, and it
 * must never be relaxed.
 *
 * Admins are deliberately unscoped. Stayo's team writes listings on an owner's
 * behalf (with permission, having gone out to photograph the property), so the
 * editor has to open for hostels the admin does not own — both Stayo-listed
 * shells and hostels a real owner already runs.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type MarketingActor = { id: string; isAdmin?: boolean };

export function marketingScopeWhere(actor: MarketingActor, hostelId: string) {
  if (actor.isAdmin) return { id: hostelId };
  return { id: hostelId, owner_id: actor.id };
}
