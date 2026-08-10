import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/db.js';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase URL or Service Role Key in .env");
    process.exit(1);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const password = "password123";
  const passwordHash = await bcrypt.hash(password, 10);

  const accounts = [
    { email: "admin@stayo.dev", name: "System Admin", role: "ADMIN" },
    { email: "sharan@gmail.com", name: "Sharan (Owner)", role: "OWNER" },
    { email: "tenant@stayo.dev", name: "Test Tenant", role: "TENANT" }
  ];

  const createdProfiles = {};

  for (const acc of accounts) {
    console.log(`Setting up ${acc.role}: ${acc.email}...`);

    let profile = await prisma.profile.findUnique({ where: { email: acc.email } });
    if (profile) {
      console.log(`Profile ${acc.email} already exists, skipping Supabase creation...`);
      createdProfiles[acc.role] = profile;
      continue;
    }

    let { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: acc.email,
      password: password,
      email_confirm: true,
    });

    let authUserId = authData?.user?.id;
    if (!authUserId) {
      console.error(`Failed to create/find Supabase user for ${acc.email}`);
      continue;
    }

    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          id: randomUUID(),
          auth_user_id: authUserId,
          email: acc.email,
          name: acc.name,
          role: acc.role as "ADMIN" | "OWNER" | "TENANT",
          is_active: true,
          is_profile_completed: true,
          password_hash: passwordHash,
        }
      });
    } else {
      profile = await prisma.profile.update({
        where: { id: profile.id },
        data: {
          role: acc.role as "ADMIN" | "OWNER" | "TENANT",
          auth_user_id: authUserId,
          password_hash: passwordHash,
          is_profile_completed: true
        }
      });
    }

    createdProfiles[acc.role] = profile;
  }

  const owner = createdProfiles["OWNER"];
  const tenantProfile = createdProfiles["TENANT"];

  // 1. Ensure Owner has a hostel
  let hostel = await prisma.hostels.findFirst({ where: { owner_id: owner.id } });
  if (!hostel) {
    hostel = await prisma.hostels.create({
      data: {
        id: randomUUID(),
        owner_id: owner.id,
        name: "Sharan's Grand Hostel",
        phone: "9999999999",
        address: "123 Main St",
        status: "ACTIVE",
      }
    });
  }

  // 2. Ensure Tenant is linked to the hostel
  let tenant = await prisma.tenants.findFirst({ where: { profile_id: tenantProfile.id } });
  if (!tenant) {
    let floor = await prisma.floors.findFirst({ where: { hostel_id: hostel.id } });
    if (!floor) {
      floor = await prisma.floors.create({
        data: {
          id: randomUUID(),
          hostel_id: hostel.id,
          owner_id: owner.id,
          name: "First Floor",
          sort_order: 1,
        }
      });
    }

    let room = await prisma.rooms.findFirst({ where: { hostel_id: hostel.id } });
    if (!room) {
      room = await prisma.rooms.create({
        data: {
          id: randomUUID(),
          hostel_id: hostel.id,
          floor_id: floor.id,
          room_no: "101",
          capacity: 2,
        }
      });
    }

    tenant = await prisma.tenants.create({
      data: {
        id: randomUUID(),
        profile_id: tenantProfile.id,
        hostel_id: hostel.id,
        status: "ACTIVE",
      }
    });
  }

  // Generate some test alerts
  await prisma.notifications.create({
    data: {
      profile_id: owner.id,
      title: "Platform Update",
      message: "Admin has broadcasted a message.",
      type: "ADMIN_BROADCAST",
      is_read: false,
    }
  });

  console.log("\\n=== TEST ACCOUNTS SETUP COMPLETE ===");
  console.log("All accounts use password: password123");
  console.log("Admin:  admin@stayo.dev");
  console.log("Owner:  sharan@gmail.com");
  console.log("Tenant: tenant@stayo.dev");
  console.log("====================================\\n");
}

main().catch(console.error).finally(() => process.exit(0));
