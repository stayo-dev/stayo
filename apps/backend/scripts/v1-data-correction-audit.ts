/**
 * V1 Launch Data Correction — AUDIT SCRIPT (Read-Only)
 * 
 * This script reads production data to identify all tenants that need correction,
 * their current values, and any issues. It does NOT modify any data.
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { prisma } from "../lib/db";

const OWNER_ID = 'c39676a0-c867-4435-9660-a060b8bceab6';

async function main() {
  console.log("=== V1 Data Correction Audit ===\n");
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // 1. Get all hostels for this owner
  const hostels = await prisma.hostels.findMany({
    where: { owner_id: OWNER_ID },
    select: { id: true, name: true },
  });
  console.log(`Found ${hostels.length} hostels:`);
  for (const h of hostels) {
    console.log(`  - ${h.name} (${h.id})`);
  }

  // 2. Get all rooms with their numbers
  const rooms = await prisma.rooms.findMany({
    where: { hostel_id: { in: hostels.map(h => h.id) } },
    select: { id: true, room_no: true, hostel_id: true },
  });
  console.log(`\nFound ${rooms.length} rooms total\n`);

  // 3. Get ALL tenants with their full context
  const tenants = await prisma.tenants.findMany({
    where: { hostel_id: { in: hostels.map(h => h.id) } },
    include: {
      profiles: { select: { name: true, email: true, phone: true } },
      room_allocations: {
        where: { is_active: true },
        include: { room: { select: { room_no: true } } },
      },
      agreements: {
        where: { status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED", "DRAFT"] } },
        select: {
          id: true,
          status: true,
          agreement_start_date: true,
          agreement_end_date: true,
          agreement_duration_months: true,
          contract_rent: true,
          contract_security_deposit: true,
        },
        orderBy: { generated_at: "desc" },
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
        orderBy: { rent_month: "asc" },
      },
      tenant_financial_ledger: {
        select: {
          id: true,
          type: true,
          reason: true,
          amount: true,
          balance_after: true,
          created_at: true,
        },
        orderBy: { created_at: "asc" },
      },
    },
  });

  // Target tenants by room number and partial name match
  const targetTenants = [
    { room: "G2", nameHint: "Sreekar" },
    { room: "101", nameHint: "Deepak" },
    { room: "301", nameHint: "Abdul" },
    { room: "504", nameHint: "Shoeb" },
    { room: "405", nameHint: "Charan" },
    { room: "301", nameHint: "Hemanth" },
    { room: "G1", nameHint: "Yashwant" },
    { room: "G1", nameHint: "Bhargav" },
    { room: "301", nameHint: "Vamshi" },
    { room: "203", nameHint: "Akshay" },
    { room: "G4", nameHint: "Afreed" },
    { room: null, nameHint: "Faizaan" },
    { room: null, nameHint: "Ashish" },
  ];

  console.log("=== TARGET TENANT MATCHING ===\n");

  for (const target of targetTenants) {
    const matches = tenants.filter(t => {
      const name = t.profiles?.name || "";
      const roomMatch = target.room 
        ? t.room_allocations.some(ra => ra.room?.room_no === target.room)
        : true;
      const nameMatch = name.toLowerCase().includes(target.nameHint.toLowerCase());
      return roomMatch && nameMatch;
    });

    if (matches.length === 0) {
      // Try name-only match
      const nameOnlyMatches = tenants.filter(t => {
        const name = t.profiles?.name || "";
        return name.toLowerCase().includes(target.nameHint.toLowerCase());
      });
      console.log(`❌ Room ${target.room || "?"} / ${target.nameHint}: NO MATCH by room+name`);
      if (nameOnlyMatches.length > 0) {
        console.log(`   Name-only matches found:`);
        for (const m of nameOnlyMatches) {
          const roomNo = m.room_allocations[0]?.room?.room_no || "no room";
          console.log(`   → ${m.profiles?.name} (Room: ${roomNo}, ID: ${m.id}, Status: ${m.status})`);
        }
      }
      console.log("");
      continue;
    }

    for (const m of matches) {
      const roomNo = m.room_allocations[0]?.room?.room_no || "no room";
      const agreement = m.agreements[0]; // most recent
      const rentObs = m.rent_obligations.filter(o => o.obligation_type === "RENT");
      const depositLedger = m.tenant_financial_ledger.filter(
        l => l.reason === "SECURITY_DEPOSIT_COLLECTED" || l.reason === "SECURITY_DEPOSIT_TOPUP"
      );
      const depositBalance = depositLedger.reduce((sum, l) => {
        return sum + (l.type === "CREDIT" ? Number(l.amount) : -Number(l.amount));
      }, 0);

      console.log(`✅ Room ${roomNo} / ${m.profiles?.name}`);
      console.log(`   Tenant ID: ${m.id}`);
      console.log(`   Status: ${m.status}`);
      console.log(`   Monthly Rent (tenant): ₹${m.monthly_rent}`);
      console.log(`   Security Deposit (tenant): ₹${m.security_deposit}`);
      console.log(`   Joined On: ${m.joined_on?.toISOString().split("T")[0] || "null"}`);
      console.log(`   Billing Start: ${m.billing_start_date?.toISOString().split("T")[0] || "null"}`);
      
      if (agreement) {
        console.log(`   Agreement ID: ${agreement.id}`);
        console.log(`   Agreement Status: ${agreement.status}`);
        console.log(`   Agreement Start: ${agreement.agreement_start_date?.toISOString().split("T")[0] || "null"}`);
        console.log(`   Agreement End: ${agreement.agreement_end_date?.toISOString().split("T")[0] || "null"}`);
        console.log(`   Agreement Duration: ${agreement.agreement_duration_months} months`);
        console.log(`   Contract Rent: ₹${agreement.contract_rent}`);
        console.log(`   Contract Security Deposit: ₹${agreement.contract_security_deposit}`);
      } else {
        console.log(`   ⚠ NO AGREEMENT FOUND`);
      }

      console.log(`   Rent Obligations (non-superseded):`);
      for (const ob of rentObs) {
        const paid = ob.payments.reduce((s, p) => s + Number(p.amount_paid), 0);
        console.log(`     ${ob.rent_month.toISOString().split("T")[0]} | ₹${ob.amount} | Status: ${ob.status} | Paid: ₹${paid} | AgrID: ${ob.agreement_id?.slice(0, 8) || "null"}`);
      }

      console.log(`   Deposit Ledger Entries: ${depositLedger.length}`);
      console.log(`   Deposit Balance: ₹${depositBalance}`);
      for (const l of depositLedger) {
        console.log(`     ${l.type} | ₹${l.amount} | Reason: ${l.reason} | Balance After: ₹${l.balance_after}`);
      }
      console.log("");
    }
  }

  // 4. GLOBAL JOINING DATE AUDIT
  console.log("\n=== GLOBAL JOINING DATE AUDIT ===\n");
  
  const allActiveTenants = tenants.filter(t => t.status === "ACTIVE" || t.status === "INVITED");
  let joinDateIssues = 0;
  
  for (const t of allActiveTenants) {
    const joinDate = t.joined_on;
    if (!joinDate) continue;
    
    const joinYear = joinDate.getUTCFullYear();
    const roomNo = t.room_allocations[0]?.room?.room_no || "no room";
    const agreement = t.agreements[0];
    const agrStart = agreement?.agreement_start_date;
    
    if (joinYear === 2025) {
      joinDateIssues++;
      console.log(`⚠ WRONG YEAR: ${t.profiles?.name || "Unknown"} (Room ${roomNo})`);
      console.log(`  Joined On: ${joinDate.toISOString().split("T")[0]}`);
      console.log(`  Agreement Start: ${agrStart?.toISOString().split("T")[0] || "null"}`);
      console.log(`  Tenant ID: ${t.id}`);
      console.log("");
    }
  }
  
  console.log(`Total tenants with 2025 joining date: ${joinDateIssues}`);
  console.log(`Total active/invited tenants audited: ${allActiveTenants.length}`);
}

main()
  .catch((error) => {
    console.error("FATAL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
