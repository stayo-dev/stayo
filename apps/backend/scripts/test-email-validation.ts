import { prisma } from "../lib/db";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { tenantInvitationLifecycleService } from "../src/services/tenants/tenant-invitation-lifecycle-service";
import { activationWorkflowService } from "../src/services/tenants/activation-workflow-service";
import { authOtpService } from "../lib/services/auth/auth-otp-service";

async function runTests() {
  console.log("=== STARTING TENTANT EMAIL ONBOARDING VALIDATION TESTS ===");

  // Find or create test entities
  await (prisma as any).phoneVerificationOtp.deleteMany({
    where: { phone: { in: ["9876500123", "+919876500123", "919876500123"] } }
  });

  const owner = await prisma.profile.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("No owner found in database");
  const room = await prisma.rooms.findFirst();
  if (!room) throw new Error("No room found in database");

  // Create another profile to test duplicate email check
  const duplicateEmail = "duplicate-test-" + crypto.randomUUID().slice(0, 8) + "@example-hostel.in";
  const duplicateProfile = await prisma.profile.create({
    data: {
      id: crypto.randomUUID(),
      name: "Existing User",
      email: duplicateEmail,
      phone: "+919999999999",
      role: "TENANT",
      is_active: true
    }
  });
  console.log(`Created a user profile with duplicate email target: ${duplicateEmail}`);

  // Create a clean invitation for testing
  const tenantId = crypto.randomUUID();
  const inviteId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");

  const tenant = await prisma.tenants.create({
    data: {
      id: tenantId,
      owner_id: owner.id,
      hostel_id: room.hostel_id,
      monthly_rent: 6000,
      joined_on: new Date(),
      billing_start_date: new Date(),
      status: "INVITED",
      advance_deposit: 2000,
      phone_1: "+919876500123",
    }
  });

  const invite = await prisma.tenant_invitations.create({
    data: {
      id: inviteId,
      tenant_id: tenantId,
      owner_id: owner.id,
      hostel_id: room.hostel_id,
      room_id: room.id,
      name: "Verification Test Tenant",
      phone: "+919876500123",
      token: token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "PENDING"
    }
  });

  console.log(`Created test tenant ${tenantId} and invitation token ${token}`);

  // Test Case 1: Missing email
  try {
    console.log("Test Case 1: Testing missing email...");
    await tenantInvitationLifecycleService.startActivation(token, {
      phone: "+919876500123",
      password: "Password123!",
      confirm_password: "Password123!",
      email: ""
    });
    throw new Error("FAIL: Allowed activation with missing email");
  } catch (err: any) {
    if (err.message.includes("Personal email address is required")) {
      console.log("PASS: Blocked missing email with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 2: Invalid email format
  try {
    console.log("Test Case 2: Testing invalid email format...");
    await tenantInvitationLifecycleService.startActivation(token, {
      phone: "+919876500123",
      password: "Password123!",
      confirm_password: "Password123!",
      email: "invalid-email-format"
    });
    throw new Error("FAIL: Allowed activation with invalid email format");
  } catch (err: any) {
    if (err.message.includes("Enter a valid email address")) {
      console.log("PASS: Blocked invalid email with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 3: Duplicate email (already exists on another profile)
  try {
    console.log("Test Case 3: Testing duplicate email check...");
    await tenantInvitationLifecycleService.startActivation(token, {
      phone: "+919876500123",
      password: "Password123!",
      confirm_password: "Password123!",
      email: duplicateEmail
    });
    throw new Error("FAIL: Allowed activation with duplicate email");
  } catch (err: any) {
    if (err.message.includes("An account with this email address already exists")) {
      console.log("PASS: Blocked duplicate email with correct message");
    } else {
      throw err;
    }
  }

  // Test Case 4: Valid email and passwords - Activation initialization
  const validEmail = "success-test-" + crypto.randomUUID().slice(0, 8) + "@example-hostel.in";
  console.log(`Test Case 4: Activating with valid email ${validEmail}...`);
  await tenantInvitationLifecycleService.startActivation(token, {
    phone: "+919876500123",
    password: "Password123!",
    confirm_password: "Password123!",
    email: validEmail
  });
  console.log("PASS: Activation started successfully!");

  // Verify DB updates after startActivation
  const updatedInvite = await prisma.tenant_invitations.findUnique({ where: { id: inviteId } });
  const updatedProfile = await prisma.profile.findFirst({ where: { email: validEmail.toLowerCase().trim() } });
  const updatedTenant = await prisma.tenants.findUnique({ where: { id: tenantId } });

  if (!updatedProfile) {
    throw new Error("FAIL: Profile record was not created for the tenant");
  }
  console.log("PASS: Profile record created successfully with correct email address");

  if (updatedTenant?.personal_email !== validEmail.toLowerCase().trim()) {
    throw new Error(`FAIL: Tenant personal_email is ${updatedTenant?.personal_email}, expected ${validEmail}`);
  }
  console.log("PASS: Tenant record personal_email updated successfully");

  if (updatedInvite?.email !== validEmail.toLowerCase().trim()) {
    throw new Error(`FAIL: Tenant invitation email is ${updatedInvite?.email}, expected ${validEmail}`);
  }
  console.log("PASS: Tenant invitation record email updated successfully");

  // Helper helper function to request and read OTP
  const getOtp = async (): Promise<string> => {
    await (prisma as any).phoneVerificationOtp.deleteMany({
      where: { phone: { in: ["9876500123", "+919876500123", "919876500123"] } }
    });
    await authOtpService.sendPhoneOtp({
      phone: "9876500123",
      purpose: "Registration",
      requestIp: "127.0.0.1"
    });
    const otpFilePath = path.join(__dirname, "../latest-otp.txt");
    const otpContent = fs.readFileSync(otpFilePath, "utf8");
    const otpMatch = otpContent.match(/OTP:\s*(\d+)/);
    if (!otpMatch) throw new Error("Could not parse OTP from latest-otp.txt");
    return otpMatch[1];
  };

  // Test Case 5: Verification via activationWorkflowService.saveAccount
  console.log("Test Case 5: Testing saveAccount email validation and updates...");
  const updatedValidEmail = "updated-test-" + crypto.randomUUID().slice(0, 8) + "@example-hostel.in";
  
  // Verify saveAccount rejects missing email
  try {
    const otp = await getOtp();
    await activationWorkflowService.mutate(token, "ACCOUNT", {
      phone: "+919876500123",
      email: "",
      password: "Password123!",
      confirmPassword: "Password123!",
      otp: otp
    }, { ip: "127.0.0.1", userAgent: "test" });
    throw new Error("FAIL: saveAccount allowed missing email");
  } catch (err: any) {
    if (err.message.includes("Personal email address is required")) {
      console.log("PASS: saveAccount blocked missing email");
    } else {
      throw err;
    }
  }

  // Verify saveAccount rejects duplicate email
  try {
    const otp = await getOtp();
    await activationWorkflowService.mutate(token, "ACCOUNT", {
      phone: "+919876500123",
      email: duplicateEmail,
      password: "Password123!",
      confirmPassword: "Password123!",
      otp: otp
    }, { ip: "127.0.0.1", userAgent: "test" });
    throw new Error("FAIL: saveAccount allowed duplicate email");
  } catch (err: any) {
    if (err.message.includes("An account with this email address already exists")) {
      console.log("PASS: saveAccount blocked duplicate email");
    } else {
      throw err;
    }
  }

  // Verify saveAccount updates successfully with valid email
  const successOtp = await getOtp();
  await activationWorkflowService.mutate(token, "ACCOUNT", {
    phone: "+919876500123",
    email: updatedValidEmail,
    password: "Password123!",
    confirmPassword: "Password123!",
    otp: successOtp
  }, { ip: "127.0.0.1", userAgent: "test" });
  console.log("PASS: saveAccount executed successfully");

  // Verify DB states after saveAccount updates
  const finalProfile = await prisma.profile.findFirst({ where: { email: updatedValidEmail.toLowerCase().trim() } });
  const finalTenant = await prisma.tenants.findUnique({ where: { id: tenantId } });
  const finalInvite = await prisma.tenant_invitations.findUnique({ where: { id: inviteId } });

  if (!finalProfile) {
    throw new Error("FAIL: Profile email was not updated by saveAccount");
  }
  console.log("PASS: Profile email verified after saveAccount");

  if (finalTenant?.personal_email !== updatedValidEmail.toLowerCase().trim()) {
    throw new Error(`FAIL: Tenant personal_email was not updated, got ${finalTenant?.personal_email}`);
  }
  console.log("PASS: Tenant personal_email verified after saveAccount");

  if (finalInvite?.email !== updatedValidEmail.toLowerCase().trim()) {
    throw new Error(`FAIL: Invitation email was not updated, got ${finalInvite?.email}`);
  }
  console.log("PASS: Invitation email verified after saveAccount");

  // Cleanup testing entities
  await prisma.tenant_invitations.delete({ where: { id: inviteId } });
  await prisma.tenants.delete({ where: { id: tenantId } });
  await prisma.profile.delete({ where: { id: updatedProfile.id } });
  await prisma.profile.delete({ where: { id: duplicateProfile.id } });
  console.log("PASS: Test data cleanup finished successfully!");

  console.log("=== ALL TEST CASES PASSED SUCCESSFULLY ===");
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
