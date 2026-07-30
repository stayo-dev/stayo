/**
 * Forensic Investigation: Duplicate Rent Obligations
 * 
 * Finds the tenant with ₹8,500 rent who joined June 22 and has duplicate
 * June 2026 rent obligations, then traces every related DB record.
 */
import { prisma } from "../lib/db";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  FORENSIC REPORT: Duplicate Rent Obligation Investigation");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Step 1: Find the affected tenant — ₹8,500 rent, joined around June 22, 2026
  const suspects = await prisma.tenants.findMany({
    where: {
      monthly_rent: 8500,
      joined_on: {
        gte: new Date("2026-06-20"),
        lte: new Date("2026-06-25"),
      },
    },
    include: {
      profiles: { select: { name: true, email: true, phone: true } },
      hostels: { select: { id: true, name: true, auto_rent_day: true, rent_cycle: true } },
      room_allocations: {
        orderBy: { created_at: "desc" },
        include: { room: { select: { room_no: true, hostel_id: true } } },
      },
      tenant_invitations: {
        orderBy: { created_at: "desc" },
        select: {
          id: true, status: true, name: true,
          created_at: true, activated_at: true, opened_at: true,
          activation_started_at: true,
          monthly_rent: true, agreement_duration_months: true,
          agreement_start_date: true,
          parent_invitation_id: true,
          notes: true,
        },
      },
      agreements: {
        orderBy: { generated_at: "desc" },
        select: {
          id: true, status: true,
          agreement_start_date: true, agreement_end_date: true,
          agreement_duration_months: true,
          contract_rent: true,
          signed_at: true, generated_at: true,
        },
      },
    },
  });

  if (suspects.length === 0) {
    // Broader search — any tenant with duplicate June RENT obligations
    console.log("No exact match found. Searching for ANY tenant with duplicate June 2026 RENT...\n");
    const juneStart = new Date("2026-06-01");
    const julyStart = new Date("2026-07-01");

    const dupes = await prisma.$queryRaw<any[]>`
      SELECT tenant_id, rent_month, obligation_type, COUNT(*) as cnt
      FROM rent_obligations
      WHERE obligation_type = 'RENT'
        AND rent_month >= ${juneStart}
        AND rent_month < ${julyStart}
        AND is_superseded = false
      GROUP BY tenant_id, rent_month, obligation_type
      HAVING COUNT(*) > 1
    `;

    if (dupes.length === 0) {
      console.log("✅ No duplicate RENT obligations found for June 2026.");

      // Check all months for any duplicates
      console.log("\nExpanding search to ALL months...\n");
      const allDupes = await prisma.$queryRaw<any[]>`
        SELECT tenant_id, rent_month, obligation_type, COUNT(*) as cnt
        FROM rent_obligations
        WHERE obligation_type = 'RENT'
          AND is_superseded = false
        GROUP BY tenant_id, rent_month, obligation_type
        HAVING COUNT(*) > 1
        ORDER BY rent_month DESC
        LIMIT 20
      `;
      if (allDupes.length === 0) {
        console.log("✅ No duplicate RENT obligations found across ANY month.");
        console.log("\nSearching for the ₹8,500 tenant regardless of join date...\n");
      } else {
        console.log(`Found ${allDupes.length} tenant-month pairs with duplicate RENT obligations:\n`);
        for (const d of allDupes) {
          console.log(`  tenant_id: ${d.tenant_id}  rent_month: ${d.rent_month}  count: ${d.cnt}`);
        }
      }

      // Fallback: find any tenant with monthly_rent=8500 and show all their obligations
      const fallbackTenants = await prisma.tenants.findMany({
        where: { monthly_rent: 8500 },
        select: {
          id: true, status: true, joined_on: true, billing_start_date: true,
          monthly_rent: true,
          profiles: { select: { name: true } },
          hostels: { select: { name: true } },
        },
      });
      if (fallbackTenants.length > 0) {
        console.log(`\nFound ${fallbackTenants.length} tenant(s) with ₹8,500 rent:\n`);
        for (const t of fallbackTenants) {
          console.log(`  ${t.profiles?.name || "?"} | ${t.hostels?.name} | joined: ${t.joined_on} | status: ${t.status} | id: ${t.id}`);
        }
      }

      await prisma.$disconnect();
      return;
    }

    console.log(`Found ${dupes.length} tenant(s) with duplicate June RENT:\n`);
    for (const d of dupes) {
      console.log(`  tenant_id: ${d.tenant_id}  rent_month: ${d.rent_month}  count: ${d.cnt}`);
    }
    // Use first result for detailed investigation
    const tenantId = dupes[0].tenant_id;
    await investigateTenant(tenantId);
  } else {
    console.log(`Found ${suspects.length} suspect tenant(s). Investigating first match...\n`);
    for (const s of suspects) {
      console.log(`  ${s.profiles?.name || "?"} | ₹${s.monthly_rent} | joined: ${s.joined_on} | status: ${s.status}`);
    }
    await investigateTenant(suspects[0].id);
  }

  await prisma.$disconnect();
}

