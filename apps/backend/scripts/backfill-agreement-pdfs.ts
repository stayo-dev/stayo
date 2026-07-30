import { prisma } from "../lib/db";
import { AgreementGenerationService } from "../src/services/tenants/agreement-generation-service";

async function main() {
  console.log("Starting backfill for SIGNED agreements with null or empty pdf_url...");

  const agreements = await prisma.agreement.findMany({
    where: {
      status: "SIGNED",
      OR: [
        { pdf_url: null },
        { pdf_url: "" }
      ]
    },
    select: {
      id: true
    }
  });

  console.log(`Found ${agreements.length} agreements to process.`);

  let succeeded = 0;
  let failed = 0;

  for (const agreement of agreements) {
    try {
      console.log(`Processing agreement ID: ${agreement.id}`);
      const pdfUrl = await AgreementGenerationService.generateAndUploadPdf(agreement.id);
      console.log(`Successfully generated PDF for ${agreement.id}: ${pdfUrl}`);
      succeeded++;
    } catch (error) {
      console.error(`Failed to generate PDF for ${agreement.id}:`, error);
      failed++;
    }
  }

  console.log(`Backfill completed. Succeeded: ${succeeded}, Failed: ${failed}`);
}

main()
  .catch(err => {
    console.error("Backfill script error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
