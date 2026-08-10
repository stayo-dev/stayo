import * as dotenv from "dotenv";
import path from "path";
import bcrypt from "bcryptjs";
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });
async function main() {
  const { prisma } = await import("../lib/db");
  const email = "owner-00098f02-2699-4b5d-8047-4fd000c71c7b@test.com";
  const newPassword = "password123";
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.profile.update({
    where: { email },
    data: { password_hash: hash, password_reset_required: false }
  });
  console.log("Password updated successfully for", email);
}
main().catch(console.error).finally(() => process.exit(0));
