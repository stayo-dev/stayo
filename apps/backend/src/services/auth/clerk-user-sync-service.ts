/**
 * Clerk → database user synchronisation (ADR-176).
 *
 * Turns the three Clerk user lifecycle events into writes on `users`, the
 * auth-agnostic identity anchor added by migration 081. The rules this service
 * exists to hold:
 *
 *   1. **Clerk owns identity; we own authorisation.** Nothing here ever writes a
 *      role, a tenancy, a hostel or money. `users` answers "who is this login?";
 *      `profiles` answers "what may they do?". A compromised or misconfigured
 *      webhook must not be able to grant anyone anything.
 *   2. **The webhook never provisions a business account, and never links by
 *      email.** It links a login to a `profiles` row only when the Clerk user
 *      carries `external_id` = that profile's id — a value only our backend
 *      sets (`credential-service.ensureLogin`). Anything else leaves
 *      `profile_id` null. Matching by email (ADR-176's first design) is gone:
 *      identity is never reconstructed from an address (ADR-204).
 *   3. **Deletion is deactivation.** `user.deleted` sets `is_active = false`; no
 *      path here deletes a row or touches the linked profile. Obligations,
 *      payments and receipts outlive the login that created them.
 *   4. **Deliveries are at-least-once and unordered.** Every handler is
 *      idempotent, and updates are rejected when Clerk's own `updated_at` is
 *      older than what we already stored.
 *
 * The pure half of this module (everything above `── database writes ──`) takes
 * plain arguments and touches nothing external, so the rules can be tested
 * without a database — see tests/clerk-user-sync.test.ts.
 */

import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import type { ClerkUserData, ClerkWebhookEvent } from "@/lib/auth/clerk-webhook-verification";

const logger = getLogger("webhook.clerk.sync");

/**
 * The complete set of columns a Clerk event is allowed to write.
 *
 * This is an allow-list, not a convenience: it is the mechanical reason a Clerk
 * payload cannot escalate anyone. `role`, `is_active`, `profile_id` and every
 * business column are absent by design — `is_active` moves only through
 * `handleUserDeleted`, never through a field sync.
 *
 * Mirrors the mirrored-field block of migration 081. tests/clerk-user-sync.test.ts
 * asserts the two stay in step.
 */
export const ALLOWED_PROFILE_FIELDS = ["email", "first_name", "last_name", "image_url"] as const;

export type AllowedProfileFields = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
};

/**
 * Clerk sends every address the account owns plus a pointer to the primary one.
 * Fall back to the first address only when the pointer is absent — picking an
 * arbitrary address when a primary is *declared but unmatched* would silently
 * bind the login to a secondary mailbox, which is how a profile match goes to
 * the wrong person.
 */
export function primaryEmail(data: ClerkUserData): string | null {
  const addresses = data.email_addresses ?? [];
  if (addresses.length === 0) return null;

  if (data.primary_email_address_id) {
    const primary = addresses.find((a) => a.id === data.primary_email_address_id);
    return primary ? normaliseEmail(primary.email_address) : null;
  }
  return normaliseEmail(addresses[0].email_address);
}

