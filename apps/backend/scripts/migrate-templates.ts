import { prisma } from "../lib/db";
import { DEFAULT_RULES_TEMPLATE } from "../src/utils/default-rules";
import crypto from "crypto";

async function main() {
  console.log("Starting AgreementTemplate provisioning migration...");

  // 1. Fetch all hostels with their owner profile
  const hostels = await prisma.hostels.findMany({
    include: {
      profiles: {
        select: {
          name: true,
        },
      },
    },
  });

  console.log(`Found ${hostels.length} hostels to inspect.`);

  for (const hostel of hostels) {
    console.log(`\nProcessing hostel: ${hostel.name} (${hostel.id})`);

    // 2. Check if there is already a published residency template
    const existingPublished = await prisma.agreementTemplate.findFirst({
      where: {
        hostel_id: hostel.id,
        status: "PUBLISHED",
        type: "RESIDENCY",
      },
    });

    if (existingPublished) {
      console.log(`-> Hostel already has a PUBLISHED RESIDENCY template (ID: ${existingPublished.id}). Skipping creation.`);
      continue;
    }

    const templateId = crypto.randomUUID();
    const ownerName = hostel.profiles?.name || "Hostel Owner";

    console.log(`-> Creating new template draft and publishing it...`);
    
    // Create the published template
    const template = await prisma.agreementTemplate.create({
      data: {
        id: templateId,
        hostel_id: hostel.id,
        version: "v1-migration",
        title: `${hostel.name} Residency Agreement`,
        custom_rules: "",
        owner_name: ownerName,
        is_active: true,
        rules_content: DEFAULT_RULES_TEMPLATE,
        type: "RESIDENCY",
        status: "PUBLISHED",
        version_number: 1,
        effective_from: new Date(),
        published_at: new Date(),
      },
    });

    console.log(`-> Created AgreementTemplate (ID: ${template.id}, version: ${template.version_number})`);

    // 3. For backward compatibility, also insert/sync a corresponding RuleVersion
    // Let's check if an active RuleVersion already exists for this hostel
    const existingRuleVersion = await prisma.ruleVersion.findFirst({
      where: {
        hostel_id: hostel.id,
        OR: [{ is_active: true }, { active: true }],
      },
    });

    if (!existingRuleVersion) {
      const rvId = crypto.randomUUID();
      await prisma.ruleVersion.create({
        data: {
          id: rvId,
          hostel_id: hostel.id,
          version: "v1-migration",
          title: `${hostel.name} Rules & Regulations`,
          content: DEFAULT_RULES_TEMPLATE,
          content_snapshot: DEFAULT_RULES_TEMPLATE,
          is_active: true,
          active: true,
        },
      });
      console.log(`-> Synchronized new RuleVersion for backward compatibility (ID: ${rvId})`);
    } else {
      console.log(`-> Found existing active RuleVersion (ID: ${existingRuleVersion.id}). Keeping it intact.`);
    }
  }

  console.log("\nMigration completed successfully!");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
