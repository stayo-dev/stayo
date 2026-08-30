/**
 * Create (or repair) a test tenant that can actually log in and be used.
 *
 * A tenant is not just an auth user: the portal needs a `profile` (role
 * TENANT) linked to its Supabase auth user, a `tenants` row owned by a real
 * owner in a real hostel, and an active room allocation. Creating only the
 * auth user produces an account that signs in and then shows nothing.
 *
 * Idempotent — safe to re-run. Existing rows are updated, never duplicated.
 *
 * Usage:
 *   npx tsx --env-file=../../.env scripts/create-test-tenant.ts \
 *     --email tenant@yourstayo.com --password 'Stayo@2026' \
 *     --owner owner@example.com [--hostel "Starlink"] [--apply]
 *
 * Without `--apply` it reports what it *would* do and writes nothing.
 */
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes('--apply');

/**
 * Both halves of an account must live in the same Supabase project.
 *
 * The auth user is created through SUPABASE_URL while the profile and tenancy
 * are written through DATABASE_URL. If those point at different projects the
 * account is split: the auth side has a user with no profile, and the database
 * side has a profile whose `auth_user_id` does not exist in its own auth
 * schema. It then fails to log in *in both places*, which is the exact split
 * that took production auth down on 2026-08-08 — and it is invisible until
 * someone tries to sign in.
 *
 * Cheap to check, so it is checked before anything is written.
 */
function assertSameProject() {
  const dbUrl = process.env.DATABASE_URL ?? '';
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

  const dbRef = /postgres\.([a-z0-9]{16,})/.exec(dbUrl)?.[1] ?? null;
  const authRef = /https:\/\/([a-z0-9]{16,})\.supabase\.co/.exec(supabaseUrl)?.[1] ?? null;

  console.log(`  database project : ${dbRef ?? '(unreadable)'}`);
  console.log(`  auth project     : ${authRef ?? '(unreadable)'}`);

  if (!dbRef || !authRef) {
    throw new Error('Could not read both project refs from DATABASE_URL and SUPABASE_URL — refusing to guess.');
  }
  if (dbRef !== authRef) {
    throw new Error(
      `Project mismatch: the database is "${dbRef}" but auth is "${authRef}".\n` +
        '  Creating an account across two projects yields one that works in neither.\n' +
        '  Point both at the same project and re-run.',
    );
  }
}

async function main() {
  const email = (arg('email') ?? 'tenant@yourstayo.com').toLowerCase().trim();
  const password = arg('password') ?? 'Stayo@2026';
  const ownerEmail = (arg('owner') ?? '').toLowerCase().trim();
  const hostelName = arg('hostel');
  const name = arg('name') ?? 'Test Tenant';
  const phone = arg('phone') ?? '9000000001';

  if (!ownerEmail) throw new Error('--owner <email> is required: a tenant must belong to an owner.');

  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'} — test tenant ${email}\n`);
  assertSameProject();

  const owner = await prisma.profile.findFirst({
    where: { email: ownerEmail },
    select: { id: true, name: true, role: true },
  });
  if (!owner) throw new Error(`No profile found for owner ${ownerEmail} in this database.`);
  if (owner.role !== 'OWNER') throw new Error(`${ownerEmail} has role ${owner.role}, not OWNER.`);

  const hostels = await prisma.hostels.findMany({
    where: { owner_id: owner.id, status: { in: ['ACTIVE', 'INACTIVE'] }, ...(hostelName ? { name: hostelName } : {}) },
    select: { id: true, name: true },
    orderBy: { created_at: 'asc' },
  });
  if (hostels.length === 0) throw new Error(`Owner ${ownerEmail} has no hostel${hostelName ? ` named "${hostelName}"` : ''}.`);
  const hostel = hostels[0];

  // A room with a free bed. Without an allocation the tenant logs in to an
  // account with no room, no rent and no dues — not a usable test fixture.
  const rooms = await prisma.rooms.findMany({
    where: { hostel_id: hostel.id, is_active: true },
    select: {
      id: true,
      room_no: true,
      capacity: true,
      base_rent: true,
      _count: { select: { room_allocations: { where: { is_active: true, end_date: null } } } },
    },
    orderBy: { room_no: 'asc' },
  });
  const room = rooms.find((r) => r._count.room_allocations < r.capacity);
  if (!room) throw new Error(`No room with a free bed in "${hostel.name}".`);

  const rent = Number(room.base_rent ?? 0);
  console.log(`  owner            : ${owner.name} <${ownerEmail}>`);
  console.log(`  hostel           : ${hostel.name}`);
  console.log(`  room             : ${room.room_no} (${room._count.room_allocations}/${room.capacity} occupied)`);
  console.log(`  monthly rent     : ₹${rent.toLocaleString('en-IN')}`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to create.\n');
    return;
  }

  // ── Supabase auth user ───────────────────────────────────────────────────
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let authUserId: string | undefined;
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !/already registered|already exists/i.test(created.error.message)) {
    throw new Error(`Supabase createUser failed: ${created.error.message}`);
  }
  authUserId = created.data?.user?.id;

  if (!authUserId) {
    // Already registered — find it and reset the password so the credentials
    // in this script are the ones that actually work.
    const { data } = await supabase.auth.admin.listUsers();
    const existing = data.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) throw new Error('User reported as existing but could not be found.');
    authUserId = existing.id;
    await supabase.auth.admin.updateUserById(authUserId, { password, email_confirm: true });
    console.log('  auth user        : existed, password reset');
  } else {
    console.log('  auth user        : created');
  }

  // ── Profile ──────────────────────────────────────────────────────────────
  let profile = await prisma.profile.findFirst({ where: { OR: [{ auth_user_id: authUserId }, { email }] } });
  if (profile) {
    profile = await prisma.profile.update({
      where: { id: profile.id },
      data: { auth_user_id: authUserId, role: 'TENANT', email, name, phone, is_active: true },
    });
    console.log('  profile          : updated');
  } else {
    profile = await prisma.profile.create({
      data: {
        id: randomUUID(),
        auth_user_id: authUserId,
        email,
        name,
        phone,
        role: 'TENANT',
        is_active: true,
        is_profile_completed: true,
      },
    });
    console.log('  profile          : created');
  }

  // ── Tenancy ──────────────────────────────────────────────────────────────
  let tenant = await prisma.tenants.findFirst({ where: { profile_id: profile.id } });
  const tenancy = {
    profile_id: profile.id,
    owner_id: owner.id,
    hostel_id: hostel.id,
    status: 'ACTIVE' as const,
    monthly_rent: rent,
    joined_on: new Date(),
    phone_1: phone,
    personal_email: email,
    profile_completed: true,
  };

  if (tenant) {
    tenant = await prisma.tenants.update({ where: { id: tenant.id }, data: tenancy });
    console.log('  tenancy          : updated');
  } else {
    tenant = await prisma.tenants.create({ data: tenancy });
    console.log('  tenancy          : created');
  }

  const allocation = await prisma.roomAllocation.findFirst({
    where: { tenant_id: tenant.id, is_active: true, end_date: null },
  });
  if (!allocation) {
    await prisma.roomAllocation.create({
      data: {
        id: randomUUID(),
        tenant_id: tenant.id,
        room_id: room.id,
        hostel_id: hostel.id,
        start_date: new Date(),
        is_active: true,
      },
    });
    console.log('  allocation       : created');
  } else {
    console.log('  allocation       : already present, left alone');
  }

  console.log(`\nDone. Sign in as ${email} / ${password}\n`);
}

main()
  .catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
