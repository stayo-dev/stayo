import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  const [logs, webhookEvents] = await Promise.all([
    prisma.whatsapp_logs.findMany({ take: 5 }),
    prisma.whatsapp_webhook_events.findMany({ take: 5 }),
  ]);
  console.log("Logs count:", logs.length);
  console.log("Webhook events count:", webhookEvents.length);
  if (webhookEvents.length > 0) {
    console.log("First webhook event:", JSON.stringify(webhookEvents[0], null, 2));
  }
  await prisma.$disconnect();
}

run().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
});
