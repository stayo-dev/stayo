/**
 * Clerk → database user synchronisation (ADR-176).
 *
 * The rules under test are the ones that make a public, vendor-driven webhook
 * safe to expose: it cannot grant authority, cannot invent an account, cannot
 * destroy financial history, and cannot be confused by a retried or reordered
 * delivery.
 *
 * PURE — `@/lib/db` is mocked, so no client is constructed and nothing reaches a
 * database. Qualifies for vitest.pure.config.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// `vi.hoisted` lifts this above the imports below. `vi.mock` is hoisted too, and
// its factory runs while the module graph is being evaluated — so a plain
// `const` here would still be in its temporal dead zone by then.
const prisma = vi.hoisted(() => ({
  profile: { findUnique: vi.fn() },
  users: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), metrics: vi.fn() }),
}));

import {
  ALLOWED_PROFILE_FIELDS,
  primaryEmail,
  extractAllowedProfileFields,
  clerkUpdatedAt,
  isStaleDelivery,
  handleUserCreated,
  handleUserUpdated,
  handleUserDeleted,
  syncClerkUser,
} from "@/src/services/auth/clerk-user-sync-service";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(() => {
  vi.clearAllMocks();
  prisma.profile.findUnique.mockResolvedValue(null);
  prisma.users.findUnique.mockResolvedValue(null);
  prisma.users.upsert.mockResolvedValue({});
  prisma.users.create.mockResolvedValue({});
  prisma.users.update.mockResolvedValue({});
});

function clerkUser(overrides = {}) {
  return {
    id: "user_2abc",
    email_addresses: [
      { id: "idem_1", email_address: "Ada@Example.com" },
      { id: "idem_2", email_address: "spare@example.com" },
    ],
    primary_email_address_id: "idem_1",
    first_name: "Ada",
    last_name: "Lovelace",
    image_url: "https://img.clerk.com/ada",
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

// ── The allow-list is the escalation guard ──────────────────────────────────

describe("ALLOWED_PROFILE_FIELDS", () => {
  it("contains no authority-bearing or business column", () => {
    // If `role` or `is_active` ever appears here, a Clerk payload could make
    // its sender an OWNER, or silently reactivate a closed account.
    for (const forbidden of ["role", "is_active", "profile_id", "owner_id", "id"]) {
      expect(ALLOWED_PROFILE_FIELDS).not.toContain(forbidden);
    }
  });

  it("matches the mirrored-field block declared in migration 081", () => {
    const sql = fs.readFileSync(path.join(root, "../../migrations/081_clerk_users.sql"), "utf8");
    for (const field of ALLOWED_PROFILE_FIELDS) {
      expect(sql).toMatch(new RegExp(`^\\s+${field}\\s`, "m"));
    }
  });

  it("is exactly what extractAllowedProfileFields projects", () => {
    const projected = Object.keys(extractAllowedProfileFields(clerkUser()));
    expect(projected.sort()).toEqual([...ALLOWED_PROFILE_FIELDS].sort());
  });
});

// ── Reading the Clerk payload ───────────────────────────────────────────────

describe("primaryEmail", () => {
  it("picks the address the primary pointer names, not the first one", () => {
    expect(primaryEmail(clerkUser({ primary_email_address_id: "idem_2" }))).toBe(
      "spare@example.com",
    );
  });

  it("lower-cases, so it can match profiles.email", () => {
    expect(primaryEmail(clerkUser())).toBe("ada@example.com");
  });

  it("returns null when a primary is declared but not present", () => {
    // Guessing here would bind the login to an arbitrary secondary mailbox and
    // could match the wrong person's profile.
    expect(primaryEmail(clerkUser({ primary_email_address_id: "idem_missing" }))).toBeNull();
  });

  it("falls back to the only address when no primary is declared", () => {
    const user = clerkUser({
      primary_email_address_id: null,
      email_addresses: [{ id: "idem_1", email_address: "solo@example.com" }],
    });
    expect(primaryEmail(user)).toBe("solo@example.com");
  });

  it("returns null for an account with no email at all", () => {
    expect(primaryEmail(clerkUser({ email_addresses: [] }))).toBeNull();
  });
});

describe("clerkUpdatedAt", () => {
  it("reads Clerk's epoch milliseconds", () => {
    expect(clerkUpdatedAt(clerkUser())?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns null when absent or unusable", () => {
    expect(clerkUpdatedAt(clerkUser({ updated_at: null }))).toBeNull();
    expect(clerkUpdatedAt(clerkUser({ updated_at: "2023-01-01" as never }))).toBeNull();
    expect(clerkUpdatedAt(clerkUser({ updated_at: NaN }))).toBeNull();
  });
});

describe("isStaleDelivery", () => {
  const stored = new Date("2026-01-02T00:00:00Z");

  it("ignores a delivery older than what we hold", () => {
    expect(isStaleDelivery(stored, new Date("2026-01-01T00:00:00Z"))).toBe(true);
  });

  it("applies a newer one", () => {
    expect(isStaleDelivery(stored, new Date("2026-01-03T00:00:00Z"))).toBe(false);
  });

  it("applies an identical one — redundant beats dropped, the writes are idempotent", () => {
    expect(isStaleDelivery(stored, new Date("2026-01-02T00:00:00Z"))).toBe(false);
  });

  it("applies when either side is unknown, rather than silently halting sync", () => {
    expect(isStaleDelivery(null, new Date())).toBe(false);
    expect(isStaleDelivery(stored, null)).toBe(false);
  });
});

// ── user.created ────────────────────────────────────────────────────────────

describe("handleUserCreated", () => {
  it("creates the login row keyed by clerk_user_id", async () => {
    await handleUserCreated(clerkUser());

    const arg = prisma.users.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ clerk_user_id: "user_2abc" });
    expect(arg.create).toMatchObject({
      clerk_user_id: "user_2abc",
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    });
  });

  it("upserts, so a Svix retry does not fail on the unique constraint forever", async () => {
    await handleUserCreated(clerkUser());
    expect(prisma.users.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it("links to an existing profile matched by email", async () => {
    prisma.profile.findUnique.mockResolvedValue({ id: "profile-1", login: null });

    await handleUserCreated(clerkUser());

    expect(prisma.profile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "ada@example.com" } }),
    );
    expect(prisma.users.upsert.mock.calls[0][0].create.profile_id).toBe("profile-1");
  });

  it("never creates a profile when none matches — no auto-provisioning", async () => {
    prisma.profile.findUnique.mockResolvedValue(null);

    await handleUserCreated(clerkUser());

    expect(prisma.users.upsert.mock.calls[0][0].create.profile_id).toBeNull();
  });

  it("refuses to steal a profile already bound to another Clerk account", async () => {
    // profile_id is unique; claiming it would throw and Svix would retry forever.
    prisma.profile.findUnique.mockResolvedValue({
      id: "profile-1",
      login: { clerk_user_id: "user_someone_else" },
    });

    await handleUserCreated(clerkUser());

    expect(prisma.users.upsert.mock.calls[0][0].create.profile_id).toBeNull();
  });

  it("re-links the same account to its own profile without treating it as a conflict", async () => {
    prisma.profile.findUnique.mockResolvedValue({
      id: "profile-1",
      login: { clerk_user_id: "user_2abc" },
    });

    await handleUserCreated(clerkUser());

    expect(prisma.users.upsert.mock.calls[0][0].create.profile_id).toBe("profile-1");
  });

  it("does not look up a profile for an account with no email", async () => {
    await handleUserCreated(clerkUser({ email_addresses: [] }));
    expect(prisma.profile.findUnique).not.toHaveBeenCalled();
  });

  it("writes no field outside the allow-list", async () => {
    await handleUserCreated(clerkUser({ role: "OWNER", is_active: false } as never));

    const created = prisma.users.upsert.mock.calls[0][0].create;
    expect(created).not.toHaveProperty("role");
    expect(created).not.toHaveProperty("is_active");
  });
});

// ── user.updated ────────────────────────────────────────────────────────────

describe("handleUserUpdated", () => {
  it("syncs the allow-listed fields onto an existing login", async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: "u1",
      clerk_updated_at: new Date("2020-01-01T00:00:00Z"),
      profile_id: "profile-1",
    });

    const outcome = await handleUserUpdated(clerkUser({ first_name: "Augusta" }));

    expect(outcome).toBe("updated");
    expect(prisma.users.update.mock.calls[0][0].data).toMatchObject({ first_name: "Augusta" });
  });

  it("cannot change role, is_active or the profile link", async () => {
    prisma.users.findUnique.mockResolvedValue({ id: "u1", clerk_updated_at: null, profile_id: "p1" });

    await handleUserUpdated(clerkUser({ role: "OWNER", is_active: false } as never));

    const data = prisma.users.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("role");
    expect(data).not.toHaveProperty("is_active");
    expect(data).not.toHaveProperty("profile_id");
  });

  it("ignores a delivery that arrived out of order", async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: "u1",
      clerk_updated_at: new Date("2026-01-05T00:00:00Z"),
      profile_id: null,
    });

    const outcome = await handleUserUpdated(clerkUser({ updated_at: Date.parse("2026-01-01") }));

    expect(outcome).toBe("ignored_stale");
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it("creates the row when the original user.created was never delivered", async () => {
    prisma.users.findUnique.mockResolvedValue(null);

    const outcome = await handleUserUpdated(clerkUser());

    expect(outcome).toBe("created");
    expect(prisma.users.create).toHaveBeenCalledTimes(1);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
});

// ── user.deleted ────────────────────────────────────────────────────────────

describe("handleUserDeleted", () => {
  it("deactivates instead of deleting", async () => {
    prisma.users.findUnique.mockResolvedValue({ id: "u1", is_active: true });

    const outcome = await handleUserDeleted({ id: "user_2abc", deleted: true });

    expect(outcome).toBe("deactivated");
    expect(prisma.users.delete).not.toHaveBeenCalled();
    expect(prisma.users.update.mock.calls[0][0].data).toMatchObject({ is_active: false });
    expect(prisma.users.update.mock.calls[0][0].data.deactivated_at).toBeInstanceOf(Date);
  });

  it("leaves the linked profile and its business data untouched", async () => {
    prisma.users.findUnique.mockResolvedValue({ id: "u1", is_active: true });

    await handleUserDeleted({ id: "user_2abc", deleted: true });

    // Obligations, payments and receipts outlive the login that created them.
    expect(prisma.profile.findUnique).not.toHaveBeenCalled();
    expect(prisma.users.update.mock.calls[0][0].data).not.toHaveProperty("profile_id");
  });

  it("is idempotent — a redelivered delete does not rewrite deactivated_at", async () => {
    prisma.users.findUnique.mockResolvedValue({ id: "u1", is_active: false });

    const outcome = await handleUserDeleted({ id: "user_2abc", deleted: true });

    expect(outcome).toBe("already_deactivated");
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it("acknowledges a delete for an account we never saw", async () => {
    prisma.users.findUnique.mockResolvedValue(null);

    // Returning an error here would put Svix into a retry loop that can never
    // succeed, because the row is never going to appear.
    await expect(handleUserDeleted({ id: "user_unknown" })).resolves.toBe("already_deactivated");
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
});

// ── dispatch ────────────────────────────────────────────────────────────────

describe("syncClerkUser", () => {
  it("routes each handled event to its handler", async () => {
    prisma.users.findUnique.mockResolvedValue({ id: "u1", is_active: true, clerk_updated_at: null });

    expect(await syncClerkUser({ type: "user.created", object: "event", data: clerkUser() })).toBe("created");
    expect(await syncClerkUser({ type: "user.updated", object: "event", data: clerkUser() })).toBe("updated");
    expect(await syncClerkUser({ type: "user.deleted", object: "event", data: { id: "user_2abc" } })).toBe("deactivated");
  });

  it("ignores an unhandled type without writing anything", async () => {
    const outcome = await syncClerkUser({
      type: "session.created",
      object: "event",
      data: { id: "user_2abc" },
    });

    expect(outcome).toBe("ignored_unhandled_type");
    expect(prisma.users.upsert).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
  });
});