/** Emails are matched against `profiles.email`, which is stored lower-cased. */
function normaliseEmail(email: string | null | undefined): string | null {
  const trimmed = String(email ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Project a Clerk user object down to exactly the allow-listed columns. */
export function extractAllowedProfileFields(data: ClerkUserData): AllowedProfileFields {
  return {
    email: primaryEmail(data),
    first_name: emptyToNull(data.first_name),
    last_name: emptyToNull(data.last_name),
    image_url: emptyToNull(data.image_url),
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Clerk stamps `updated_at` as epoch milliseconds, not an ISO string. */
export function clerkUpdatedAt(data: ClerkUserData): Date | null {
  const raw = data.updated_at;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Should this delivery be ignored as stale?
 *
 * True only when we can prove it is older than what we hold. An unknown
 * timestamp on either side means "apply it" — refusing to write because Clerk
 * omitted a field would silently stop syncing, which is worse than applying a
 * possibly-redundant update to idempotent data.
 */
export function isStaleDelivery(stored: Date | null | undefined, incoming: Date | null): boolean {
  if (!stored || !incoming) return false;
  return incoming.getTime() < stored.getTime();
}

// ── database writes ─────────────────────────────────────────────────────────

export type SyncOutcome =
  | "created"
  | "updated"
  | "deactivated"
  | "ignored_stale"
  | "ignored_unhandled_type"
  | "already_deactivated";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find the `profiles` row this login belongs to — by the Clerk user's
 * `external_id`, which is our own profile id, set only by our backend.
 *
 * Returns null rather than creating anything — see rule 2 in the module header.
 */
export async function findLinkableProfileId(
  externalId: string | null | undefined,
  clerkUserId: string,
): Promise<string | null> {
  const id = String(externalId ?? "").trim();
  if (!UUID_RE.test(id)) return null;

  const profile = await prisma.profile.findUnique({
    where: { id },
    select: { id: true, login: { select: { clerk_user_id: true } } },
  });
  if (!profile) return null;

  // `profile_id` is unique, so a profile already bound to a different Clerk
  // account cannot be claimed by this one. Returning null leaves the new login
  // unlinked and logs it, rather than throwing a constraint error that Svix
  // would retry forever. Two logins for one business identity is a human
  // decision, not an overwrite.
  const boundTo = profile.login?.clerk_user_id;
  if (boundTo && boundTo !== clerkUserId) {
    logger.warn("clerk.profile_link.conflict", {
      clerk_user_id: clerkUserId,
      already_linked_to: boundTo,
    });
    return null;
  }

  return profile.id;
}

/**
 * `user.created` — upsert the login row.
 *
 * Upsert rather than create because Svix retries a delivery it did not see
 * acknowledged, and a retried `user.created` must not raise a unique-constraint
 * error on `clerk_user_id` and then be retried forever.
 */
export async function handleUserCreated(data: ClerkUserData): Promise<SyncOutcome> {
  const fields = extractAllowedProfileFields(data);
  const profileId = await findLinkableProfileId(data.external_id, data.id);
  const updatedAt = clerkUpdatedAt(data);

  await prisma.users.upsert({
    where: { clerk_user_id: data.id },
    create: {
      clerk_user_id: data.id,
      ...fields,
      // Null unless external_id names a profile not bound elsewhere — see
      // findLinkableProfileId.
      profile_id: profileId,
      clerk_updated_at: updatedAt,
    },
    update: {
      ...fields,
      clerk_updated_at: updatedAt,
      updated_at: new Date(),
    },
  });

  logger.info("clerk.user.created", {
    clerk_user_id: data.id,
    linked_profile: Boolean(profileId),
  });
  return "created";
}

/**
 * `user.updated` — sync the allow-listed fields onto an existing login.
 *
 * Upserts too: Clerk can legitimately deliver an update for an account whose
 * `user.created` we never saw (webhook configured after the account existed, or
 * a delivery dropped during an outage), and losing that person entirely is worse
 * than creating the row late.
 */
export async function handleUserUpdated(data: ClerkUserData): Promise<SyncOutcome> {
  const existing = await prisma.users.findUnique({
    where: { clerk_user_id: data.id },
    select: { id: true, clerk_updated_at: true, profile_id: true },
  });

  const incomingUpdatedAt = clerkUpdatedAt(data);
  if (existing && isStaleDelivery(existing.clerk_updated_at, incomingUpdatedAt)) {
    logger.info("clerk.user.updated.stale_ignored", { clerk_user_id: data.id });
    return "ignored_stale";
  }

  const fields = extractAllowedProfileFields(data);

  if (!existing) {
    const profileId = await findLinkableProfileId(data.external_id, data.id);
    await prisma.users.create({
      data: {
        clerk_user_id: data.id,
        ...fields,
        profile_id: profileId,
        clerk_updated_at: incomingUpdatedAt,
      },
    });
    logger.info("clerk.user.updated.created_late", { clerk_user_id: data.id });
    return "created";
  }

  // An unlinked login gains a link when its external_id is set later — the
  // operator-reviewed adoption in scripts/migrate-logins-to-clerk.ts. An
  // existing link is never re-pointed by a webhook.
  const lateLink = existing.profile_id ? null : await findLinkableProfileId(data.external_id, data.id);

  await prisma.users.update({
    where: { clerk_user_id: data.id },
    data: {
      ...fields,
      ...(lateLink ? { profile_id: lateLink } : {}),
      clerk_updated_at: incomingUpdatedAt,
      updated_at: new Date(),
    },
  });

  logger.info("clerk.user.updated", { clerk_user_id: data.id, linked_late: Boolean(lateLink) });
  return "updated";
}

/**
 * `user.deleted` — soft-deactivate.
 *
 * Never deletes, and never touches the linked profile. The `user.deleted`
 * payload is minimal (`{ id, deleted: true }`), so there is nothing to sync
 * here beyond the flag.
 *
 * An unknown `clerk_user_id` is not an error: Clerk may be deleting an account
 * that predates this webhook. Acknowledge it and move on rather than 500-ing
 * into a retry loop that can never succeed.
 */
export async function handleUserDeleted(data: ClerkUserData): Promise<SyncOutcome> {
  const existing = await prisma.users.findUnique({
    where: { clerk_user_id: data.id },
    select: { id: true, is_active: true },
  });

  if (!existing) {
    logger.info("clerk.user.deleted.unknown", { clerk_user_id: data.id });
    return "already_deactivated";
  }
  if (!existing.is_active) {
    return "already_deactivated";
  }

  await prisma.users.update({
    where: { clerk_user_id: data.id },
    data: {
      is_active: false,
      deactivated_at: new Date(),
      updated_at: new Date(),
    },
  });

  logger.info("clerk.user.deleted.deactivated", { clerk_user_id: data.id });
  return "deactivated";
}

/** Dispatch a verified event. Unhandled types are acknowledged, never rejected. */
export async function syncClerkUser(event: ClerkWebhookEvent): Promise<SyncOutcome> {
  switch (event.type) {
    case "user.created":
      return handleUserCreated(event.data);
    case "user.updated":
      return handleUserUpdated(event.data);
    case "user.deleted":
      return handleUserDeleted(event.data);
    default:
      return "ignored_unhandled_type";
  }
}

// ── the /me handshake ───────────────────────────────────────────────────────

/**
 * What `GET /me` tells the caller about themselves.
 *
 * `role` is *read* from the linked profile and never written here. That is the
 * whole point of the split: Clerk says who you are, our database says what you
 * may do (ADR-176). A snapshot with `role: null` is a normal, expected state —
 * a Clerk account we know about that has not been given a business identity.
 */
export interface ClerkIdentitySnapshot {
  /** Our `users.id`, not Clerk's. */
  userId: string;
  clerkUserId: string;
  isActive: boolean;
  profileId: string | null;
  profileLinked: boolean;
  /** From the linked `profiles` row; null when unlinked. Never assigned here. */
  role: string | null;
  /** True only when this call created the row. Second call for the same id: false. */
  created: boolean;
}

const IDENTITY_SELECT = {
  id: true,
  clerk_user_id: true,
  is_active: true,
  profile_id: true,
  profile: { select: { role: true } },
} as const;

type IdentityRow = {
  id: string;
  clerk_user_id: string;
  is_active: boolean;
  profile_id: string | null;
  profile: { role: string } | null;
};

function toSnapshot(row: IdentityRow, created: boolean): ClerkIdentitySnapshot {
  return {
    userId: row.id,
    clerkUserId: row.clerk_user_id,
    isActive: row.is_active,
    profileId: row.profile_id ?? null,
    profileLinked: Boolean(row.profile_id),
    role: row.profile?.role ?? null,
    created,
  };
}

/**
 * Idempotently resolve a verified Clerk session to a `users` row (the
 * `GET /me` handshake, outside /api).
 *
 * Read-then-create, with the unique index on `clerk_user_id` as the actual
 * guarantee rather than the read: two racing requests both miss the read, one
 * insert wins, the other gets P2002 and re-reads.
 *
 * It never creates a `profiles` row and never links one. A row created here
 * is an unlinked identity; linking happens only by id, through the webhook's
 * `external_id` or our own provisioning (ADR-204). The `email` it may carry
 * is stored as a mirrored display field, nothing more.
 */
export async function ensureUserForClerkSession(identity: {
  clerkUserId: string;
  email?: string;
}): Promise<ClerkIdentitySnapshot> {
  const existing = (await prisma.users.findUnique({
    where: { clerk_user_id: identity.clerkUserId },
    select: IDENTITY_SELECT,
  })) as IdentityRow | null;

  if (existing) return toSnapshot(existing, false);

  const email = identity.email ? identity.email.trim().toLowerCase() : null;

  try {
    const created = (await prisma.users.create({
      data: {
        clerk_user_id: identity.clerkUserId,
        email,
        profile_id: null,
      },
      select: IDENTITY_SELECT,
    })) as IdentityRow;

    logger.info("clerk.me.user_created", { clerk_user_id: identity.clerkUserId });
    return toSnapshot(created, true);
  } catch (error) {
    // P2002 = unique constraint. Another request won the race; its row is the
    // one true row, so read it back rather than surfacing an error.
    if ((error as { code?: string })?.code !== "P2002") throw error;

    const raced = (await prisma.users.findUnique({
      where: { clerk_user_id: identity.clerkUserId },
      select: IDENTITY_SELECT,
    })) as IdentityRow | null;

    if (!raced) throw error;

    logger.info("clerk.me.create_raced", { clerk_user_id: identity.clerkUserId });
    return toSnapshot(raced, false);
  }
}
