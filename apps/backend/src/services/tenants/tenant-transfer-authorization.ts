/**
 * Who may move a tenant between hostels.
 *
 * `tenantTransferService.transferTenant` validated that the target room and
 * the tenant belong to the same owner — and never that this owner is the
 * caller. Combined with a route gate that only asked whether the session had
 * the OWNER role, that let any authenticated owner transfer any *other*
 * owner's tenant between that owner's hostels, recording their own id in
 * `tenant_transfer_logs.transferred_by` — an audit trail built to answer "who
 * did this" naming the wrong person.
 *
 * Deliberately its own module with no imports: it is a security rule, it must
 * be unit-testable without a database, and the service it guards imports
 * Prisma (see `vitest.pure.config.ts`).
 */

/**
 * Throws unless `actorOwnerId` may act on a tenant owned by `tenantOwnerId`.
 *
 * `actorOwnerId` is the caller's resolved owner scope, or `undefined`/`null`
 * for a platform admin, who legitimately operates across owners. An **empty
 * string** is a failed scope resolution, not an admin, and is refused — the
 * alternative would turn a resolution bug into privilege escalation.
 */
export function assertTransferActorOwnsTenant(
  actorOwnerId: string | null | undefined,
  tenantOwnerId: string | null | undefined,
): void {
  if (actorOwnerId === undefined || actorOwnerId === null) return; // admin

  if (!actorOwnerId || !tenantOwnerId || actorOwnerId !== tenantOwnerId) {
    throw new Error("FORBIDDEN: This tenant belongs to a different owner");
  }
}
