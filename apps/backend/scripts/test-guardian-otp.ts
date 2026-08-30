import { prisma } from "../lib/db";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { activationWorkflowService } from "../src/services/tenants/activation-workflow-service";
import { authOtpService } from "../lib/services/auth/auth-otp-service";

async function runTests() {
  console.log("=== STARTING TENTANT GUARDIAN OTP ONBOARDING VALIDATION TESTS ===");

  // Cleanup any old test OTP data
  await (prisma as any).phoneVerificationOtp.deleteMany({
    where: { phone: { in: ["9988776655", "9988776654", "+919988776655", "+919988776654", "919988776655", "919988776654"] } }
  });

  const owner = await prisma.profile.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("No owner found in database");
  const room = await prisma.rooms.findFirst();
  if (!room) throw new Error("No room found in database");

  // Create a clean invitation for testing
  const tenantId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const inviteId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const testEmail = `guardian.otp.test-${crypto.randomUUID().slice(0, 8)}@example-hostel.in`;

  // Create profile first to avoid foreign key violation
  await prisma.profile.create({
    data: {
      id: profileId,
      name: "Guardian OTP Test Tenant",
      email: testEmail,
      phone: "+919876500123",
      role: "TENANT",
      is_active: true,
      phone_verified: true,
      mobile_verified: true,
      password_hash: "mocked_password_hash"
    }
  });

  const tenant = await prisma.tenants.create({
    data: {
      id: tenantId,
      profile_id: profileId,
      owner_id: owner.id,
      hostel_id: room.hostel_id,
      monthly_rent: 6000,
      joined_on: new Date(),
      billing_start_date: new Date(),
      status: "INVITED",
      advance_deposit: 2000,
      phone_1: "+919876500123",
      personal_email: testEmail,
    }
  });

  const invite = await prisma.tenant_invitations.create({
    data: {
      id: inviteId,
      tenant_id: tenantId,
      owner_id: owner.id,
      hostel_id: room.hostel_id,
      room_id: room.id,
      name: "Guardian OTP Test Tenant",
      phone: "+919876500123",
      email: testEmail,
      token: token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "PENDING"
    }
  });

  console.log(`Created test profile ${profileId}, tenant ${tenantId}, and invitation token ${token}`);

  const context = { ip: "127.0.0.1", userAgent: "test" };

  // 1. Initialize the activation context (sets up draft agreement & ruleVersion)
  const initialContext = await activationWorkflowService.getContext(token);
  const ruleVersion = await prisma.ruleVersion.findFirst({
    where: { hostel_id: room.hostel_id }
  });
  if (!ruleVersion) throw new Error("Rule version not found after getContext");

  // 2. Ensure rule acceptance record exists to complete the RULES step
  const existingAcceptance = await prisma.tenantPolicyAcceptance.findUnique({
    where: {
      tenant_id_rule_version_id: {
        tenant_id: tenantId,
        rule_version_id: ruleVersion.id
      }
    }
  });
  if (!existingAcceptance) {
    await prisma.tenantPolicyAcceptance.create({
      data: {
        tenant_id: tenantId,
        hostel_id: room.hostel_id,
        rule_version_id: ruleVersion.id,
        rules_version: ruleVersion.version,
        rules_snapshot: ruleVersion.content || {},
        typed_signature_name: "Guardian OTP Test Tenant"
      }
    });
  }

  // 3. Update the agreement status to SIGNED to complete the AGREEMENT step
  await prisma.agreement.updateMany({
    where: { tenant_id: tenantId },
    data: {
      status: "SIGNED",
      tenant_signature_url: "https://example.com/signature.png",
      tenant_signature_name: "Guardian OTP Test Tenant",
      signed_at: new Date()
    }
  });

  // Verify we are now on the PROFILE step
  const readyContext = await activationWorkflowService.getContext(token);
  console.log("Initialized onboarding state:", {
    completed_steps: readyContext.completed_steps,
    current_step: readyContext.current_step
  });

  if (readyContext.current_step !== "PROFILE") {
    throw new Error(`Expected current step to be PROFILE, got ${readyContext.current_step}`);
  }

  // Helper helper function to request and read Guardian OTP
  const getGuardianOtp = async (phone: string): Promise<string> => {
    await (prisma as any).phoneVerificationOtp.deleteMany({
      where: { phone: { in: [phone, `+91${phone}`, `91${phone}`] } }
    });
    
    await authOtpService.sendPhoneOtp({
      phone,
      purpose: "ParentVerify",
      requestIp: "127.0.0.1"
    });

    const otpFilePath = path.join(__dirname, "../latest-otp.txt");
    if (!fs.existsSync(otpFilePath)) {
      throw new Error(`OTP file not found at ${otpFilePath}`);
    }
    const otpContent = fs.readFileSync(otpFilePath, "utf8");
    const otpMatch = otpContent.match(/OTP:\s*(\d+)/);
    if (!otpMatch) throw new Error("Could not parse OTP from latest-otp.txt");
    return otpMatch[1];
  };

  const baseProfileData = {
    phone: "9876500123",
    gender: "Male",
    date_of_birth: "2000-01-01",
    photo_url: "https://example.com/photo.jpg",
    emergency_phone: "9123456789",
    profile_type: "STUDENT"
  };

  // Test Case 1: Missing Guardian Name
  try {
    console.log("Test Case 1: STUDENT profile without guardian name should fail...");
    await activationWorkflowService.mutate(token, "PROFILE", {
      ...baseProfileData,
      guardian_name: "",
      guardian_relation: "Father",
      guardian_phone: "9988776655"
    }, context);
    throw new Error("FAIL: Allowed STUDENT profile without guardian name");
  } catch (err: any) {
    if (err.message.includes("Parent/Guardian name is required")) {
      console.log("PASS: Blocked missing guardian name with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 2: Missing Guardian Relation
  try {
    console.log("Test Case 2: STUDENT profile without guardian relation should fail...");
    await activationWorkflowService.mutate(token, "PROFILE", {
      ...baseProfileData,
      guardian_name: "Test Guardian",
      guardian_relation: "",
      guardian_phone: "9988776655"
    }, context);
    throw new Error("FAIL: Allowed STUDENT profile without guardian relation");
  } catch (err: any) {
    if (err.message.includes("Parent/Guardian relationship is required")) {
      console.log("PASS: Blocked missing guardian relation with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 3: Missing Guardian Phone
  try {
    console.log("Test Case 3: STUDENT profile without guardian phone should fail...");
    await activationWorkflowService.mutate(token, "PROFILE", {
      ...baseProfileData,
      guardian_name: "Test Guardian",
      guardian_relation: "Father",
      guardian_phone: ""
    }, context);
    throw new Error("FAIL: Allowed STUDENT profile without guardian phone");
  } catch (err: any) {
    if (err.message.includes("Parent/Guardian phone number is required")) {
      console.log("PASS: Blocked missing guardian phone with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 4: Guardian Phone provided but without OTP
  try {
    console.log("Test Case 4: STUDENT profile with guardian phone but no OTP should fail...");
    await activationWorkflowService.mutate(token, "PROFILE", {
      ...baseProfileData,
      guardian_name: "Test Guardian",
      guardian_relation: "Father",
      guardian_phone: "9988776655",
      guardian_otp: ""
    }, context);
    throw new Error("FAIL: Allowed STUDENT profile with guardian phone but no OTP");
  } catch (err: any) {
    if (err.message.includes("Verification code is required")) {
      console.log("PASS: Blocked missing guardian OTP with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 5: Guardian Phone with invalid/wrong OTP
  try {
    console.log("Test Case 5: STUDENT profile with invalid guardian OTP should fail...");
    await activationWorkflowService.mutate(token, "PROFILE", {
      ...baseProfileData,
      guardian_name: "Test Guardian",
      guardian_relation: "Father",
      guardian_phone: "9988776655",
      guardian_otp: "999999"
    }, context);
    throw new Error("FAIL: Allowed STUDENT profile with invalid guardian OTP");
  } catch (err: any) {
    if (err.message.includes("Parent/Guardian mobile verification failed")) {
      console.log("PASS: Blocked invalid guardian OTP with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 6: Successful Verification and Submission (uses a different phone to avoid rate limit/verify lock)
  console.log("Test Case 6: Testing successful guardian phone verification and profile save...");
  const validOtp = await getGuardianOtp("9988776654");
  console.log(`Retrieved OTP from latest-otp.txt: ${validOtp}`);

  await activationWorkflowService.mutate(token, "PROFILE", {
    ...baseProfileData,
    guardian_name: "Test Guardian",
    guardian_relation: "Father",
    guardian_phone: "9988776654",
    guardian_otp: validOtp
  }, context);

  // Validate the updates in DB
  const updatedTenant = await prisma.tenants.findUnique({
    where: { id: tenantId }
  });

  if (!updatedTenant) throw new Error("FAIL: Tenant not found after save");
  if (updatedTenant.guardian_name !== "Test Guardian") throw new Error("FAIL: guardian_name not saved");
  if (updatedTenant.guardian_relation !== "Father") throw new Error("FAIL: guardian_relation not saved");
  if (!updatedTenant.guardian_phone || !updatedTenant.guardian_phone.includes("9988776654")) {
    throw new Error(`FAIL: guardian_phone is ${updatedTenant.guardian_phone}, expected +919988776654 / 9988776654`);
  }
  if (!updatedTenant.phone_2 || !updatedTenant.phone_2.includes("9988776654")) {
    throw new Error(`FAIL: phone_2 is ${updatedTenant.phone_2}, expected +919988776654 / 9988776654`);
  }

  console.log("PASS: Tenant DB fields (guardian_name, guardian_phone, guardian_relation, phone_2) updated successfully");
  console.log("=== ALL TENTANT GUARDIAN OTP ONBOARDING VALIDATION TESTS PASSED! ===");
}

runTests()
  .catch((error) => {
    console.error("TEST FAILED:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
