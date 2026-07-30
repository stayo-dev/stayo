/**
 * Forensic v2: Check ALL 3 tenants with ₹8,500 rent who joined June 22.
 * Focus on the Onboarding vs Agreement Schedule clash.
 */
import { prisma } from "../lib/db";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  FORENSIC v2: All 3 Tenants — Obligation Timeline Analysis");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const tenants = await prisma.tenants.findMany({
    where: {
      monthly_rent: 8500,
      joined_on: { gte: new Date("2026-06-20"), lte: new Date("2026-06-25") },
    },
    include: {
      profiles: { select: { name: true } },
      hostels: { select: { name: true } },
      agreements: {
        orderBy: { generated_at: "desc" },
        select: {
          id: true, status: true,
          agreement_start_date: true, agreement_end_date: true,
          agreement_duration_months: true,
          signed_at: true, generated_at: true,
        },
      },
      tenant_invitations: {
        orderBy: { created_at: "desc" },
        select: {
          id: true, status: true, created_at: true,
          agreement_start_date: true, agreement_duration_months: true,
        },
      },
    },
  });

  for (const t of tenants) {
    console.log(`\n${"═".repeat(64)}`);
    console.log(`  TENANT: ${t.profiles?.name} (${t.id})`);
    console.log(`  Hostel: ${t.hostels?.name}`);
    console.log(`  joined_on: ${t.joined_on}  |  status: ${t.status}`);
    console.log(`${"═".repeat(64)}\n`);

    // Invitation
    if (t.tenant_invitations.length > 0) {
      const inv = t.tenant_invitations[0];
      console.log(`  Invitation: agreement_start_date=${inv.agreement_start_date}  duration=${inv.agreement_duration_months}mo`);
    }

    // Agreement
    if (t.agreements.length > 0) {
      const ag = t.agreements[0];
      console.log(`  Agreement:  start=${ag.agreement_start_date}  end=${ag.agreement_end_date}  duration=${ag.agreement_duration_months}mo`);
      console.log(`              signed_at=${ag.signed_at}  generated_at=${ag.generated_at}`);
    }

    // All obligations for this tenant
    const obligations = await prisma.rent_obligations.findMany({
      where: { tenant_id: t.id, is_superseded: false },
      orderBy: [{ rent_month: "asc" }, { created_at: "asc" }],
    });

    console.log(`\n  ALL OBLIGATIONS (${obligations.length} total):`);
    console.log(`  ${"─".repeat(56)}`);

    // Group by rent_month for duplicate detection
    const byMonth = new Map<string, any[]>();
    for (const ob of obligations) {
      const key = `${ob.rent_month.toISOString().slice(0,7)}:${ob.obligation_type}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(ob);
    }

    // Show duplicates
    let hasDuplicates = false;
    for (const [key, obs] of byMonth) {
      if (obs.length > 1) {
        hasDuplicates = true;
        console.log(`\n  ⚠️  DUPLICATE: ${key} — ${obs.length} obligations`);
        for (let i = 0; i < obs.length; i++) {
          const ob = obs[i];
          // Determine creation path
          let path = "UNKNOWN";
          if (ob.agreement_id && ob.installment_label?.match(/rent \(\d+\)/i)) {
            path = "AgreementRentScheduleService";
          } else if (ob.installment_label === "Rent – Jun 2026" || ob.installment_label?.startsWith("Rent –")) {
            path = "OnboardingFinancialsService";
          } else if (ob.allocation_id) {
            path = "RentGenerationService (cron)";
          } else if (ob.installment_label === "Security Deposit") {
            path = "OnboardingFinancialsService";
          } else {
            path = `INFERRED: ${ob.agreement_id ? "Agreement" : ob.allocation_id ? "Cron" : "Onboarding"}`;
          }

          console.log(`    [${i+1}] id=${ob.id}`);
          console.log(`        due_date=${ob.due_date}  amount=₹${ob.amount}`);
          console.log(`        allocation_id=${ob.allocation_id || "NULL"}`);
          console.log(`        agreement_id=${ob.agreement_id || "NULL"}`);
          console.log(`        label="${ob.installment_label}"`);
          console.log(`        created_at=${ob.created_at}`);
          console.log(`        ⇒ PATH: ${path}`);
        }
      }
    }

    if (!hasDuplicates) {
      console.log(`  ✅ No duplicates found`);
    }

    // Show full timeline
    console.log(`\n  FULL OBLIGATION TIMELINE:`);
    for (const ob of obligations) {
      const marker = byMonth.get(`${ob.rent_month.toISOString().slice(0,7)}:${ob.obligation_type}`)!.length > 1 ? " ⚠️" : "";
      console.log(`    ${ob.rent_month.toISOString().slice(0,7)} | ${ob.obligation_type.padEnd(16)} | ₹${String(ob.amount).padEnd(6)} | due=${ob.due_date.toISOString().slice(0,10)} | alloc=${ob.allocation_id?.slice(0,8) || "NULL    "} | agmt=${ob.agreement_id?.slice(0,8) || "NULL    "} | "${ob.installment_label}"${marker}`);
    }
  }

  // Global duplicate scan
  console.log(`\n\n${"═".repeat(64)}`);
  console.log("  GLOBAL DUPLICATE SCAN (all tenants, all months)");
  console.log(`${"═".repeat(64)}\n`);

  const allDupes = await prisma.$queryRaw<any[]>`
    SELECT 
      ro.tenant_id,
      ro.rent_month,
      ro.obligation_type,
      COUNT(*) as cnt,
      array_agg(ro.id) as obligation_ids,
      array_agg(ro.due_date) as due_dates,
      array_agg(ro.created_at ORDER BY ro.created_at) as created_ats,
      array_agg(ro.allocation_id) as allocation_ids,
      array_agg(ro.agreement_id) as agreement_ids,
      array_agg(ro.installment_label) as labels
    FROM rent_obligations ro
    WHERE ro.is_superseded = false
      AND ro.obligation_type IN ('RENT', 'SECURITY_DEPOSIT')
    GROUP BY ro.tenant_id, ro.rent_month, ro.obligation_type
    HAVING COUNT(*) > 1
    ORDER BY ro.rent_month DESC
  `;

  if (allDupes.length === 0) {
    console.log("  ✅ No duplicate obligations found system-wide for RENT/SECURITY_DEPOSIT.");
  } else {
    console.log(`  ⚠️  Found ${allDupes.length} duplicate group(s):\n`);
    for (const d of allDupes) {
      const tenant = await prisma.tenants.findUnique({
        where: { id: d.tenant_id },
        include: { profiles: { select: { name: true } } },
      });
      console.log(`  Tenant: ${tenant?.profiles?.name || "?"} (${d.tenant_id})`);
      console.log(`    rent_month:  ${d.rent_month}`);
      console.log(`    type:        ${d.obligation_type}`);
      console.log(`    count:       ${d.cnt}`);
      console.log(`    due_dates:   ${d.due_dates}`);
      console.log(`    alloc_ids:   ${d.allocation_ids}`);
      console.log(`    agmt_ids:    ${d.agreement_ids}`);
      console.log(`    labels:      ${d.labels}`);
      console.log(`    created_ats: ${d.created_ats}`);
      console.log();
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
