/**
 * Backfill `profile_identity` from existing tenancies (phase B).
 *
 * Identity used to live on `tenants`, which since migration 062 is one row per
 * tenancy per hostel. A person who has stayed in two hostels therefore has two
 * sets of values, and they can disagree — a `college_name` from 2024 and a
 * different one from 2026 are both true, at different times.
 *
 * **There is no universally correct winner**, which is exactly why this is a
 * script with a dry run and not an `UPDATE` inside migration 064.
 *
 * Precedence, per field:
 *   1. a value already in `profile_identity` — never overwritten
 *   2. the person's live tenancy (INVITED/ACTIVE), if any
 *   3. their most recently created tenancy
 *   ...skipping nulls at each step, so a populated older value beats a newer
 *   blank rather than being erased by it.
 *
 * That precedence is deliberately identical to `selectFallbackTenancy()` in
 * profile-identity-service.ts, so a read taken *before* this script runs and a
 * read taken *after* it agree on which value wins.
 *
 * Nothing is destroyed: `tenants` keeps every column (see the phase B spec,
 * §3), so a discarded value stays inspectable on the row it came from.
 *
 *   npm run backfill:profile-identity            # dry run, reports only
 *   npm run backfill:profile-identity -- --apply # writes
 */
import { prisma } from "../lib/db";
import { IDENTITY_FIELDS } from "../src/services/profile/profile-identity-service";

const APPLY = process.argv.includes("--apply");

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

interface Conflict {
  profileId: string;
  field: string;
  chosen: unknown;
  chosenFrom: string;
  discarded: { value: unknown; tenancyId: string }[];
}

async function main() {
  console.log(`\nBackfilling profile_identity — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

  // Only people who actually have a tenancy have anything to backfill from.
  const profiles = await prisma.profile.findMany({
    where: { role: "TENANT", tenants: { some: {} } },
    select: {
      id: true,
      name: true,
      identity: { select: { id: true } },
      tenants: {
        select: Object.fromEntries([
          ["id", true],
          ["status", true],
          ["created_at", true],
          ...IDENTITY_FIELDS.map((field) => [field, true]),
        ]) as any,
        orderBy: { created_at: "desc" },
      },
    },
  });

  console.log(`Found ${profiles.length} tenant profiles with at least one tenancy.\n`);

  const conflicts: Conflict[] = [];
  let wouldCreate = 0;
  let wouldUpdate = 0;
  let unchanged = 0;

  for (const profile of profiles as any[]) {
    const tenancies = profile.tenants as any[];

    // Same precedence as selectFallbackTenancy(): live first, else newest.
    // Written explicitly rather than sorting on `status`, because TenantStatus
    // declares INVITED before ACTIVE — an enum sort would prefer a tenancy the
    // person never activated.
    const live = tenancies.find((t) => t.status === "ACTIVE" || t.status === "INVITED");
    const preferred = live ?? tenancies[0];
    if (!preferred) continue;

    const existing = profile.identity
      ? await prisma.profile_identity.findUnique({ where: { profile_id: profile.id } })
      : null;

    const patch: Record<string, unknown> = {};

    for (const field of IDENTITY_FIELDS) {
      // Never overwrite something the person has already stated themselves.
      if (existing && !isBlank((existing as any)[field])) continue;

      let chosen: unknown = null;
      let chosenFrom = "";
      if (!isBlank(preferred[field])) {
        chosen = preferred[field];
        chosenFrom = preferred.id;
      } else {
        const donor = tenancies.find((t) => !isBlank(t[field]));
        if (donor) {
          chosen = donor[field];
          chosenFrom = donor.id;
        }
      }
      if (isBlank(chosen)) continue;

      patch[field] = chosen;

      const disagreeing = tenancies
        .filter((t) => t.id !== chosenFrom && !isBlank(t[field]) && String(t[field]) !== String(chosen))
        .map((t) => ({ value: t[field], tenancyId: t.id }));

      if (disagreeing.length > 0) {
        conflicts.push({ profileId: profile.id, field, chosen, chosenFrom, discarded: disagreeing });
      }
    }

    if (Object.keys(patch).length === 0) {
      unchanged += 1;
      continue;
    }

    if (existing) wouldUpdate += 1;
    else wouldCreate += 1;

    if (APPLY) {
      await prisma.profile_identity.upsert({
        where: { profile_id: profile.id },
        create: { profile_id: profile.id, ...(patch as any) },
        update: { ...(patch as any), updated_at: new Date() },
      });
    }
  }

  console.log(`  create : ${wouldCreate}`);
  console.log(`  update : ${wouldUpdate}`);
  console.log(`  no-op  : ${unchanged}`);

  if (conflicts.length > 0) {
    console.log(`\n${conflicts.length} field(s) had disagreeing values across tenancies.`);
    console.log(`The chosen value follows the precedence above; the discarded ones remain on their`);
    console.log(`tenants rows and are not deleted.\n`);
    for (const conflict of conflicts.slice(0, 50)) {
      console.log(`  profile=${conflict.profileId} field=${conflict.field}`);
      console.log(`    chose    ${JSON.stringify(conflict.chosen)} (tenancy ${conflict.chosenFrom})`);
      for (const discarded of conflict.discarded) {
        console.log(`    discarded ${JSON.stringify(discarded.value)} (tenancy ${discarded.tenancyId})`);
      }
    }
    if (conflicts.length > 50) console.log(`  …and ${conflicts.length - 50} more.`);
  } else {
    console.log(`\nNo conflicting values across tenancies.`);
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing was written. Re-run with --apply to commit.\n`);
  } else {
    console.log(`\nDone.\n`);
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
