import { AgreementGenerationService } from "../src/services/tenants/agreement-generation-service";

async function main() {
  const agreementId = "e1ef22bf-5f70-4003-90d8-91c39cf260bc";
  try {
    console.log(`Starting PDF generation for agreement ID: ${agreementId}`);
    const data = await AgreementGenerationService.getAgreementRenderData(agreementId);
    console.log("Fetched hostelRules categories count:", data.hostelRules?.categories?.length);
    console.log("Fetched hostelRules:", JSON.stringify(data.hostelRules, null, 2));
    const pdfUrl = await AgreementGenerationService.generateAndUploadPdf(agreementId);
    console.log(`Successfully generated and uploaded PDF. URL: ${pdfUrl}`);
  } catch (err) {
    console.error("PDF Generation failed with error:", err);
  }
}

main();

