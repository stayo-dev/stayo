import { prisma } from "../lib/db";

async function main() {
  const otps = await (prisma as any).phoneVerificationOtp.findMany({
    orderBy: { created_at: "desc" },
    take: 10
  });
  console.log("Recent OTPs:", otps.map((o: any) => ({
    id: o.id,
    phone: o.phone,
    created_at: o.created_at,
    purpose: o.purpose,
    status: o.status
  })));
}

main().catch(console.error);
