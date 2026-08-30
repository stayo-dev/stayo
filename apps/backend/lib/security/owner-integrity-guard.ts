/**
 * 🛡️ Owner Integrity Guard — Boot-time security assertion
 *
 * Validates the expected owner count in the database and logs warnings
 * if unexpected OWNER profiles are detected. This catches rogue accounts
 * created by the (now-fixed) Google OAuth auto-provisioning vulnerability.
 *
 * Called during application startup. Never blocks boot — only logs.
 *
 * Usage:
 *   await assertOwnerIntegrity();
 */

import { prisma } from "../db";
import { getLogger } from "../logger";

const logger = getLogger("security.owner-integrity");

/**
 * Known legitimate owner email(s).
 * Update this list when adding new owner accounts via bootstrap.
 */
const EXPECTED_OWNER_EMAILS: string[] = [
  "examplehostel@gmail.com",
];

/**
 * Maximum number of OWNER profiles expected in a single-owner system.
 * If the count exceeds this, a security warning is emitted.
 */
const MAX_EXPECTED_OWNERS = 2;

export async function assertOwnerIntegrity(): Promise<void> {
  try {
    const owners = await prisma.profile.findMany({
      where: { role: "OWNER" },
      select: {
        id: true,
        email: true,
        name: true,
        is_active: true,
        created_at: true,
        owner_id: true,
      },
      orderBy: { created_at: "asc" },
    });

    const ownerCount = owners.length;

    if (ownerCount === 0) {
      logger.warn("OWNER_INTEGRITY_CHECK: No OWNER profiles found. System may not be bootstrapped.");
      return;
    }

    if (ownerCount > MAX_EXPECTED_OWNERS) {
      const ownerSummary = owners.map((o) => ({
        id: o.id,
        email: o.email,
        name: o.name,
        is_active: o.is_active,
        created_at: o.created_at,
        self_owned: o.owner_id === o.id,
      }));

      logger.error("🔴 OWNER_INTEGRITY_VIOLATION: Unexpected number of OWNER profiles detected", {
        expected_max: MAX_EXPECTED_OWNERS,
        actual_count: ownerCount,
        owners: ownerSummary,
        action_required: "Audit these accounts — some may be rogue accounts from the Google OAuth auto-provisioning vulnerability.",
      });
    } else {
      logger.info("OWNER_INTEGRITY_CHECK: OK", {
        owner_count: ownerCount,
        owners: owners.map((o) => ({ id: o.id, email: o.email, is_active: o.is_active })),
      });
    }

    // Check for suspicious patterns: OWNER accounts with self-referential owner_id
    // that don't match known emails (possible auto-provisioned accounts)
    if (EXPECTED_OWNER_EMAILS.length > 0) {
      const unexpected = owners.filter(
        (o) => o.email && !EXPECTED_OWNER_EMAILS.includes(o.email.toLowerCase())
      );
      if (unexpected.length > 0) {
        logger.error("🔴 UNEXPECTED_OWNER_ACCOUNTS: Owner profiles exist for unknown emails", {
          unexpected_owners: unexpected.map((o) => ({
            id: o.id,
            email: o.email,
            is_active: o.is_active,
            created_at: o.created_at,
          })),
          action_required: "These may be rogue accounts. Disable or remove them.",
        });
      }
    }

    // Check for active owners that are self-owned (auto-provisioned pattern)
    const selfOwned = owners.filter((o) => o.owner_id === o.id && o.is_active);
    if (selfOwned.length > 1) {
      logger.warn("OWNER_INTEGRITY_WARNING: Multiple active self-owned OWNER profiles", {
        count: selfOwned.length,
        owners: selfOwned.map((o) => ({ id: o.id, email: o.email })),
      });
    }
  } catch (err: any) {
    // Never crash the application over a security check
    logger.error("OWNER_INTEGRITY_CHECK_FAILED: Could not verify owner integrity", {
      error: err?.message || String(err),
    });
  }
}
