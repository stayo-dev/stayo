import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";

const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

async function main() {
  const { prisma } = await import("../lib/db");
  
  const emails = ["sriadithyahostels@gmail.com", "spchidiri2006@gmail.com"];
  const newPassword = "password";
  const hash = await bcrypt.hash(newPassword, 10);
  
  console.log(`Setting password to "${newPassword}" for:`, emails);
  
  for (const email of emails) {
    const profile = await prisma.profile.findUnique({
      where: { email }
    });
    if (profile) {
      await prisma.profile.update({
        where: { email },
        data: {
          password_hash: hash,
          password_reset_required: false
        }
      });
      console.log(`Successfully updated profile for ${email}`);
    } else {
      console.log(`Profile not found for ${email}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("Error setting passwords:", e);
  });
