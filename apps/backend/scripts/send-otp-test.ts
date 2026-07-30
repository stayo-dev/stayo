import { prisma } from "../lib/db";
import { authOtpService } from "../lib/services/auth/auth-otp-service";

async function main() {
  const phone = "8008046952";
  console.log(`Sending test OTP to ${phone} using AuthOtpService...`);
  try {
    const result = await authOtpService.sendPhoneOtp({
      phone,
      purpose: "Registration",
      requestIp: "127.0.0.1",
    });
    console.log("Success! Result returned from service:", JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error("Failed to send OTP:", error?.message || error);
    if (error?.code) {
      console.error(`Error code: ${error.code}, Status: ${error.status}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
