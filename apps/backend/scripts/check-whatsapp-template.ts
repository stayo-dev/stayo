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
import { checkOwnerWelcomeTemplateContract } from "../lib/services/notifications/providers/whatsapp/owner-welcome-template-contract";
import {
  checkPlatformLeadTemplate,
  PLATFORM_LEAD_TEMPLATE_KEYS,
} from "../lib/services/notifications/providers/whatsapp/platform-lead-template-check";

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

/**
 * The five owner-acquisition funnel templates were authored by hand in
 * WhatsApp Manager rather than generated from this code, so both their shape
 * and their language can drift from what we send. A template still in review
 * is reported but never fails the run — that is a normal pre-launch state.
 */
async function checkFunnelTemplates(): Promise<number> {
  let failed = 0;

  for (const key of PLATFORM_LEAD_TEMPLATE_KEYS) {
    try {
      const result = await checkPlatformLeadTemplate(key);
      if (result.status === "OK") {
        console.log(
          `OK  funnel/${key} "${result.templateName}" (${result.language}) matches ` +
            `(body: ${result.shape.bodyParameterCount}, button: ${result.shape.buttonParameterCount})`
        );
      } else if (result.status === "PENDING_REVIEW") {
        console.warn(`WARN  funnel/${key} "${result.templateName}": ${result.reason}`);
      } else if (result.status === "SKIPPED") {
        console.log(`SKIP  funnel/${key}: ${result.reason}`);
      } else {
        console.warn(`WARN  funnel/${key}: could not verify: ${result.reason}`);
        console.warn("      Not failing — a Graph API outage is not template drift.");
      }
    } catch (error: any) {
      console.error(`FAIL  funnel/${key}: ${error?.message || String(error)}`);
      failed = 1;
    }
  }

  return failed;
}

async function main() {
  // Every template here is gated: a drift in any of them breaks a real flow.
  const codes = [
    await checkOne("OTP", checkOtpTemplateContract),
    await checkOne("invitation", checkInvitationTemplateContract),
    await checkOne("onboarding-complete", checkOnboardingTemplateContract),
    await checkOne("owner-welcome", checkOwnerWelcomeTemplateContract),
    await checkFunnelTemplates(),
  ];
  return codes.some((c) => c !== 0) ? 1 : 0;
}

main().then((code) => process.exit(code));
