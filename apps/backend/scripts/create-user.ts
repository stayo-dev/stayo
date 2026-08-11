import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/db.js';
import { randomUUID } from 'crypto';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase URL or Service Role Key in .env");
    process.exit(1);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const email = "sharan@gmail.com";
  const password = "password123";

  console.log(`Creating user ${email}...`);

  // 1. Create in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    console.error("Error creating user in Supabase Auth:", authError.message);
    if (!authError.message.includes("already registered")) {
      process.exit(1);
    }
  }

  // Get the user ID from auth, or query it if already exists
  let authUserId = authData?.user?.id;
  if (!authUserId) {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    authUserId = users.find(u => u.email === email)?.id;
  }
  
  if (!authUserId) {
    console.error("Could not determine auth user ID");
    process.exit(1);
  }

  // Wait a second in case there's a trigger
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 2. Ensure Profile exists in DB
  let profile = await prisma.profile.findUnique({ where: { auth_user_id: authUserId } });
  
  if (!profile) {
    profile = await prisma.profile.findUnique({ where: { email } });
  }

  if (!profile) {
    console.log("Creating profile in DB...");
    profile = await prisma.profile.create({
      data: {
        id: randomUUID(),
        auth_user_id: authUserId,
        email,
        name: "Sharan",
        role: "OWNER",
        is_active: true,
        is_profile_completed: true,
      }
    });
  } else {
    // Update to owner just in case
    await prisma.profile.update({
      where: { id: profile.id },
      data: { role: 'OWNER', is_profile_completed: true, email }
    });
  }

  console.log("Account created successfully!");
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
}

main().catch(console.error).finally(() => process.exit(0));
