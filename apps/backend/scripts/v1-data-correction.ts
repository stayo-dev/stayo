/**
 * V1 Production Data Correction — Final Reconciliation
 * Usage: npx tsx --require dotenv/config scripts/v1-data-correction.ts [--apply]
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { prisma } from "../lib/db";
import { AgreementRentScheduleService } from "../src/services/payments/agreement-rent-schedule-service";

const OWNER_ID = "c39676a0-c867-4435-9660-a060b8bceab6";
const HOSTEL_ID = "6fa62eca-cbb1-4b12-8567-81756608ed38";
const DRY_RUN = !process.argv.includes("--apply");
const scheduleService = new AgreementRentScheduleService();

const log: string[] = [];
function L(msg: string) { console.log(msg); log.push(msg); }

function d(v: Date | null | undefined): string { return v ? v.toISOString().split("T")[0] : "null"; }
function utc(s: string): Date { return new Date(s + "T00:00:00.000Z"); }

interface TenantCorrection {
  label: string;
  room: string;
  nameHint: string;
  rent: number;
  deposit: number;
  agrStart: string;   // YYYY-MM-DD
  agrEnd: string;     // YYYY-MM-DD
  duration: number;
  joinedOn: string;   // YYYY-MM-DD
  needsRoomAlloc?: boolean;
  needsAgreementCreate?: boolean; // for Bhargav (INVITED, no agreement)
  paymentAmount?: number;
  agrDateFixOnly?: boolean; // K.Ashish: only fix year in agreement
  skipFinancialChanges?: boolean; // K.Ashish
}

const CORRECTIONS: TenantCorrection[] = [
  { label: "1. M. Sreekar", room: "G2", nameHint: "Sreekar", rent: 8100, deposit: 16200, agrStart: "2026-06-01", agrEnd: "2026-08-01", duration: 2, joinedOn: "2026-06-01" },
  { label: "2. Deepak", room: "101", nameHint: "Deepak", rent: 8000, deposit: 16000, agrStart: "2026-05-01", agrEnd: "2026-09-01", duration: 4, joinedOn: "2026-05-01" },
  { label: "3. MD Abdul Rehman", room: "301", nameHint: "Abdul", rent: 8500, deposit: 17000, agrStart: "2026-06-01", agrEnd: "2026-08-01", duration: 2, joinedOn: "2026-06-01" },
  { label: "4. Mohammed Shoeb", room: "504", nameHint: "Shoeb", rent: 6500, deposit: 13000, agrStart: "2026-06-01", agrEnd: "2026-08-01", duration: 2, joinedOn: "2026-06-01" },
  { label: "5. Charan Sai", room: "405", nameHint: "Charan", rent: 8000, deposit: 17000, agrStart: "2026-04-01", agrEnd: "2026-08-01", duration: 4, joinedOn: "2026-04-01" },
  { label: "6. CH Hemanth", room: "301", nameHint: "Hemanth", rent: 8500, deposit: 17500, agrStart: "2026-05-01", agrEnd: "2026-08-01", duration: 3, joinedOn: "2026-05-01" },
  { label: "7. Ch. Yashwant", room: "G1", nameHint: "Yashwant", rent: 8500, deposit: 17000, agrStart: "2026-06-01", agrEnd: "2026-08-01", duration: 2, joinedOn: "2026-06-01" },
  { label: "8. G. Bhargav", room: "G1", nameHint: "BHARGAV_SPECIAL", rent: 8400, deposit: 16800, agrStart: "2026-03-01", agrEnd: "2026-08-01", duration: 5, joinedOn: "2026-03-01", needsRoomAlloc: true, needsAgreementCreate: true, paymentAmount: 7200 },
  { label: "9. Dongari Vamshi Nadh", room: "301", nameHint: "Vamshi", rent: 8250, deposit: 0, agrStart: "2026-04-01", agrEnd: "2026-08-01", duration: 4, joinedOn: "2026-04-01" },
  { label: "10. K. Ashish", room: "", nameHint: "Ashish", rent: 8000, deposit: 16000, agrStart: "2026-06-01", agrEnd: "2026-09-01", duration: 3, joinedOn: "2026-06-01", agrDateFixOnly: true, skipFinancialChanges: true },
  { label: "11. Md. Faizaan", room: "", nameHint: "Faizaan", rent: 8000, deposit: 16000, agrStart: "2026-05-01", agrEnd: "2026-09-01", duration: 4, joinedOn: "2026-05-01", paymentAmount: 7000 },
  { label: "12. Akshay Kolipaka", room: "203", nameHint: "Akshay", rent: 8000, deposit: 16000, agrStart: "2026-05-01", agrEnd: "2026-09-01", duration: 4, joinedOn: "2026-05-01", needsRoomAlloc: true },
  { label: "13. Mohammed Afreed", room: "G4", nameHint: "Afreed", rent: 8500, deposit: 0, agrStart: "2026-05-01", agrEnd: "2026-09-01", duration: 4, joinedOn: "2026-05-01" },
];

// Known tenant IDs from audit
const KNOWN_IDS: Record<string, string> = {
  "Sreekar": "3f929422-878c-49f1-aa2a-c678b59ee8e1",
  "Deepak": "654ab380-833c-4ac4-a2b8-24943b09036c",
  "Abdul": "62843eb1-2ba9-45db-a47e-21e930cd35d4",
  "Shoeb": "0596578e-492c-49bd-89b3-159681f765eb",
  "Charan": "41919125-b18c-42a0-98e4-e6c690445841",
  "Hemanth": "ab46313e-04d3-4a53-9058-709f907e944f",
  "Yashwant": "541901dd-332f-4e41-927d-3ae00a562d31",
  "BHARGAV_SPECIAL": "9122ab3c-2ba0-4adf-b0ee-f0a8799793d4",
  "Vamshi": "66552722-844d-4007-9cc7-7be54099bd12",
  "Ashish": "bdbccc3a-260f-47e5-accc-5b042ffa1fab",
  "Faizaan": "a21506a0-62d3-4194-9403-2070a07958b0",
  "Akshay": "d8f1f0f3-801f-425b-98a3-b706c0bf896c",
  "Afreed": "270f118a-db23-4258-8639-697ca98269dc",
};

// Additional joining date fix
const UNKNOWN_TENANT_ID = "3900e0bd-8a08-4c43-b975-2f4f9f51cd86";

async function main() {
  L(`╔══════════════════════════════════════════════════════════════╗`);
  L(`║     V1 PRODUCTION DATA CORRECTION ${DRY_RUN ? "(DRY RUN)" : "** LIVE **"}              ║`);
  L(`╚══════════════════════════════════════════════════════════════╝`);
  L(`Timestamp: ${new Date().toISOString()}\n`);

  // ── Phase 0: Backup ───────────────────────────────────────────
  L("═══ PHASE 0: BACKUP ═══");
  const backupData: any = {};
  for (const [hint, id] of Object.entries(KNOWN_IDS)) {
    const t = await prisma.tenants.findUnique({
      where: { id },
      include: {
        agreements: true,
        rent_obligations: { where: { is_superseded: false } },
        room_allocations: { where: { is_active: true } },
        tenant_financial_ledger: true,
      },
    });
    backupData[hint] = t;
  }
  // Also backup unknown tenant
  backupData["Unknown_3900e0bd"] = await prisma.tenants.findUnique({
    where: { id: UNKNOWN_TENANT_ID },
    include: { agreements: true, rent_obligations: { where: { is_superseded: false } } },
  });

  const backupPath = path.resolve(process.cwd(), `scripts/v1-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  L(`  Backup saved: ${backupPath}\n`);

  // ── Phase 1: Resolve rooms ────────────────────────────────────
  const rooms = await prisma.rooms.findMany({
    where: { hostel_id: HOSTEL_ID },
    select: { id: true, room_no: true },
  });
  const roomMap = new Map(rooms.map((r: any) => [r.room_no, r.id]));
  L(`  Loaded ${rooms.length} rooms\n`);

  // ── Phase 2: Execute corrections in transaction ───────────────
  L("═══ PHASE 2: CORRECTIONS ═══\n");

  if (DRY_RUN) {
    L("  ⚠ DRY RUN — showing planned changes only\n");
    await dryRun(roomMap);
  } else {
    await prisma.$transaction(async (tx: any) => {
      await applyCorrections(tx, roomMap);
    }, { timeout: 120000, maxWait: 30000 });
    L("\n  ✅ Transaction committed\n");

    // Phase 3: Generate obligations (needs own transactions)
    L("═══ PHASE 3: REGENERATE OBLIGATIONS ═══\n");
    await regenerateObligations();

    // Phase 4: Record payments
    L("═══ PHASE 4: RECORD PAYMENTS ═══\n");
    await recordPayments();
  }

  // Save log
  const logPath = path.resolve(process.cwd(), `scripts/v1-correction-log-${Date.now()}.txt`);
  fs.writeFileSync(logPath, log.join("\n"));
  L(`\nLog saved: ${logPath}`);
}

async function dryRun(roomMap: Map<string, string>) {
  for (const c of CORRECTIONS) {
    const tenantId = KNOWN_IDS[c.nameHint];
    const t = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: {
        profiles: { select: { name: true } },
        agreements: { where: { status: { notIn: ["VOID", "TERMINATED"] } }, orderBy: { generated_at: "desc" }, take: 1 },
        rent_obligations: { where: { is_superseded: false }, orderBy: { rent_month: "asc" } },
        room_allocations: { where: { is_active: true } },
      },
    });
    if (!t) { L(`  ❌ ${c.label}: TENANT NOT FOUND (${tenantId})`); continue; }

    const name = t.profiles?.name || "NO PROFILE";
    const agr = t.agreements[0];
    L(`  📋 ${c.label} — ${name} (${tenantId})`);
    L(`     Tenant: rent ₹${t.monthly_rent}→₹${c.rent} | deposit ₹${t.security_deposit}→₹${c.deposit} | joined ${d(t.joined_on)}→${c.joinedOn}`);
    if (agr) {
      L(`     Agreement: ${d(agr.agreement_start_date)}→${c.agrStart} | ${d(agr.agreement_end_date)}→${c.agrEnd} | dur ${agr.agreement_duration_months}→${c.duration} | rent ₹${agr.contract_rent}→₹${c.rent} | deposit ₹${agr.contract_security_deposit}→₹${c.deposit}`);
    } else {
      L(`     Agreement: NONE → will ${c.needsAgreementCreate ? "CREATE" : "skip"}`);
    }

    // Count obligations to supersede
    const obsToSupersede = t.rent_obligations.filter((o: any) => {
      const month = o.rent_month;
      const monthStr = d(month);
      return monthStr < c.agrStart || monthStr >= c.agrEnd;
    });
    L(`     Obligations: ${t.rent_obligations.length} current | ${obsToSupersede.length} to supersede | ${c.duration} target`);

    if (c.needsRoomAlloc) {
      const hasRoom = t.room_allocations.length > 0;
      L(`     Room: ${hasRoom ? "has allocation" : `NEEDS allocation → ${c.room} (${roomMap.get(c.room) || "NOT FOUND"})`}`);
    }
    if (c.paymentAmount) {
      L(`     Payment: ₹${c.paymentAmount} to record`);
    }
    L("");
  }

  // Global joining date fixes
  L("  📋 Global Joining Date Fix:");
  L(`     Unknown (${UNKNOWN_TENANT_ID}): 2025-06-01 → 2026-06-01`);
  L("");
}

async function applyCorrections(tx: any, roomMap: Map<string, string>) {
  for (const c of CORRECTIONS) {
    const tenantId = KNOWN_IDS[c.nameHint];
    L(`  ── ${c.label} (${tenantId}) ──`);

    const t = await tx.tenants.findUnique({
      where: { id: tenantId },
      include: {
        profiles: { select: { name: true } },
        agreements: { where: { status: { notIn: ["VOID", "TERMINATED"] } }, orderBy: { generated_at: "desc" }, take: 1 },
        rent_obligations: { where: { is_superseded: false }, orderBy: { rent_month: "asc" } },
        room_allocations: { where: { is_active: true } },
      },
    });
    if (!t) { L(`     ❌ NOT FOUND — SKIPPING`); continue; }

    // 1. Update tenant record
    const tenantPatch: any = {
      joined_on: utc(c.joinedOn),
      billing_start_date: utc(c.joinedOn),
    };
    if (!c.skipFinancialChanges) {
      tenantPatch.monthly_rent = c.rent;
      tenantPatch.security_deposit = c.deposit;
    }
    // For Bhargav: also set status to ACTIVE since they're INVITED
    if (c.needsAgreementCreate && t.status === "INVITED") {
      tenantPatch.status = "ACTIVE";
    }

    const oldTenant = { rent: Number(t.monthly_rent), deposit: Number(t.security_deposit), joined: d(t.joined_on), status: t.status };
    await tx.tenants.update({ where: { id: tenantId }, data: tenantPatch });
    L(`     Tenant: rent ₹${oldTenant.rent}→₹${c.rent} | deposit ₹${oldTenant.deposit}→₹${c.deposit} | joined ${oldTenant.joined}→${c.joinedOn}${tenantPatch.status ? ` | status ${oldTenant.status}→${tenantPatch.status}` : ""}`);

    // 2. Update or create agreement
    const agr = t.agreements[0];
    if (agr && !c.needsAgreementCreate) {
      const agrPatch: any = {
        agreement_start_date: utc(c.agrStart),
        agreement_end_date: utc(c.agrEnd),
        agreement_duration_months: c.duration,
        status: "SIGNED",
      };
      if (!c.skipFinancialChanges) {
        agrPatch.contract_rent = c.rent;
        agrPatch.contract_security_deposit = c.deposit;
      }
      // Update content_snapshot
      if (agr.content_snapshot) {
        const snap = { ...(agr.content_snapshot as any) };
        snap.agreement_start_date = c.agrStart;
        snap.agreement_end_date = c.agrEnd;
        snap.agreement_duration_months = c.duration;
        snap.joining_date = c.joinedOn;
        if (!c.skipFinancialChanges) {
          snap.monthly_rent = c.rent;
          snap.advance_deposit = c.deposit;
        }
        agrPatch.content_snapshot = snap;
      }
      const oldAgr = { start: d(agr.agreement_start_date), end: d(agr.agreement_end_date), dur: agr.agreement_duration_months, status: agr.status };
      await tx.agreement.update({ where: { id: agr.id }, data: agrPatch });
      L(`     Agreement ${agr.id.slice(0,8)}: ${oldAgr.start}→${c.agrStart} | ${oldAgr.end}→${c.agrEnd} | dur ${oldAgr.dur}→${c.duration} | status ${oldAgr.status}→SIGNED`);
    } else if (c.needsAgreementCreate) {
      // Bhargav: create new agreement
      const templateAgr = await tx.agreement.findFirst({ where: { hostel_id: HOSTEL_ID, status: "SIGNED" }, select: { content_snapshot: true, template_id: true } });
      if (!templateAgr?.template_id) throw new Error("Cannot create agreement: no template found");
      const snap = templateAgr?.content_snapshot ? { ...(templateAgr.content_snapshot as any) } : {};
      snap.agreement_start_date = c.agrStart;
      snap.agreement_end_date = c.agrEnd;
      snap.agreement_duration_months = c.duration;
      snap.monthly_rent = c.rent;
      snap.advance_deposit = c.deposit;
      snap.joining_date = c.joinedOn;
      snap.room_number = c.room;
      snap.tenant_name = "G.Bhargav";

      const newAgr = await tx.agreement.create({
        data: {
          tenant_id: tenantId,
          hostel_id: HOSTEL_ID,
          template_id: templateAgr.template_id,
          status: "SIGNED",
          agreement_start_date: utc(c.agrStart),
          agreement_end_date: utc(c.agrEnd),
          agreement_duration_months: c.duration,
          contract_rent: c.rent,
          contract_security_deposit: c.deposit,
          content_snapshot: snap,
          generated_at: new Date(),
          signed_at: new Date(),
        },
      });
      L(`     Agreement CREATED: ${newAgr.id.slice(0,8)} | ${c.agrStart}→${c.agrEnd} | dur ${c.duration} | rent ₹${c.rent}`);
    }

    // 3. Supersede wrong obligations
    const obsToSupersede = t.rent_obligations.filter((o: any) => {
      const monthStr = d(o.rent_month);
      return monthStr < c.agrStart || monthStr >= c.agrEnd;
    });

    for (const ob of obsToSupersede) {
      await tx.rent_obligations.update({
        where: { id: ob.id },
        data: { is_superseded: true, superseded_at: new Date(), superseded_by_request_id: null },
      });
      L(`     Superseded: ${d(ob.rent_month)} ₹${ob.amount} (${ob.obligation_type}) [${ob.id.slice(0,8)}]`);
    }

    // Also supersede the SECURITY_DEPOSIT obligation for Bhargav (amount ₹16799 is wrong)
    if (c.nameHint === "BHARGAV_SPECIAL") {
      const depObs = t.rent_obligations.filter((o: any) => o.obligation_type === "SECURITY_DEPOSIT");
      for (const ob of depObs) {
        await tx.rent_obligations.update({
          where: { id: ob.id },
          data: { is_superseded: true, superseded_at: new Date(), superseded_by_request_id: null },
        });
        L(`     Superseded deposit ob: ₹${ob.amount} [${ob.id.slice(0,8)}]`);
      }
    }

    // For Akshay: also supersede ALL orphan obligations (both the ₹16000 deposit and ₹8000 rent at 2025-09)
    if (c.nameHint === "Akshay") {
      const allObs = t.rent_obligations;
      for (const ob of allObs) {
        const monthStr = d(ob.rent_month);
        const alreadySuperseded = obsToSupersede.some((s: any) => s.id === ob.id);
        if (!alreadySuperseded && (monthStr < c.agrStart || monthStr >= c.agrEnd)) {
          await tx.rent_obligations.update({
            where: { id: ob.id },
            data: { is_superseded: true, superseded_at: new Date(), superseded_by_request_id: null },
          });
          L(`     Superseded extra: ${d(ob.rent_month)} ₹${ob.amount} (${ob.obligation_type}) [${ob.id.slice(0,8)}]`);
        }
      }
    }

    // 4. Room allocation
    if (c.needsRoomAlloc && t.room_allocations.length === 0) {
      const roomId = roomMap.get(c.room);
      if (roomId) {
        await tx.roomAllocation.create({
          data: {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            room_id: roomId,
            hostel_id: HOSTEL_ID,
            start_date: utc(c.joinedOn),
            is_active: true,
          },
        });
        L(`     Room allocation CREATED: ${c.room} (${roomId.slice(0,8)})`);
      } else {
        L(`     ⚠ Room ${c.room} NOT FOUND — skipping allocation`);
      }
    }

    L("");
  }

  // ── Global joining date fix for Unknown tenant ──
  L("  ── Global: Unknown Tenant (3900e0bd) ──");
  const unknownT = await tx.tenants.findUnique({ where: { id: UNKNOWN_TENANT_ID } });
  if (unknownT) {
    await tx.tenants.update({
      where: { id: UNKNOWN_TENANT_ID },
      data: { joined_on: utc("2026-06-01"), billing_start_date: utc("2026-06-01") },
    });
    L(`     joined_on: ${d(unknownT.joined_on)} → 2026-06-01`);
  }
  L("");
}

async function regenerateObligations() {
  // For each tenant that has an agreement, regenerate obligations
  const tenantsNeedingRegen = CORRECTIONS.filter(c => !c.skipFinancialChanges || c.agrDateFixOnly);

  for (const c of tenantsNeedingRegen) {
    const tenantId = KNOWN_IDS[c.nameHint];
    // Find their active agreement
    const agr = await prisma.agreement.findFirst({
      where: { tenant_id: tenantId, status: "SIGNED" },
      orderBy: { generated_at: "desc" },
    });
    if (!agr) {
      L(`  ⚠ ${c.label}: No SIGNED agreement found — skipping regen`);
      continue;
    }

    try {
      const result = await scheduleService.generateForAgreement(agr.id);
      L(`  ${c.label}: created=${result.created}, updated=${result.updated}, skipped=${result.skipped}`);
      for (const m of result.months) {
        L(`     ${d(m.rent_month)} → ${m.status}`);
      }
    } catch (err: any) {
      L(`  ❌ ${c.label}: REGEN FAILED — ${err.message}`);
    }
  }
  L("");
}

async function recordPayments() {
  // Bhargav: ₹7,200 against earliest rent obligation
  const bhargavCorrection = CORRECTIONS.find(c => c.nameHint === "BHARGAV_SPECIAL")!;
  await recordPaymentForTenant(KNOWN_IDS["BHARGAV_SPECIAL"], bhargavCorrection.paymentAmount!, "8. G. Bhargav");

  // Faizaan: ₹7,000 against earliest rent obligation
  const faizaanCorrection = CORRECTIONS.find(c => c.nameHint === "Faizaan")!;
  await recordPaymentForTenant(KNOWN_IDS["Faizaan"], faizaanCorrection.paymentAmount!, "11. Md. Faizaan");
}

async function recordPaymentForTenant(tenantId: string, amount: number, label: string) {
  // Find earliest unpaid RENT obligation
  const obligations = await prisma.rent_obligations.findMany({
    where: {
      tenant_id: tenantId,
      is_superseded: false,
      obligation_type: "RENT",
      status: { in: ["PENDING", "OVERDUE", "UPCOMING"] },
    },
    include: { payments: { select: { amount_paid: true } } },
    orderBy: { rent_month: "asc" },
  });

  if (obligations.length === 0) {
    L(`  ⚠ ${label}: No unpaid obligations found — skipping payment`);
    return;
  }

  let remaining = Math.round(amount * 100); // paisa
  const allocations: string[] = [];

  await prisma.$transaction(async (tx: any) => {
    for (const ob of obligations) {
      if (remaining <= 0) break;

      const paidPaisa = ob.payments.reduce((s: number, p: any) => s + Math.round(Number(p.amount_paid) * 100), 0);
      const duePaisa = Math.round(Number(ob.amount) * 100);
      const outstandingPaisa = Math.max(duePaisa - paidPaisa, 0);
      if (outstandingPaisa <= 0) continue;

      const allocPaisa = Math.min(remaining, outstandingPaisa);

      await tx.payments.create({
        data: {
          obligation_id: ob.id,
          tenant_id: tenantId,
          owner_id: OWNER_ID,
          amount_paid: allocPaisa / 100,
          payment_method: "CASH",
          payment_date: new Date(),
          offline_recorded_by: OWNER_ID,
          offline_recorded_at: new Date(),
          offline_note: "V1 data correction — pre-existing payment recorded",
          hostel_id: HOSTEL_ID,
        },
      });

      const newTotalPaid = paidPaisa + allocPaisa;
      const newStatus = newTotalPaid >= duePaisa ? "PAID" : "PARTIAL";
      await tx.rent_obligations.update({ where: { id: ob.id }, data: { status: newStatus } });

      allocations.push(`${d(ob.rent_month)}: ₹${allocPaisa / 100} → ${newStatus}`);
      remaining -= allocPaisa;
    }
  });

  L(`  ${label}: ₹${amount} payment recorded`);
  for (const a of allocations) L(`     ${a}`);
  if (remaining > 0) L(`     ⚠ Unallocated remainder: ₹${remaining / 100}`);
  L("");
}

main()
  .catch((error) => {
    console.error("FATAL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
