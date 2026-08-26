import { prisma } from "../lib/db";

async function main() {
  const [
    activeMissingProfileOrCompletion,
    activeMissingAcceptance,
    invitedCompleted,
    cancelledOrExpiredAuthenticatable,
    ownerManagedMissingContact,
    ownerManagedMissingAttestation,
    ownerManagedWithAuthIdentity,
  ] = await Promise.all([
    prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        access_mode: "SELF_SERVE",
        OR: [
          { profile_completed: false },
          { profiles: { is_profile_completed: false } },
        ],
      },
      select: { id: true, profile_id: true, profile_completed: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        access_mode: "SELF_SERVE",
        rule_acceptances: { none: {} },
      },
      select: { id: true, profile_id: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        status: "INVITED",
        activation_completed_at: { not: null },
      },
      select: { id: true, profile_id: true, activation_completed_at: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        status: { in: ["CANCELLED", "EXPIRED"] },
        profiles: { is_active: true },
      },
      select: { id: true, profile_id: true, status: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        access_mode: "OWNER_MANAGED",
        OR: [{ display_name: null }, { display_name: "" }, { phone_1: null }],
      },
      select: { id: true, display_name: true, phone_1: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        status: "ACTIVE",
        access_mode: "OWNER_MANAGED",
        owner_attestations: { none: {} },
      },
      select: { id: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        access_mode: "OWNER_MANAGED",
        profiles: { auth_user_id: { not: null } },
      },
      select: { id: true, profile_id: true },
      take: 25,
    }),
  ]);

  const failures = [
    ["ACTIVE tenant must have completed profile and valid profile_id", activeMissingProfileOrCompletion],
    ["ACTIVE tenant must have accepted rules", activeMissingAcceptance],
    ["INVITED tenant must not have activation_completed_at", invitedCompleted],
    ["CANCELLED/EXPIRED tenant must not authenticate", cancelledOrExpiredAuthenticatable],
    ["OWNER_MANAGED ACTIVE tenant must have a display name and phone", ownerManagedMissingContact],
    ["OWNER_MANAGED ACTIVE tenant must have an owner attestation", ownerManagedMissingAttestation],
    ["OWNER_MANAGED tenant must not hold a linked auth identity", ownerManagedWithAuthIdentity],
  ].filter(([, rows]) => (rows as any[]).length > 0);

  if (failures.length > 0) {
    for (const [name, rows] of failures) {
      console.error(`FAIL ${name}`);
      console.error(JSON.stringify(rows, null, 2));
    }
    process.exit(1);
  }

  console.log("OK activation workflow data invariants");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
