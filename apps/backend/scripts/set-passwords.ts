import * as dotenv from "dotenv";
import path from "path";
import bcrypt from "bcryptjs";

const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

/**
 * Resets one or more accounts to a known development password.
 *
 * Emails are arguments, not a hardcoded list. They used to be two real
 * addresses baked into the file — one of them the retired single-hostel
 * identity — which meant this script both carried a brand that must not appear
 * in this codebase (`scripts/check-production-branding.mjs`) and silently
 * targeted specific humans' accounts.
 *
 *   npx tsx scripts/set-passwords.ts owner@example.com [more@example.com …]
 *
 * Refuses to run with no arguments rather than falling back to a default set:
 * a script that resets passwords should never guess whose.
 */
async function main() {
  const emails = process.argv.slice(2).filter((arg) => arg.includes("@"));

  if (emails.length === 0) {
    console.error(
      "Usage: npx tsx scripts/set-passwords.ts <email> [email …]\n" +
        "Refusing to run without an explicit list — this resets passwords.",
    );
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import("../lib/db");
  const newPassword = process.env.DEV_PASSWORD || "password";
  const hash = await bcrypt.hash(newPassword, 10);

  console.log(`Setting password to "${newPassword}" for:`, emails);

  for (const email of emails) {
    const profile = await prisma.profile.findUnique({ where: { email } });
    if (!profile) {
      console.log(`Profile not found for ${email}`);
      continue;
    }
    await prisma.profile.update({
      where: { email },
      data: { password_hash: hash, password_reset_required: false },
    });
    console.log(`Successfully updated profile for ${email}`);
  }
}

main().catch((e) => {
  console.error("Error setting passwords:", e);
  process.exitCode = 1;
});
