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

/**
 * The profile id to record against a write — `submitted_by`, and anything
 * like it.
 *
 * These call sites take `string | MarketingActor` so an admin can act on an
 * owner's behalf, and one of them wrote the **whole actor object** into a
 * `submitted_by` column, breaking every submission with a Prisma validation
 * error. TypeScript did not catch it: `lib/db.ts` exports the client as
 * `any`, so no Prisma call in this codebase is type-checked. Resolving the id
 * through one named function is the guard that replaces the type check.
 */
export function actorId(actor: string | MarketingActor): string {
  return typeof actor === "string" ? actor : actor.id;
}

export function marketingScopeWhere(actor: MarketingActor, hostelId: string) {
  if (actor.isAdmin) return { id: hostelId };
  return { id: hostelId, owner_id: actor.id };
}
