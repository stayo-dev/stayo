import { prisma } from "../lib/db";
import { safeRedis } from "../lib/redis/client";
import { redisKeys } from "../lib/redis/keys";
import { normalizeWhatsAppPhone } from "../lib/services/notifications/providers/whatsapp";

async function main() {
  const inputPhone = "7032204420";
  const normalized = normalizeWhatsAppPhone(inputPhone);
  console.log(`Resetting rate limits and OTPs for: ${inputPhone} (normalized: ${normalized})`);

  const scopes = ["otp:phone", "otp:ip"];
  const phonesToClear = [inputPhone, normalized, `+91${inputPhone}`];

  await safeRedis("resetRateLimit", async (redis) => {
    for (const scope of scopes) {
      for (const phone of phonesToClear) {
        const key = redisKeys.rateLimit(scope, phone);
        const deleted = await redis.del(key);
        if (deleted) {
          console.log(`Deleted Redis key: ${key}`);
        }
      }
    }
  }, null);

  // Also expire pending OTPs in database to clean up state
  const updated = await (prisma as any).phoneVerificationOtp.updateMany({
    where: {
      phone: { in: phonesToClear },
      status: "PENDING",
    },
    data: {
      status: "EXPIRED",
      failure_reason: "Reset by admin script",
    },
  });

  console.log(`Expired ${updated.count} pending OTP records in the database.`);
  console.log("OTP Rate limits successfully reset!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
