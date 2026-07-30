import { prisma } from "../lib/db";

async function main() {
  const templates = await prisma.agreementTemplate.findMany();
  console.log("=== AGREEMENT TEMPLATES ===");
  for (const t of templates) {
    console.log(`\nTemplate: ${t.title} (${t.id})`);
    console.log(`Hostel ID: ${t.hostel_id}`);
    console.log(`Rules Content:`, JSON.stringify(t.rules_content, null, 2));
  }

  const ruleVersions = await prisma.ruleVersion.findMany();
  console.log("\n=== RULE VERSIONS ===");
  for (const r of ruleVersions) {
    console.log(`\nRule Version: ${r.title} (${r.id})`);
    console.log(`Hostel ID: ${r.hostel_id}`);
    console.log(`Content:`, JSON.stringify(r.content, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
