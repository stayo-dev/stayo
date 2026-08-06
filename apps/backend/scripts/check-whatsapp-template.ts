/**
 * Deploy-time gate: does the approved WhatsApp OTP template still match the
 * payload this codebase builds?
 *
 * Exit codes — 0 verified, 0 skipped/unverified (with a warning, so a Meta
 * outage cannot fail a deploy), 1 drift. Run with:
 *   npx tsx -r dotenv/config scripts/check-whatsapp-template.ts
 */
import { checkOtpTemplateContract } from "../lib/services/notifications/providers/whatsapp/otp-template-contract";
import { checkInvitationTemplateContract } from "../lib/services/notifications/providers/whatsapp/invitation-template-contract";
import { checkOnboardingTemplateContract } from "../lib/services/notifications/providers/whatsapp/onboarding-template-contract";

async function checkOne(
  label: string,
  run: () => Promise<{ status: string; templateName?: string; shape?: any; reason?: string }>
): Promise<number> {
  try {
    const result = await run();
    if (result.status === "OK") {
      console.log(
        `OK  WhatsApp ${label} template "${result.templateName}" matches the payload contract ` +
          `(body: ${result.shape.bodyParameterCount}, button: ${result.shape.buttonParameterCount})`
      );
      return 0;
    }
    if (result.status === "SKIPPED") {
      console.log(`SKIP  ${label}: ${result.reason}`);
      return 0;
    }
    console.warn(`WARN  ${label}: could not verify the template: ${result.reason}`);
    console.warn("      Not failing the deploy — a Graph API outage is not template drift.");
    return 0;
  } catch (error: any) {
    console.error(`FAIL  ${label}: ${error?.message || String(error)}`);
    return 1;
  }
}

async function main() {
  // Both templates are gated: a drift in either breaks a real user flow.
  const codes = [
    await checkOne("OTP", checkOtpTemplateContract),
    await checkOne("invitation", checkInvitationTemplateContract),
    await checkOne("onboarding-complete", checkOnboardingTemplateContract),
  ];
  return codes.some((c) => c !== 0) ? 1 : 0;
}

main().then((code) => process.exit(code));
