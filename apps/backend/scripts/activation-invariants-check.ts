import { prisma } from "../lib/db";

async function main() {
  const [
    activeMissingProfileOrCompletion,
    activeMissingAcceptance,
    invitedCompleted,
    cancelledOrExpiredAuthenticatable,
    ownerManagedMissingContact,
    // Legacy (pre-ADR-165) owner-managed invariants — scoped to NOT_REQUIRED.
    legacyOwnerManagedMissingAttestation,
    legacyOwnerManagedWithAuthIdentity,
    legacyOwnerManagedWithPolicyAcceptance,
    // ADR-165: explicit acceptance state.
    pendingWrongShape,
    pendingStamped,
    pendingWithAttestation,
    pendingWithPolicyAcceptance,
    acceptedWrongShape,
    closedPendingStillOccupying,
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
        acceptance_status: "NOT_REQUIRED",
        owner_attestations: { none: {} },
      },
      select: { id: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        access_mode: "OWNER_MANAGED",
        acceptance_status: "NOT_REQUIRED",
        profiles: { auth_user_id: { not: null } },
      },
      select: { id: true, profile_id: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: {
        access_mode: "OWNER_MANAGED",
        acceptance_status: "NOT_REQUIRED",
        rule_acceptances: { some: {} },
      },
      select: { id: true, profile_id: true },
      take: 25,
    }),
    // acceptance_status = PENDING ⇒ ACTIVE + OWNER_MANAGED, a bound profile,
    // and an active room allocation (it is operationally live).
    prisma.tenants.findMany({
      where: {
        acceptance_status: "PENDING",
        OR: [
          { status: { not: "ACTIVE" } },
          { access_mode: { not: "OWNER_MANAGED" } },
          { profile_id: null },
          { room_allocations: { none: { is_active: true, end_date: null } } },
        ],
      },
      select: { id: true, status: true, access_mode: true, profile_id: true },
      take: 25,
    }),
    // PENDING ⇒ acceptance has not happened: no personal-completion stamps.
    prisma.tenants.findMany({
      where: {
        acceptance_status: "PENDING",
        OR: [
          { activation_completed_at: { not: null } },
          { tenant_accepted_at: { not: null } },
        ],
      },
      select: { id: true, activation_completed_at: true, tenant_accepted_at: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: { acceptance_status: "PENDING", owner_attestations: { some: {} } },
      select: { id: true },
      take: 25,
    }),
    prisma.tenants.findMany({
      where: { acceptance_status: "PENDING", rule_acceptances: { some: {} } },
      select: { id: true },
      take: 25,
    }),
    // acceptance_status = ACCEPTED ⇒ the tenant finished: ACTIVE + SELF_SERVE
    // with both completion stamps.
    prisma.tenants.findMany({
      where: {
        acceptance_status: "ACCEPTED",
        OR: [
          { status: { not: "ACTIVE" } },
          { access_mode: { not: "SELF_SERVE" } },
          { activation_completed_at: null },
          { tenant_accepted_at: null },
        ],
      },
      select: { id: true, status: true, access_mode: true },
      take: 25,
    }),
    // A closed (CANCELLED/EXPIRED) PENDING tenancy must have been swept: no
    // active allocation, no future unpaid RENT obligation left standing.
    prisma.tenants.findMany({
      where: {
        acceptance_status: "PENDING",
        status: { in: ["CANCELLED", "EXPIRED"] },
        room_allocations: { some: { is_active: true, end_date: null } },
      },
      select: { id: true, status: true },
      take: 25,
    }),
  ]);

  const failures = [
    ["ACTIVE tenant must have completed profile and valid profile_id", activeMissingProfileOrCompletion],
    ["ACTIVE tenant must have accepted rules", activeMissingAcceptance],
    ["INVITED tenant must not have activation_completed_at", invitedCompleted],
    ["CANCELLED/EXPIRED tenant must not authenticate", cancelledOrExpiredAuthenticatable],
    ["OWNER_MANAGED ACTIVE tenant must have a display name and phone", ownerManagedMissingContact],
    ["Legacy OWNER_MANAGED ACTIVE tenant must have an owner attestation", legacyOwnerManagedMissingAttestation],
    ["Legacy OWNER_MANAGED tenant must not hold a linked auth identity", legacyOwnerManagedWithAuthIdentity],
    ["Legacy OWNER_MANAGED tenant must not hold a TenantPolicyAcceptance", legacyOwnerManagedWithPolicyAcceptance],
    ["PENDING acceptance ⇒ ACTIVE + OWNER_MANAGED + bound profile + active allocation", pendingWrongShape],
    ["PENDING acceptance ⇒ no activation_completed_at / tenant_accepted_at", pendingStamped],
    ["PENDING acceptance ⇒ no owner attestation (ADR-165 writes none)", pendingWithAttestation],
    ["PENDING acceptance ⇒ no TenantPolicyAcceptance", pendingWithPolicyAcceptance],
    ["ACCEPTED ⇒ ACTIVE + SELF_SERVE + both completion stamps", acceptedWrongShape],
    ["Closed (CANCELLED/EXPIRED) PENDING tenancy must not still hold an active allocation", closedPendingStillOccupying],
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
