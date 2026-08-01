/**
 * Deploy-time gate: does the approved WhatsApp OTP template still match the
 * payload this codebase builds?
 *
 * Exit codes — 0 verified, 0 skipped/unverified (with a warning, so a Meta
 * outage cannot fail a deploy), 1 drift. Run with:
 *   npx tsx -r dotenv/config scripts/check-whatsapp-template.ts
 */
import { checkOtpTemplateContract } from "../lib/services/notifications/providers/whatsapp/otp-template-contract";

async function main() {
  try {
    const result = await checkOtpTemplateContract();

    if (result.status === "OK") {
      console.log(
        `OK  WhatsApp OTP template "${result.templateName}" matches the payload contract ` +
          `(body: ${result.shape.bodyParameterCount}, button: ${result.shape.buttonParameterCount})`
      );
      return 0;
    }

    if (result.status === "SKIPPED") {
      console.log(`SKIP  ${result.reason}`);
      return 0;
    }

    console.warn(`WARN  could not verify the template: ${result.reason}`);
    console.warn("      Not failing the deploy — a Graph API outage is not template drift.");
    return 0;
  } catch (error: any) {
    console.error("FAIL  WhatsApp OTP template drift detected\n");
    console.error(`      ${error?.message || String(error)}`);
    return 1;
  }
}

main().then((code) => process.exit(code));
