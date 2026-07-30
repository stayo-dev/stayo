import { prisma } from "../lib/db";

async function main() {
  try {
    const otps = await prisma.phoneVerificationOtp.findMany({
      orderBy: { created_at: 'desc' },
      take: 5
    });
    console.log("=== LATEST OTP RECORDS ===");
    console.log(otps.map(o => ({
      id: o.id,
      phone: o.phone,
      otp: o.otp,
      purpose: o.purpose,
      status: o.status,
      created_at: o.created_at
    })));
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
