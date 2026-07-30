/**
 * UAT demo-data preparation — NOT a feature, NOT a test. Connects real,
 * already-existing rows (an owner + 2 activated tenants that already existed
 * in the dev DB from an earlier verification pass) into one full production-
 * shaped chain: Platform Lead -> Approved Owner -> Owner's Hostels -> Rooms ->
 * Owner's Tenants -> Tenant Dashboard (payments, food, service requests,
 * announcements), so a human can manually click through Admin -> Owner ->
 * Tenant and see the same entities everywhere.
 *
 * Idempotent: safe to re-run. Existing rows are looked up by natural key
 * (email, hostel name, room_no, etc.) and reused rather than duplicated.
 *
 * Usage: npx tsx scripts/seed-uat-demo-chain.ts
 */
import * as dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

const DEMO_PASSWORD = "Stayo@2026";

function addDays(base: Date, days: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function firstOfMonth(base: Date, monthOffset = 0): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
}
function lastOfMonth(base: Date, monthOffset = 0): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset + 1, 0));
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

async function main() {
  const { prisma } = await import("../lib/db");
  const today = new Date();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── 0. Anchor: the owner + hostel + 2 tenants that already exist ──────────
  const OWNER_EMAIL = "real-owner-flow@stayo.dev";
  const owner = await prisma.profile.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
  const hostelA = await prisma.hostels.findFirstOrThrow({ where: { owner_id: owner.id } });
  const arjunProfile = await prisma.profile.findUniqueOrThrow({ where: { email: "arjun.mehta.dev-verify@stayo.dev" } });
  const karthikProfile = await prisma.profile.findUniqueOrThrow({ where: { email: "karthik.rao.dev-verify@stayo.dev" } });
  const arjunTenant = await prisma.tenants.findUniqueOrThrow({ where: { profile_id: arjunProfile.id } });
  const karthikTenant = await prisma.tenants.findUniqueOrThrow({ where: { profile_id: karthikProfile.id } });
  const roomA101 = await prisma.rooms.findFirstOrThrow({ where: { hostel_id: hostelA.id, room_no: "101" } });
  const floorA1 = await prisma.floors.findFirstOrThrow({ where: { hostel_id: hostelA.id } });
  console.log(`[0] Anchored on owner ${owner.email} / hostel "${hostelA.name}" / tenants Arjun+Karthik in room ${roomA101.room_no}`);

  // ── 1. Realistic branding — rename the QA-sounding names for a UAT feel ──
  await prisma.profile.update({ where: { id: owner.id }, data: { name: "Vikram Shetty" } });
  await prisma.hostels.update({
    where: { id: hostelA.id },
    data: { name: "Stayo Residency — MG Road", city: "Bengaluru", state: "Karnataka" },
  });
  console.log("[1] Renamed owner to Vikram Shetty, hostel to Stayo Residency — MG Road");

  // ── 2. Platform lead -> approved into this owner ───────────────────────────
  let lead = await prisma.platform_leads.findFirst({ where: { converted_owner_id: owner.id } });
  if (!lead) {
    lead = await prisma.platform_leads.create({
      data: {
        name: "Vikram Shetty",
        hostel_name: "Stayo Residency — MG Road",
        phone: "9845011223",
        city: "Bengaluru",
        bed_count: 24,
        status: "ACTIVE",
        notes: "Demo'd Growth plan, onboarded same week. Converted to owner account.",
        converted_owner_id: owner.id,
      },
    });
  } else {
    lead = await prisma.platform_leads.update({
      where: { id: lead.id },
      data: { name: "Vikram Shetty", hostel_name: "Stayo Residency — MG Road", status: "ACTIVE" },
    });
  }
  console.log(`[2] Platform lead ${lead.id} (${lead.name}) -> converted_owner_id=${owner.id}`);

  // ── 3. Second hostel for the same owner ────────────────────────────────────
  let hostelB = await prisma.hostels.findFirst({ where: { owner_id: owner.id, name: "Stayo Residency — Whitefield" } });
  if (!hostelB) {
    hostelB = await prisma.hostels.create({
      data: {
        owner_id: owner.id,
        name: "Stayo Residency — Whitefield",
        phone: "9845099887",
        address: "12th Cross, Whitefield Main Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560066",
        listing_status: "LIVE",
        verification_status: "VERIFIED",
        receipt_prefix: "SRW",
      },
    });
  }
  console.log(`[3] Hostel B: ${hostelB.name} (${hostelB.id})`);

  let floorB1 = await prisma.floors.findFirst({ where: { hostel_id: hostelB.id } });
  if (!floorB1) {
    floorB1 = await prisma.floors.create({ data: { hostel_id: hostelB.id, owner_id: owner.id, name: "Floor 1", sort_order: 0 } });
  }

  let floorA2 = await prisma.floors.findFirst({ where: { hostel_id: hostelA.id, name: "Floor 2" } });
  if (!floorA2) {
    floorA2 = await prisma.floors.create({ data: { hostel_id: hostelA.id, owner_id: owner.id, name: "Floor 2", sort_order: 1 } });
  }
  console.log(`[3b] Floors ready: A/Floor2=${floorA2.id}, B/Floor1=${floorB1.id}`);

  // ── 4. Rooms ────────────────────────────────────────────────────────────
  async function ensureRoom(hostelId: string, floorId: string, roomNo: string, capacity: number, baseRent: number) {
    const existing = await prisma.rooms.findFirst({ where: { hostel_id: hostelId, room_no: roomNo } });
    if (existing) return existing;
    return prisma.rooms.create({
      data: { hostel_id: hostelId, floor_id: floorId, room_no: roomNo, capacity, base_rent: baseRent, room_type: capacity > 2 ? "SHARING" : "DOUBLE" },
    });
  }
  const roomA201 = await ensureRoom(hostelA.id, floorA2.id, "201", 2, 8200);
  const roomA202 = await ensureRoom(hostelA.id, floorA2.id, "202", 2, 8200);
  const roomB101 = await ensureRoom(hostelB.id, floorB1.id, "B-101", 2, 8800);
  const roomB102 = await ensureRoom(hostelB.id, floorB1.id, "B-102", 2, 8800);
  console.log(`[4] Rooms ready: A/101(existing,cap${roomA101.capacity}), A/201, A/202, B/B-101, B/B-102`);

  // ── 5. 8 new ACTIVE tenants (Arjun + Karthik already exist = 10 total) ─────
  interface NewTenantSpec {
    name: string; emailSlug: string; phone: string; hostelId: string; roomId: string;
    monthlyRent: number; deposit: number; joinedDaysAgo: number;
  }
  const NEW_TENANTS: NewTenantSpec[] = [
    { name: "Priya Nair", emailSlug: "priya.nair", phone: "9845013001", hostelId: hostelA.id, roomId: roomA101.id, monthlyRent: 8500, deposit: 17000, joinedDaysAgo: 40 },
    { name: "Rohan Verma", emailSlug: "rohan.verma", phone: "9845013002", hostelId: hostelA.id, roomId: roomA101.id, monthlyRent: 8500, deposit: 17000, joinedDaysAgo: 35 },
    { name: "Sneha Iyer", emailSlug: "sneha.iyer", phone: "9845013003", hostelId: hostelA.id, roomId: roomA201.id, monthlyRent: 8200, deposit: 16400, joinedDaysAgo: 60 },
    { name: "Ananya Joshi", emailSlug: "ananya.joshi", phone: "9845013004", hostelId: hostelA.id, roomId: roomA201.id, monthlyRent: 8200, deposit: 16400, joinedDaysAgo: 58 },
    { name: "Vivek Menon", emailSlug: "vivek.menon", phone: "9845013005", hostelId: hostelA.id, roomId: roomA202.id, monthlyRent: 8200, deposit: 16400, joinedDaysAgo: 20 },
    { name: "Divya Pillai", emailSlug: "divya.pillai", phone: "9845013006", hostelId: hostelB.id, roomId: roomB101.id, monthlyRent: 8800, deposit: 17600, joinedDaysAgo: 50 },
    { name: "Aarav Kumar", emailSlug: "aarav.kumar", phone: "9845013007", hostelId: hostelB.id, roomId: roomB101.id, monthlyRent: 8800, deposit: 17600, joinedDaysAgo: 48 },
    { name: "Ishaan Rao", emailSlug: "ishaan.rao", phone: "9845013008", hostelId: hostelB.id, roomId: roomB102.id, monthlyRent: 8800, deposit: 17600, joinedDaysAgo: 15 },
  ];

  interface ActiveTenant { name: string; profileId: string; tenantId: string; hostelId: string; roomId: string; monthlyRent: number; deposit: number; joinedDaysAgo: number; }
  const arjunJoinedDaysAgo = Math.round((today.getTime() - new Date(arjunTenant.joined_on ?? today).getTime()) / 86_400_000);
  const karthikJoinedDaysAgo = Math.round((today.getTime() - new Date(karthikTenant.joined_on ?? today).getTime()) / 86_400_000);
  const allTenants: ActiveTenant[] = [
    { name: "Arjun Mehta", profileId: arjunProfile.id, tenantId: arjunTenant.id, hostelId: hostelA.id, roomId: roomA101.id, monthlyRent: Number(arjunTenant.monthly_rent), deposit: 17000, joinedDaysAgo: arjunJoinedDaysAgo },
    { name: "Karthik Rao", profileId: karthikProfile.id, tenantId: karthikTenant.id, hostelId: hostelA.id, roomId: roomA101.id, monthlyRent: Number(karthikTenant.monthly_rent), deposit: 16000, joinedDaysAgo: karthikJoinedDaysAgo },
  ];

  for (const spec of NEW_TENANTS) {
    const email = `${spec.emailSlug}.dev-verify@stayo.dev`;
    let profile = await prisma.profile.findUnique({ where: { email } });
    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          id: crypto.randomUUID(),
          email,
          name: spec.name,
          phone: `+91${spec.phone}`,
          password_hash: passwordHash,
          role: "TENANT",
          owner_id: owner.id,
          is_profile_completed: true,
          mobile_verified: true,
          phone_verified: true,
        },
      });
    }
    let tenant = await prisma.tenants.findUnique({ where: { profile_id: profile.id } });
    const joinedOn = addDays(today, -spec.joinedDaysAgo);
    if (!tenant) {
      tenant = await prisma.tenants.create({
        data: {
          profile_id: profile.id,
          hostel_id: spec.hostelId,
          owner_id: owner.id,
          status: "ACTIVE",
          monthly_rent: spec.monthlyRent,
          security_deposit: spec.deposit,
          joined_on: joinedOn,
          billing_start_date: joinedOn,
          activation_completed_at: joinedOn,
          profile_completed: true,
          mobile_verified: true,
          document_verified: true,
          phone_1: `+91${spec.phone}`,
          reservation_policy: "FULL_DEPOSIT",
          minimum_reservation_deposit: spec.deposit,
        },
      });
    }
    const existingAlloc = await prisma.roomAllocation.findFirst({ where: { tenant_id: tenant.id, is_active: true } });
    if (!existingAlloc) {
      await prisma.roomAllocation.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          room_id: spec.roomId,
          hostel_id: spec.hostelId,
          start_date: joinedOn,
          is_active: true,
        },
      });
    }
    allTenants.push({ name: spec.name, profileId: profile.id, tenantId: tenant.id, hostelId: spec.hostelId, roomId: spec.roomId, monthlyRent: spec.monthlyRent, deposit: spec.deposit, joinedDaysAgo: spec.joinedDaysAgo });
  }
  console.log(`[5] ${allTenants.length} ACTIVE tenants total (2 existing + ${NEW_TENANTS.length} new)`);

  // ── 6. Rent obligations + payments ─────────────────────────────────────
  // Arjun and Karthik already have a SECURITY_DEPOSIT obligation (+ Arjun a
  // July RENT obligation, already realistically overdue) from the earlier
  // verification pass — reused as-is, not duplicated. Everyone else gets a
  // fresh deposit (paid) + one past month (paid) + current month (mixed
  // overdue/pending) rent obligation, so Owner Collections and each
  // Tenant's own Money tab are reading the exact same underlying rows.
  async function ensureDepositPaid(t: ActiveTenant) {
    let ob = await prisma.rent_obligations.findFirst({ where: { tenant_id: t.tenantId, obligation_type: "SECURITY_DEPOSIT" } });
    if (!ob) {
      ob = await prisma.rent_obligations.create({
        data: {
          tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
          rent_month: firstOfMonth(today), amount: t.deposit, total_amount: t.deposit,
          due_date: today, status: "PENDING", obligation_type: "SECURITY_DEPOSIT",
          installment_label: "Security Deposit",
          billing_period_start: today, billing_period_end: today,
        },
      });
    }
    const alreadyPaid = await prisma.payments.findFirst({ where: { obligation_id: ob.id } });
    if (!alreadyPaid) {
      const group = await prisma.payment_groups.create({
        data: {
          tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
          total_amount: Number(ob.total_amount), method: "UPI", status: "COMPLETED", source: "MANUAL",
          recorded_by: owner.id, notes: "Security deposit at move-in",
        },
      });
      await prisma.payments.create({
        data: {
          obligation_id: ob.id, tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
          amount_paid: Number(ob.total_amount), payment_method: "UPI", payment_date: addDays(today, -Math.max(1, t.joinedDaysAgo)),
          payment_group_id: group.id, offline_recorded_by: owner.id,
        },
      });
      await prisma.rent_obligations.update({ where: { id: ob.id }, data: { status: "PAID", settlement_status: "PAID" } });
    }
    return ob;
  }

  async function ensurePastMonthPaid(t: ActiveTenant, monthsAgo: number) {
    const rentMonth = firstOfMonth(today, -monthsAgo);
    const existing = await prisma.rent_obligations.findFirst({ where: { tenant_id: t.tenantId, obligation_type: "RENT", rent_month: rentMonth } });
    if (existing) return existing;
    const dueDate = addDays(firstOfMonth(today, -monthsAgo), 4);
    const ob = await prisma.rent_obligations.create({
      data: {
        tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
        rent_month: rentMonth, amount: t.monthlyRent, total_amount: t.monthlyRent,
        due_date: dueDate, status: "PAID", obligation_type: "RENT",
        installment_label: `Rent – ${monthLabel(rentMonth)}`,
        billing_period_start: rentMonth, billing_period_end: lastOfMonth(today, -monthsAgo),
      },
    });
    const group = await prisma.payment_groups.create({
      data: {
        tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
        total_amount: t.monthlyRent, method: "UPI", status: "COMPLETED", source: "MANUAL",
        recorded_by: owner.id, notes: `Rent for ${monthLabel(rentMonth)}`,
      },
    });
    await prisma.payments.create({
      data: {
        obligation_id: ob.id, tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
        amount_paid: t.monthlyRent, payment_method: "UPI", payment_date: addDays(dueDate, -1),
        payment_group_id: group.id, offline_recorded_by: owner.id,
      },
    });
    await prisma.rent_obligations.update({ where: { id: ob.id }, data: { settlement_status: "PAID" } });
    return ob;
  }

  async function ensureCurrentMonthObligation(t: ActiveTenant, overdue: boolean) {
    const rentMonth = firstOfMonth(today);
    const existing = await prisma.rent_obligations.findFirst({ where: { tenant_id: t.tenantId, obligation_type: "RENT", rent_month: rentMonth } });
    if (existing) return existing;
    const dueDate = overdue ? addDays(today, -3) : addDays(today, 4);
    return prisma.rent_obligations.create({
      data: {
        tenant_id: t.tenantId, owner_id: owner.id, hostel_id: t.hostelId,
        rent_month: rentMonth, amount: t.monthlyRent, total_amount: t.monthlyRent,
        due_date: dueDate, status: "PENDING", obligation_type: "RENT",
        installment_label: `Rent – ${monthLabel(rentMonth)}`,
        billing_period_start: rentMonth, billing_period_end: lastOfMonth(today),
      },
    });
  }

  let idx = 0;
  for (const t of allTenants) {
    await ensureDepositPaid(t);
    // Only tenants who were actually here last month get a paid history row
    // for it (avoids "paid rent for a month before they moved in").
    if (t.joinedDaysAgo >= 45) await ensurePastMonthPaid(t, 1);
    if (t.name === "Karthik Rao") {
      // Karthik keeps his existing far-future due date (not yet overdue) — leave alone.
    } else {
      const overdue = idx % 3 === 0;
      await ensureCurrentMonthObligation(t, overdue);
    }
    idx++;
  }
  console.log("[6] Obligations + payments ensured for all 10 tenants (deposit paid, mixed rent history/overdue/pending)");

  // ── 7. Expenses (both hostels) ─────────────────────────────────────────
  const expenseCount = await prisma.expenses.count({ where: { owner_id: owner.id } });
  if (expenseCount === 0) {
    const expenseSpecs = [
      { title: "Rice & groceries — monthly", category: "Food & Groceries", amount: 18500, daysAgo: 3, hostelId: hostelA.id, vendor: "Sri Ganesh Traders", method: "UPI" },
      { title: "Electricity bill — MG Road", category: "Electricity", amount: 9200, daysAgo: 6, hostelId: hostelA.id, vendor: "BESCOM", method: "Bank Transfer" },
      { title: "Cook + housekeeping salary", category: "Staff Salary", amount: 32000, daysAgo: 2, hostelId: hostelA.id, vendor: null, method: "Bank Transfer" },
      { title: "Plumbing repair — Room 201", category: "Maintenance", amount: 1400, daysAgo: 9, hostelId: hostelA.id, vendor: "Local plumber", method: "Cash" },
      { title: "Broadband renewal", category: "Internet", amount: 1999, daysAgo: 12, hostelId: hostelA.id, vendor: "ACT Fibernet", method: "UPI" },
      { title: "Water tanker — Whitefield", category: "Water", amount: 2200, daysAgo: 4, hostelId: hostelB.id, vendor: "Local supplier", method: "Cash" },
      { title: "Groceries — Whitefield", category: "Food & Groceries", amount: 11400, daysAgo: 5, hostelId: hostelB.id, vendor: "Reliance Fresh", method: "UPI" },
      { title: "Electricity bill — Whitefield", category: "Electricity", amount: 6100, daysAgo: 7, hostelId: hostelB.id, vendor: "BESCOM", method: "Bank Transfer", pending: true },
    ];
    for (const e of expenseSpecs) {
      await prisma.expenses.create({
        data: {
          id: crypto.randomUUID(), owner_id: owner.id, hostel_id: e.hostelId,
          title: e.title, category: e.category, amount: e.amount, date: addDays(today, -e.daysAgo),
          vendor_name: e.vendor ?? undefined, payment_method: e.method, status: e.pending ? "pending" : "paid",
          expense_scope: "HOSTEL",
        },
      });
    }
    console.log(`[7] Created ${expenseSpecs.length} expenses across both hostels`);
  } else {
    console.log(`[7] ${expenseCount} expenses already exist — skipped`);
  }

  // ── 8. Food — Hostel A already has a published schedule; give Hostel B one too ─
  const hostelBMenuCount = await prisma.food_menu_items.count({ where: { hostel_id: hostelB.id } });
  if (hostelBMenuCount === 0) {
    const items = await Promise.all([
      prisma.food_menu_items.create({ data: { hostel_id: hostelB.id, owner_id: owner.id, meal_type: "BREAKFAST", name: "Poha" } }),
      prisma.food_menu_items.create({ data: { hostel_id: hostelB.id, owner_id: owner.id, meal_type: "LUNCH", name: "Curd Rice" } }),
      prisma.food_menu_items.create({ data: { hostel_id: hostelB.id, owner_id: owner.id, meal_type: "SNACKS", name: "Samosa" } }),
      prisma.food_menu_items.create({ data: { hostel_id: hostelB.id, owner_id: owner.id, meal_type: "DINNER", name: "Veg Pulao" } }),
    ]);
    const schedule = await prisma.food_schedules.create({
      data: { hostel_id: hostelB.id, owner_id: owner.id, month: firstOfMonth(today), status: "PUBLISHED", source: "MANUAL", published_at: today },
    });
    const days: Array<"MONDAY"|"TUESDAY"|"WEDNESDAY"|"THURSDAY"|"FRIDAY"|"SATURDAY"|"SUNDAY"> = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
    const byMeal: Record<string, string> = { BREAKFAST: items[0].id, LUNCH: items[1].id, SNACKS: items[2].id, DINNER: items[3].id };
    const byMealName: Record<string, string> = { BREAKFAST: items[0].name, LUNCH: items[1].name, SNACKS: items[2].name, DINNER: items[3].name };
    for (const day of days) {
      for (const meal of ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const) {
        await prisma.food_schedule_meals.create({
          data: { schedule_id: schedule.id, day_of_week: day, meal_type: meal, menu_item_id: byMeal[meal], item_name: byMealName[meal] },
        });
      }
    }
    console.log("[8] Hostel B: published a minimal weekly food schedule");
  } else {
    console.log("[8] Hostel B already has food menu items — skipped");
  }
  console.log("[8b] Hostel A's existing published July food schedule left untouched — already the exact one tenants will see");

  // ── 9. Service requests — ensure both demo tenants have one ────────────
  const karthikRequest = await prisma.tenant_service_requests.findFirst({ where: { tenant_id: karthikTenant.id } });
  if (!karthikRequest) {
    await prisma.tenant_service_requests.create({
      data: {
        hostel_id: hostelA.id, tenant_id: karthikTenant.id, type: "CLEANING",
        category: "Room cleaning", description: "Requesting extra cleaning before the weekend, thanks.",
        status: "RAISED",
      },
    });
    console.log("[9] Created a service request for Karthik Rao (RAISED, visible to owner)");
  } else {
    console.log("[9] Karthik already has a service request — skipped");
  }

  // ── 10. Announcements — one more recent one on Hostel A, one on Hostel B ─
  const recentAnnouncementA = await prisma.hostel_announcements.findFirst({
    where: { hostel_id: hostelA.id, title: "Monthly WiFi maintenance window" },
  });
  if (!recentAnnouncementA) {
    await prisma.hostel_announcements.create({
      data: { hostel_id: hostelA.id, owner_id: owner.id, title: "Monthly WiFi maintenance window", body: "Router restart scheduled 11pm-12am tonight, expect a brief outage." },
    });
  }
  const announcementB = await prisma.hostel_announcements.findFirst({ where: { hostel_id: hostelB.id } });
  if (!announcementB) {
    await prisma.hostel_announcements.create({
      data: { hostel_id: hostelB.id, owner_id: owner.id, title: "Welcome to Stayo Residency — Whitefield", body: "Front desk hours are 8am-9pm. Reach out to the warden for anything after that." },
    });
  }
  console.log("[10] Announcements ensured on both hostels");

  // ── 11. Subscriptions/Revenue — Hostel A already ACTIVE; give Hostel B one too ─
  let subB = await prisma.hostel_subscriptions.findUnique({ where: { hostel_id: hostelB.id } });
  if (!subB) {
    const starterPlan = await prisma.subscription_plans.findFirstOrThrow({ where: { name: "Starter" } });
    subB = await prisma.hostel_subscriptions.create({
      data: {
        hostel_id: hostelB.id, plan_id: starterPlan.id, status: "ACTIVE", billing_cycle: "MONTHLY",
        amount: starterPlan.price_amount, autopay_enabled: false,
        next_renewal_at: addDays(today, 20),
      },
    });
    await prisma.platform_invoices.create({
      data: {
        hostel_subscription_id: subB.id, hostel_id: hostelB.id, amount: starterPlan.price_amount,
        status: "PAID", invoice_number: `SRW-${today.getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        paid_at: addDays(today, -10),
      },
    });
    console.log("[11] Hostel B: Starter subscription + a paid platform invoice created");
  } else {
    console.log("[11] Hostel B already has a subscription — skipped");
  }

  // ── 12. Passwords for the 4 demo logins ────────────────────────────────
  for (const email of ["admin-test@stayo.dev", OWNER_EMAIL, "arjun.mehta.dev-verify@stayo.dev", "karthik.rao.dev-verify@stayo.dev"]) {
    await prisma.profile.update({ where: { email }, data: { password_hash: passwordHash, password_reset_required: false } });
  }
  console.log(`[12] Password reset to "${DEMO_PASSWORD}" for admin-test, owner, Arjun, Karthik`);

  console.log("\n=== DONE ===");
  console.log(`Lead: ${lead.id} (${lead.name}, ${lead.hostel_name}) status=${lead.status} converted_owner_id=${lead.converted_owner_id}`);
  console.log(`Owner: ${owner.email} / profile ${owner.id}`);
  console.log(`Hostel A: ${hostelA.id} — Stayo Residency — MG Road`);
  console.log(`Hostel B: ${hostelB.id} — Stayo Residency — Whitefield`);
  console.log(`Tenants (${allTenants.length}):`);
  for (const t of allTenants) console.log(`  - ${t.name} | tenant=${t.tenantId} | hostel=${t.hostelId === hostelA.id ? "A" : "B"} | room=${t.roomId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
