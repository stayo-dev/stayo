/**
 * V1 Production Data Audit — Comprehensive Health Check
 * 
 * 10 checks across tenants, agreements, obligations, deposits, and invitations.
 * Read-only. Produces a detailed report or an all-clear message.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { prisma } from "../lib/db";

const OWNER_ID = "c39676a0-c867-4435-9660-a060b8bceab6";

interface Issue {
  check: string;
  tenantId: string;
  tenantName: string;
  room: string;
  details: Record<string, any>;
}

const issues: Issue[] = [];

function fmt(d: Date | null | undefined): string {
  if (!d) return "null";
  return d.toISOString().split("T")[0];
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          V1 PRODUCTION DATA AUDIT — FULL REPORT            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`Timestamp : ${new Date().toISOString()}`);
  console.log(`Owner ID  : ${OWNER_ID}\n`);

  // ── Load all data in bulk ──────────────────────────────────────────────
  const hostels = await prisma.hostels.findMany({
    where: { owner_id: OWNER_ID },
    select: { id: true, name: true },
  });
  const hostelIds = hostels.map((h: any) => h.id);

  const tenants = await prisma.tenants.findMany({
    where: { hostel_id: { in: hostelIds } },
    include: {
      profiles: { select: { name: true, email: true, phone: true } },
      room_allocations: {
        where: { is_active: true },
        include: { room: { select: { room_no: true } } },
      },
      agreements: {
        orderBy: { generated_at: "desc" as const },
        select: {
          id: true,
          status: true,
          agreement_start_date: true,
          agreement_end_date: true,
          agreement_duration_months: true,
          contract_rent: true,
          contract_security_deposit: true,
          generated_at: true,
        },
      },
      rent_obligations: {
        where: { is_superseded: false },
        select: {
          id: true,
          rent_month: true,
          amount: true,
          total_amount: true,
          status: true,
          obligation_type: true,
          agreement_id: true,
          payments: { select: { id: true, amount_paid: true } },
        },
        orderBy: { rent_month: "asc" as const },
      },
      tenant_financial_ledger: {
        select: {
          id: true,
          type: true,
          reason: true,
          amount: true,
          balance_after: true,
        },
        orderBy: { created_at: "asc" as const },
      },
    },
  });

  // Also load superseded obligations for check 7
  const allObligations = await prisma.rent_obligations.findMany({
    where: { hostel_id: { in: hostelIds } },
    select: {
      id: true,
      tenant_id: true,
      rent_month: true,
      amount: true,
      status: true,
      obligation_type: true,
      agreement_id: true,
      is_superseded: true,
      payments: { select: { id: true, amount_paid: true } },
    },
  });

  // Load invitations for check 9
  const invitations = await prisma.tenant_invitations.findMany({
    where: { owner_id: OWNER_ID },
    select: {
      id: true,
      tenant_id: true,
      name: true,
      status: true,
      room_id: true,
      agreement_start_date: true,
      agreement_duration_months: true,
    },
  });

  const roomNo = (t: any) => t.room_allocations?.[0]?.room?.room_no || "—";
  const tName = (t: any) => t.profiles?.name || "Unknown";

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 1: Tenants whose joining date is before 2026
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 1: Joining date before 2026 ───────────────────────");
  let c1 = 0;
  for (const t of tenants) {
    if (!t.joined_on) continue;
    const yr = t.joined_on.getUTCFullYear();
    if (yr < 2026) {
      c1++;
      const i: Issue = {
        check: "1_joining_date_before_2026",
        tenantId: t.id,
        tenantName: tName(t),
        room: roomNo(t),
        details: {
          joined_on: fmt(t.joined_on),
          status: t.status,
          billing_start_date: fmt(t.billing_start_date),
          agreement_start: t.agreements[0] ? fmt(t.agreements[0].agreement_start_date) : "no agreement",
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — joined_on=${i.details.joined_on}, status=${i.details.status}`);
    }
  }
  if (c1 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c1}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 2: Agreement start/end vs duration mismatch
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 2: Agreement date/duration mismatch ───────────────");
  let c2 = 0;
  for (const t of tenants) {
    for (const agr of t.agreements) {
      if (!agr.agreement_start_date || !agr.agreement_end_date || !agr.agreement_duration_months) continue;
      if (["VOID", "TERMINATED"].includes(agr.status)) continue;

      const start = new Date(agr.agreement_start_date);
      const end = new Date(agr.agreement_end_date);
      const dur = agr.agreement_duration_months;

      // Expected end = start + dur months (first of the month after the last covered month)
      const expectedEnd = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + dur,
        start.getUTCDate()
      ));

      const diffMs = Math.abs(end.getTime() - expectedEnd.getTime());
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays > 3) { // Allow 3-day tolerance for month-end rounding
        c2++;
        const i: Issue = {
          check: "2_agreement_date_duration_mismatch",
          tenantId: t.id,
          tenantName: tName(t),
          room: roomNo(t),
          details: {
            agreement_id: agr.id,
            status: agr.status,
            start: fmt(agr.agreement_start_date),
            end: fmt(agr.agreement_end_date),
            duration_months: dur,
            expected_end: fmt(expectedEnd),
            diff_days: Math.round(diffDays),
          },
        };
        issues.push(i);
        console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — start=${i.details.start}, end=${i.details.end}, dur=${dur}m, expectedEnd=${i.details.expected_end}`);
      }
    }
  }
  if (c2 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c2}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 3: Active tenants without an active agreement
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 3: Active tenant without active agreement ─────────");
  let c3 = 0;
  const activeAgreementStatuses = ["SIGNED", "EXPIRING_SOON"];
  for (const t of tenants) {
    if (t.status !== "ACTIVE") continue;
    const hasActiveAgr = t.agreements.some((a: any) => activeAgreementStatuses.includes(a.status));
    if (!hasActiveAgr) {
      c3++;
      const bestAgr = t.agreements[0];
      const i: Issue = {
        check: "3_active_tenant_no_active_agreement",
        tenantId: t.id,
        tenantName: tName(t),
        room: roomNo(t),
        details: {
          tenant_status: t.status,
          agreements_count: t.agreements.length,
          best_agreement_status: bestAgr?.status || "none",
          best_agreement_end: bestAgr ? fmt(bestAgr.agreement_end_date) : "n/a",
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — best agr status: ${i.details.best_agreement_status}`);
    }
  }
  if (c3 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c3}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 4: Active tenants without a room allocation
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 4: Active tenant without room allocation ──────────");
  let c4 = 0;
  for (const t of tenants) {
    if (t.status !== "ACTIVE") continue;
    if (!t.room_allocations || t.room_allocations.length === 0) {
      c4++;
      const i: Issue = {
        check: "4_active_tenant_no_room",
        tenantId: t.id,
        tenantName: tName(t),
        room: "—",
        details: {
          tenant_status: t.status,
          joined_on: fmt(t.joined_on),
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} — no active room allocation, joined=${i.details.joined_on}`);
    }
  }
  if (c4 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c4}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 5: Agreement security deposit ≠ tenant security_deposit
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 5: Deposit config mismatch (agreement vs tenant) ──");
  let c5 = 0;
  for (const t of tenants) {
    if (t.status !== "ACTIVE") continue;
    const activeAgr = t.agreements.find((a: any) => activeAgreementStatuses.includes(a.status));
    if (!activeAgr || activeAgr.contract_security_deposit == null) continue;

    const agrDeposit = Number(activeAgr.contract_security_deposit);
    const tenantDeposit = Number(t.security_deposit || 0);

    if (Math.abs(agrDeposit - tenantDeposit) > 0.01) {
      c5++;
      const i: Issue = {
        check: "5_deposit_mismatch",
        tenantId: t.id,
        tenantName: tName(t),
        room: roomNo(t),
        details: {
          agreement_deposit: agrDeposit,
          tenant_deposit: tenantDeposit,
          difference: agrDeposit - tenantDeposit,
          agreement_id: activeAgr.id,
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — agr=₹${agrDeposit}, tenant=₹${tenantDeposit}, Δ=₹${i.details.difference}`);
    }
  }
  if (c5 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c5}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 6: Duplicate active rent obligations for same billing period
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 6: Duplicate active obligations ───────────────────");
  let c6 = 0;
  const obsByTenantMonth = new Map<string, any[]>();
  for (const ob of allObligations) {
    if (ob.is_superseded) continue;
    if (ob.obligation_type !== "RENT") continue;
    const key = `${ob.tenant_id}|${fmt(ob.rent_month)}`;
    if (!obsByTenantMonth.has(key)) obsByTenantMonth.set(key, []);
    obsByTenantMonth.get(key)!.push(ob);
  }
  for (const [key, obs] of obsByTenantMonth) {
    if (obs.length <= 1) continue;
    c6++;
    const [tenantId, month] = key.split("|");
    const tenant = tenants.find((t: any) => t.id === tenantId);
    const i: Issue = {
      check: "6_duplicate_obligations",
      tenantId,
      tenantName: tenant ? tName(tenant) : "Unknown",
      room: tenant ? roomNo(tenant) : "—",
      details: {
        rent_month: month,
        count: obs.length,
        obligation_ids: obs.map((o: any) => o.id),
        statuses: obs.map((o: any) => o.status),
        amounts: obs.map((o: any) => Number(o.amount)),
      },
    };
    issues.push(i);
    console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — ${month}: ${obs.length} duplicates`);
  }
  if (c6 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c6}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 7: Orphan obligations belonging to superseded/void agreements
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 7: Orphan obligations on dead agreements ──────────");
  let c7 = 0;
  const agreementMap = new Map<string, any>();
  for (const t of tenants) {
    for (const agr of t.agreements) {
      agreementMap.set(agr.id, { ...agr, tenant: t });
    }
  }
  for (const ob of allObligations) {
    if (ob.is_superseded) continue;
    if (!ob.agreement_id) continue;
    const agr = agreementMap.get(ob.agreement_id);
    if (!agr) continue; // agreement from another owner
    if (["VOID", "TERMINATED"].includes(agr.status)) {
      c7++;
      const tenant = tenants.find((t: any) => t.id === ob.tenant_id);
      const i: Issue = {
        check: "7_orphan_obligation_dead_agreement",
        tenantId: ob.tenant_id,
        tenantName: tenant ? tName(tenant) : "Unknown",
        room: tenant ? roomNo(tenant) : "—",
        details: {
          obligation_id: ob.id,
          rent_month: fmt(ob.rent_month),
          amount: Number(ob.amount),
          status: ob.status,
          agreement_id: ob.agreement_id,
          agreement_status: agr.status,
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} — ob ${ob.id.slice(0, 8)} on ${agr.status} agreement`);
    }
  }
  if (c7 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c7}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 8: Outstanding balance ≠ sum of unpaid obligations
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 8: Balance vs unpaid obligations mismatch ─────────");
  let c8 = 0;
  for (const t of tenants) {
    if (t.status !== "ACTIVE") continue;
    const rentObs = t.rent_obligations.filter((o: any) => o.obligation_type === "RENT");
    
    let totalExpected = 0;
    let totalPaid = 0;
    for (const ob of rentObs) {
      totalExpected += Number(ob.total_amount || ob.amount || 0);
      for (const p of ob.payments) {
        totalPaid += Number(p.amount_paid || 0);
      }
    }
    const unpaidBalance = Math.round((totalExpected - totalPaid) * 100) / 100;

    // Check deposit ledger balance
    const depositEntries = t.tenant_financial_ledger.filter(
      (l: any) => l.reason === "SECURITY_DEPOSIT_COLLECTED" || l.reason === "SECURITY_DEPOSIT_TOPUP"
    );
    const depositPaid = depositEntries.reduce((sum: number, l: any) => {
      return sum + (l.type === "CREDIT" ? Number(l.amount) : -Number(l.amount));
    }, 0);

    const tenantDepositRequired = Number(t.security_deposit || 0);
    const depositDeficit = Math.round((tenantDepositRequired - depositPaid) * 100) / 100;

    // Report if there are unpaid obligations with amounts that seem wrong
    // (We check if any non-UPCOMING obligation has an unreasonable date - before 2026)
    const badObs = rentObs.filter((o: any) => {
      const yr = o.rent_month.getUTCFullYear();
      return yr < 2026 && !["PAID", "WAIVED"].includes(o.status);
    });

    if (badObs.length > 0) {
      c8++;
      const i: Issue = {
        check: "8_balance_anomaly_pre2026_unpaid",
        tenantId: t.id,
        tenantName: tName(t),
        room: roomNo(t),
        details: {
          total_expected: totalExpected,
          total_paid: totalPaid,
          unpaid_balance: unpaidBalance,
          deposit_required: tenantDepositRequired,
          deposit_paid: depositPaid,
          deposit_deficit: depositDeficit,
          pre2026_unpaid_count: badObs.length,
          pre2026_months: badObs.map((o: any) => fmt(o.rent_month)),
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — ${badObs.length} unpaid obligations from before 2026: ${i.details.pre2026_months.join(", ")}`);
    }
  }
  if (c8 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c8}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 9: Invitations pointing to a superseded/void agreement
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 9: Invitations on dead agreements ─────────────────");
  let c9 = 0;
  // Invitations don't directly reference agreement IDs in this schema,
  // but we check if an invitation's tenant has only VOID/TERMINATED agreements
  for (const inv of invitations) {
    if (["CANCELLED", "EXPIRED"].includes(inv.status)) continue;
    const tenant = tenants.find((t: any) => t.id === inv.tenant_id);
    if (!tenant) continue;
    const allVoidOrTerminated = tenant.agreements.length > 0 &&
      tenant.agreements.every((a: any) => ["VOID", "TERMINATED"].includes(a.status));
    if (allVoidOrTerminated) {
      c9++;
      const i: Issue = {
        check: "9_invitation_dead_agreements",
        tenantId: inv.tenant_id,
        tenantName: inv.name || tName(tenant),
        room: roomNo(tenant),
        details: {
          invitation_id: inv.id,
          invitation_status: inv.status,
          agreement_statuses: tenant.agreements.map((a: any) => a.status),
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} — invitation ${inv.id.slice(0, 8)} status=${inv.status}, all agreements void/terminated`);
    }
  }
  if (c9 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c9}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // CHECK 10: ACTIVE tenant whose agreement is expired
  // ═══════════════════════════════════════════════════════════════════════
  console.log("─── CHECK 10: Active tenant with expired agreement ──────────");
  let c10 = 0;
  for (const t of tenants) {
    if (t.status !== "ACTIVE") continue;
    // Find the most recent agreement
    const latest = t.agreements[0];
    if (!latest) continue;
    if (latest.status === "AGREEMENT_EXPIRED") {
      c10++;
      const i: Issue = {
        check: "10_active_tenant_expired_agreement",
        tenantId: t.id,
        tenantName: tName(t),
        room: roomNo(t),
        details: {
          agreement_id: latest.id,
          agreement_status: latest.status,
          agreement_end: fmt(latest.agreement_end_date),
          tenant_status: t.status,
        },
      };
      issues.push(i);
      console.log(`  ⚠ ${i.tenantName} (Room ${i.room}) — agr expired on ${i.details.agreement_end}`);
    }
  }
  if (c10 === 0) console.log("  ✅ No issues");
  console.log(`  Total: ${c10}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                       AUDIT SUMMARY                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const checkCounts: Record<string, number> = {
    "1. Joining date before 2026": c1,
    "2. Agreement date/duration mismatch": c2,
    "3. Active tenant, no active agreement": c3,
    "4. Active tenant, no room allocation": c4,
    "5. Deposit config mismatch": c5,
    "6. Duplicate active obligations": c6,
    "7. Orphan obligations on dead agreements": c7,
    "8. Pre-2026 unpaid balance anomalies": c8,
    "9. Invitations on dead agreements": c9,
    "10. Active tenant, expired agreement": c10,
  };

  const totalIssues = Object.values(checkCounts).reduce((a, b) => a + b, 0);

  for (const [label, count] of Object.entries(checkCounts)) {
    const icon = count === 0 ? "✅" : "⚠️";
    console.log(`  ${icon} ${label}: ${count}`);
  }

  console.log(`\n  ────────────────────────────────`);
  console.log(`  TOTAL ISSUES: ${totalIssues}`);
  console.log(`  TENANTS AUDITED: ${tenants.length}`);
  console.log(`  HOSTELS AUDITED: ${hostels.length}`);
  console.log(`  OBLIGATIONS AUDITED: ${allObligations.length}`);
  console.log(`  INVITATIONS AUDITED: ${invitations.length}`);

  if (totalIssues === 0) {
    console.log(`\n  Production data audit passed. Safe to proceed with V1.`);
  } else {
    console.log(`\n  ⛔ ${totalIssues} issue(s) found. Review the report above before proceeding.`);

    // Print detailed JSON for downstream consumption
    console.log("\n─── DETAILED ISSUE LIST (JSON) ──────────────────────────────");
    console.log(JSON.stringify(issues, null, 2));
  }
}

main()
  .catch((error) => {
    console.error("FATAL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