async function investigateTenant(tenantId: string) {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  DETAILED INVESTIGATION: tenant_id = ${tenantId}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 1. TENANT RECORD ──────────────────────────────────────────
  const tenant = await prisma.tenants.findUnique({
    where: { id: tenantId },
    include: {
      profiles: { select: { name: true, email: true, phone: true, created_at: true } },
      hostels: { select: { id: true, name: true, auto_rent_day: true, rent_cycle: true, status: true } },
    },
  });
  if (!tenant) { console.log("Tenant not found!"); return; }

  console.log("────────────────────────────────────────────────────────────");
  console.log("  1. TENANT RECORD");
  console.log("────────────────────────────────────────────────────────────");
  console.log(`  Name:               ${tenant.profiles?.name || "N/A"}`);
  console.log(`  Status:             ${tenant.status}`);
  console.log(`  Monthly Rent:       ₹${tenant.monthly_rent}`);
  console.log(`  Security Deposit:   ₹${tenant.security_deposit}`);
  console.log(`  Maintenance:        ₹${tenant.maintenance_charge} (${tenant.maintenance_type})`);
  console.log(`  joined_on (DB):     ${tenant.joined_on}`);
  console.log(`  billing_start_date: ${tenant.billing_start_date}`);
  console.log(`  Hostel:             ${tenant.hostels?.name} (${tenant.hostels?.id})`);
  console.log(`  auto_rent_day:      ${tenant.hostels?.auto_rent_day}`);
  console.log(`  rent_cycle:         ${tenant.hostels?.rent_cycle}`);
  console.log(`  Tenant created_at:  ${tenant.created_at}`);
  console.log(`  Profile created_at: ${tenant.profiles?.created_at}`);
  console.log(`  Activation started: ${tenant.activation_started_at}`);
  console.log(`  Activation done:    ${tenant.activation_completed_at}`);
  console.log();

  // ── 2. INVITATION HISTORY ────────────────────────────────────
  const invitations = await prisma.tenant_invitations.findMany({
    where: { tenant_id: tenantId },
    orderBy: { created_at: "asc" },
  });
  console.log("────────────────────────────────────────────────────────────");
  console.log("  2. INVITATION HISTORY");
  console.log("────────────────────────────────────────────────────────────");
  if (invitations.length === 0) {
    console.log("  (No invitations found — may be legacy path)");
  }
  for (const inv of invitations) {
    console.log(`  [${inv.status}] id=${inv.id}`);
    console.log(`    created_at:           ${inv.created_at}`);
    console.log(`    monthly_rent:         ₹${inv.monthly_rent}`);
    console.log(`    agreement_start_date: ${inv.agreement_start_date}`);
    console.log(`    agreement_duration:   ${inv.agreement_duration_months} months`);
    console.log(`    opened_at:            ${inv.opened_at}`);
    console.log(`    activation_started:   ${inv.activation_started_at}`);
    console.log(`    activated_at:         ${inv.activated_at}`);
    console.log(`    parent_invitation_id: ${inv.parent_invitation_id}`);
    console.log(`    notes:                ${inv.notes || "(none)"}`);
    console.log();
  }

  // ── 3. AGREEMENTS ────────────────────────────────────────────
  const agreements = await prisma.agreement.findMany({
    where: { tenant_id: tenantId },
    orderBy: { generated_at: "desc" },
    select: {
      id: true, status: true,
      agreement_start_date: true, agreement_end_date: true,
      agreement_duration_months: true,
      contract_rent: true, contract_security_deposit: true,
      signed_at: true, generated_at: true,
    },
  });
  console.log("────────────────────────────────────────────────────────────");
  console.log("  3. AGREEMENT RECORDS");
  console.log("────────────────────────────────────────────────────────────");
  if (agreements.length === 0) {
    console.log("  (No agreements found)");
  }
  for (const ag of agreements) {
    console.log(`  [${ag.status}] id=${ag.id}`);
    console.log(`    agreement_start_date: ${ag.agreement_start_date}`);
    console.log(`    agreement_end_date:   ${ag.agreement_end_date}`);
    console.log(`    duration:             ${ag.agreement_duration_months} months`);
    console.log(`    contract_rent:        ₹${ag.contract_rent}`);
    console.log(`    generated_at:         ${ag.generated_at}`);
    console.log(`    signed_at:            ${ag.signed_at}`);
    console.log();
  }

  // ── 4. ROOM ALLOCATIONS ──────────────────────────────────────
  const allocations = await prisma.roomAllocation.findMany({
    where: { tenant_id: tenantId },
    orderBy: { created_at: "desc" },
    include: { room: { select: { room_no: true, hostel_id: true } } },
  });
  console.log("────────────────────────────────────────────────────────────");
  console.log("  4. ROOM ALLOCATIONS");
  console.log("────────────────────────────────────────────────────────────");
  if (allocations.length === 0) {
    console.log("  (No room allocations found)");
  }
  for (const alloc of allocations) {
    console.log(`  [${alloc.is_active ? "ACTIVE" : "INACTIVE"}] id=${alloc.id}`);
    console.log(`    room:        ${alloc.room?.room_no}`);
    console.log(`    start_date:  ${alloc.start_date}`);
    console.log(`    end_date:    ${alloc.end_date}`);
    console.log(`    created_at:  ${alloc.created_at}`);
    console.log(`    updated_at:  ${alloc.updated_at}`);
    console.log();
  }

  // ── 5. ALL RENT OBLIGATIONS ──────────────────────────────────
  const obligations = await prisma.rent_obligations.findMany({
    where: { tenant_id: tenantId },
    orderBy: [{ rent_month: "asc" }, { created_at: "asc" }],
    include: {
      room_allocations: { select: { id: true } },
      payments: { select: { id: true, amount_paid: true, payment_date: true } },
    },
  });
  console.log("────────────────────────────────────────────────────────────");
  console.log("  5. ALL OBLIGATIONS (rent + deposit + maintenance)");
  console.log("────────────────────────────────────────────────────────────");
  let juneRentCount = 0;
  const juneRentObligations: any[] = [];
  for (const ob of obligations) {
    const isJuneRent = ob.obligation_type === "RENT" &&
      ob.rent_month.getUTCMonth() === 5 && // June = 5
      ob.rent_month.getUTCFullYear() === 2026 &&
      !ob.is_superseded;
    if (isJuneRent) {
      juneRentCount++;
      juneRentObligations.push(ob);
    }
    const marker = isJuneRent ? " ⚠️  DUPLICATE CANDIDATE" : "";
    console.log(`  [${ob.obligation_type}] ${ob.status}${ob.is_superseded ? " (SUPERSEDED)" : ""}${marker}`);
    console.log(`    id:             ${ob.id}`);
    console.log(`    rent_month:     ${ob.rent_month}`);
    console.log(`    amount:         ₹${ob.amount}`);
    console.log(`    total_amount:   ₹${ob.total_amount}`);
    console.log(`    due_date:       ${ob.due_date}`);
    console.log(`    allocation_id:  ${ob.allocation_id || "NULL ← onboarding path"}`);
    console.log(`    hostel_id:      ${ob.hostel_id}`);
    console.log(`    billing_start:  ${ob.billing_period_start}`);
    console.log(`    billing_end:    ${ob.billing_period_end}`);
    console.log(`    label:          ${ob.installment_label}`);
    console.log(`    billing_plan:   ${ob.billing_plan_id}`);
    console.log(`    agreement_id:   ${ob.agreement_id}`);
    console.log(`    created_at:     ${ob.created_at}`);
    console.log(`    payments:       ${ob.payments.length > 0 ? ob.payments.map((p: any) => `₹${p.amount_paid} on ${p.payment_date}`).join(", ") : "(none)"}`);
    console.log();
  }

  // ── 6. CREATION PATH ANALYSIS ────────────────────────────────
  console.log("════════════════════════════════════════════════════════════");
  console.log("  6. CREATION PATH ANALYSIS");
  console.log("════════════════════════════════════════════════════════════\n");

  if (juneRentObligations.length < 2) {
    console.log(`  June 2026 non-superseded RENT obligations: ${juneRentCount}`);
    if (juneRentCount <= 1) {
      console.log("  ✅ No duplicate detected for June 2026.");
      // Still analyze what exists
      if (juneRentCount === 1) {
        const ob = juneRentObligations[0];
        const createdByOnboarding = ob.allocation_id === null;
        console.log(`  Single June RENT was created by: ${createdByOnboarding ? "ONBOARDING (allocation_id=null)" : "CRON/SCHEDULER (allocation_id set)"}`);
      }
    }

    // Check if duplicates were already cleaned up (superseded)
    const supersededJuneRent = obligations.filter(
      (ob: any) => ob.obligation_type === "RENT" && ob.is_superseded &&
        ob.rent_month.getUTCMonth() === 5 && ob.rent_month.getUTCFullYear() === 2026
    );
    if (supersededJuneRent.length > 0) {
      console.log(`\n  Found ${supersededJuneRent.length} SUPERSEDED June RENT obligation(s) — may have been cleaned:`);
      for (const s of supersededJuneRent) {
        console.log(`    id=${s.id}  due=${s.due_date}  amount=₹${s.amount}  allocation_id=${s.allocation_id || "NULL"}  superseded_at=${s.superseded_at}`);
      }
    }
  } else {
    console.log("  ⚠️  DUPLICATE DETECTED: Multiple June 2026 RENT obligations\n");

    for (let i = 0; i < juneRentObligations.length; i++) {
      const ob = juneRentObligations[i];
      const createdByOnboarding = ob.allocation_id === null;
      const createdByCron = ob.allocation_id !== null && ob.installment_label?.includes("Rent");
      const createdByAgreement = ob.agreement_id !== null;

      console.log(`  ── Obligation ${i + 1} ──`);
      console.log(`    id:             ${ob.id}`);
      console.log(`    due_date:       ${ob.due_date}`);
      console.log(`    amount:         ₹${ob.amount}`);
      console.log(`    allocation_id:  ${ob.allocation_id || "NULL"}`);
      console.log(`    agreement_id:   ${ob.agreement_id || "NULL"}`);
      console.log(`    created_at:     ${ob.created_at}`);
      console.log(`    label:          ${ob.installment_label}`);

      if (createdByOnboarding) {
        console.log(`    ⇒ CREATED BY:   OnboardingFinancialsService (allocation_id=NULL, due=joiningDate)`);
        console.log(`    ⇒ WHY ALLOWED:  findFirst check passed (no existing RENT for this tenant+month)`);
      } else if (createdByAgreement) {
        console.log(`    ⇒ CREATED BY:   AgreementRentScheduleService (agreement-driven)`);
        console.log(`    ⇒ WHY ALLOWED:  Agreement schedule generates independently of other paths`);
      } else {
        console.log(`    ⇒ CREATED BY:   RentGenerationService (cron/manual via allocation)`);
        console.log(`    ⇒ WHY ALLOWED:  existingSet check uses allocation_id — can't see onboarding obligations with allocation_id=NULL`);
      }
      console.log();
    }
  }

  // ── 7. EVENT LOG TRACE ───────────────────────────────────────
  const events = await prisma.systemEventLog.findMany({
    where: { tenant_id: tenantId },
    orderBy: { created_at: "asc" },
    take: 50,
  });
  console.log("────────────────────────────────────────────────────────────");
  console.log("  7. SYSTEM EVENT LOG (chronological)");
  console.log("────────────────────────────────────────────────────────────");
  for (const ev of events) {
    const meta = ev.metadata as any;
    const condensed = meta ? JSON.stringify(meta).slice(0, 120) : "";
    console.log(`  ${ev.created_at.toISOString()}  [${ev.event_type}]  ${condensed}`);
  }
  console.log();

  // ── 8. RENT GENERATION LEDGER ────────────────────────────────
  const hostelId = tenant?.hostel_id;
  if (hostelId) {
    const ledgers = await prisma.rent_generation_ledgers.findMany({
      where: {
        hostel_id: hostelId,
        rent_month: { gte: new Date("2026-06-01"), lte: new Date("2026-07-01") },
      },
      orderBy: { created_at: "asc" },
    });
    console.log("────────────────────────────────────────────────────────────");
    console.log("  8. RENT GENERATION LEDGER (June/July 2026)");
    console.log("────────────────────────────────────────────────────────────");
    if (ledgers.length === 0) {
      console.log("  (No ledger entries found for this hostel in June/July 2026)");
    }
    for (const l of ledgers) {
      console.log(`  [${l.status}] ${l.obligation_type}`);
      console.log(`    rent_month:    ${l.rent_month}`);
      console.log(`    trigger_type:  ${l.trigger_type}`);
      console.log(`    created_count: ${l.created_count}`);
      console.log(`    skipped_count: ${l.skipped_count}`);
      console.log(`    failure:       ${l.failure_reason || "(none)"}`);
      console.log(`    started_at:    ${l.started_at}`);
      console.log(`    completed_at:  ${l.completed_at}`);
      console.log();
    }
  }

  // ── 9. ROOT CAUSE DETERMINATION ──────────────────────────────
  console.log("════════════════════════════════════════════════════════════");
  console.log("  9. ROOT CAUSE DETERMINATION");
  console.log("════════════════════════════════════════════════════════════\n");

  const onboardingObs = juneRentObligations.filter((ob: any) => ob.allocation_id === null);
  const cronObs = juneRentObligations.filter((ob: any) => ob.allocation_id !== null && ob.agreement_id === null);
  const agreementObs = juneRentObligations.filter((ob: any) => ob.agreement_id !== null);

  console.log(`  June RENT from Onboarding:  ${onboardingObs.length}`);
  console.log(`  June RENT from Cron:        ${cronObs.length}`);
  console.log(`  June RENT from Agreement:   ${agreementObs.length}`);
  console.log();

  if (juneRentObligations.length >= 2) {
    // A. Join date persistence
    console.log("  A. Incorrect join_date persistence?");
    console.log(`     tenant.joined_on = ${tenant?.joined_on}`);
    console.log(`     ⇒ ${tenant?.joined_on ? "join_date IS persisted correctly" : "join_date IS MISSING — potential cause"}`);
    console.log();

    // B. Onboarding-generated rent
    console.log("  B. Onboarding-generated rent as cause?");
    if (onboardingObs.length > 0) {
      console.log(`     ⇒ YES — Onboarding created ${onboardingObs.length} RENT obligation(s) with allocation_id=NULL`);
      console.log(`     ⇒ This is invisible to the cron's allocation_id-based dedup check`);
    } else {
      console.log("     ⇒ NO — Onboarding did NOT create a June RENT obligation");
    }
    console.log();

    // C. Duplicate generation paths
    console.log("  C. Duplicate rent generation paths?");
    if (onboardingObs.length > 0 && cronObs.length > 0) {
      console.log("     ⇒ YES — Both onboarding AND cron created June RENT independently");
      console.log("     ⇒ Neither service could detect the other's obligation");
    } else if (cronObs.length > 1) {
      console.log("     ⇒ YES — Cron created multiple June RENT obligations (possible re-allocation issue)");
    } else if (agreementObs.length > 0 && (onboardingObs.length > 0 || cronObs.length > 0)) {
      console.log("     ⇒ YES — Agreement schedule AND another path both created June RENT");
    } else {
      console.log("     ⇒ NO — Only one path created RENT obligations");
    }
    console.log();

    // D. Combination
    console.log("  D. Combination of causes?");
    const causes = [];
    if (!tenant?.joined_on) causes.push("missing join_date");
    if (onboardingObs.length > 0) causes.push("onboarding RENT with allocation_id=NULL");
    if (cronObs.length > 0 && onboardingObs.length > 0) causes.push("cross-path dedup gap");
    if (causes.length > 1) {
      console.log(`     ⇒ YES — Multiple contributing factors: ${causes.join(", ")}`);
    } else if (causes.length === 1) {
      console.log(`     ⇒ NO — Single root cause: ${causes[0]}`);
    } else {
      console.log("     ⇒ Undetermined");
    }
  } else {
    console.log("  Duplicate not confirmed in current data. Possible explanations:");
    console.log("  - Duplicates were already cleaned up manually");
    console.log("  - The bug occurs only under specific timing conditions");
    console.log("  - The affected tenant may have different rent amount than ₹8,500");
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
