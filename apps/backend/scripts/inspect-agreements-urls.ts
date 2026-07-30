import { prisma } from "../lib/db";

async function main() {
  const templates = await prisma.agreementTemplate.findMany({
    select: {
      id: true,
      title: true,
      owner_signature_url: true,
    }
  });

  const agreements = await prisma.agreement.findMany({
    select: {
      id: true,
      pdf_url: true,
      tenant_signature_url: true,
      guardian_signature_url: true,
      owner_signature_url: true,
    }
  });

  console.log("=== Agreement Templates ===");
  console.log(JSON.stringify(templates, null, 2));

  console.log("=== Agreements ===");
  console.log(JSON.stringify(agreements, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
