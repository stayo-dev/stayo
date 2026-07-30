import { prisma } from "../lib/db";
import { interpolateRulesContent } from "../src/utils/default-rules";
import { AgreementGenerationService } from "../src/services/tenants/agreement-generation-service";

function formatAgreementDate(date: any): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

async function main() {
  console.log("Starting historical agreement patch...");

  // Find all agreements
  const agreements = await prisma.agreement.findMany({
    include: {
      tenant: {
        include: {
          profiles: true,
          room_allocations: {
            where: { is_active: true },
            include: { room: true },
          },
        },
      },
      hostel: true,
      template: true,
    },
  });

  console.log(`Found ${agreements.length} total agreements.`);

  for (const agreement of agreements) {
    const isSigned = agreement.status === "SIGNED";
    const snapshot = (agreement.content_snapshot as any) || {};
    const tenant = agreement.tenant;
    const hostel = agreement.hostel;
    const template = agreement.template;

    if (!tenant) {
      console.log(`Skipping agreement ${agreement.id} because tenant is missing.`);
      continue;
    }

    const joiningDate = snapshot.joining_date || tenant.joined_on || new Date();
    const formattedJoiningDate = formatAgreementDate(joiningDate);

    const monthlyRent = Number(snapshot.monthly_rent || tenant.monthly_rent || 0);
    const advanceDeposit = Number(snapshot.advance_deposit || tenant.security_deposit || 0);
    const maintenanceCharge = Number(snapshot.maintenance_charge || tenant.maintenance_charge || 0);
    const ownerName = snapshot.owner_name || template?.owner_name || "Hostel Owner";
    const tenantName = snapshot.tenant_name || tenant.profiles?.name || tenant.personal_email || "N/A";
    const roomNo = snapshot.room_number || tenant.room_allocations?.[0]?.room?.room_no || "N/A";
    const hostelName = snapshot.hostel_name || hostel?.name || "Hostel";

    const variables = {
      TENANT_NAME: tenantName,
      ROOM_NUMBER: roomNo,
      MONTHLY_RENT: monthlyRent,
      SECURITY_DEPOSIT_AMOUNT: advanceDeposit,
      MAINTENANCE_CHARGE_AMOUNT: maintenanceCharge,
      HOSTEL_NAME: hostelName,
      OWNER_NAME: ownerName,
      JOINING_DATE: formattedJoiningDate,
    };

    console.log(`Processing agreement ${agreement.id} (Status: ${agreement.status}) for ${tenantName}`);

    // Interpolate rules_snapshot
    const rawRules = (agreement.rules_snapshot as any);
    if (!rawRules) {
      console.log(`Agreement ${agreement.id} has no rules_snapshot.`);
      continue;
    }

    const newRulesSnapshot = interpolateRulesContent(rawRules, variables, isSigned);

    // Update content_snapshot
    const newContentSnapshot = {
      ...snapshot,
      monthly_rent: monthlyRent,
      advance_deposit: advanceDeposit,
      maintenance_charge: maintenanceCharge,
      tenant_name: tenantName,
      room_number: roomNo,
      hostel_name: hostelName,
      joining_date: formattedJoiningDate,
      interpolated_rules: interpolateRulesContent(snapshot.raw_rules || template?.rules_content || rawRules, variables, isSigned),
      hostel_rules: interpolateRulesContent(snapshot.raw_rules || template?.rules_content || rawRules, variables, isSigned),
    };

    await prisma.agreement.update({
      where: { id: agreement.id },
      data: {
        rules_snapshot: newRulesSnapshot,
        content_snapshot: newContentSnapshot,
      },
    });

    if (isSigned) {
      try {
        console.log(`Regenerating PDF for signed agreement ${agreement.id}...`);
        const pdfUrl = await AgreementGenerationService.generateAndUploadPdf(agreement.id);
        console.log(`Successfully regenerated PDF. New URL: ${pdfUrl}`);
      } catch (pdfError) {
        console.error(`Failed to regenerate PDF for ${agreement.id}:`, pdfError);
      }
    }
  }

  console.log("Historical agreement patch completed successfully!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
