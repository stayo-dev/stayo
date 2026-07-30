import { prisma } from "@/lib/db";
import {
  RecoveryValidator,
  RecoveryPlanner,
  RecoveryExecutor,
  VerificationEngine,
  AuditReportGenerator
} from "../src/services/payments/payment-recovery";
import { tenantFinancialLedgerService } from "../src/services/payments/tenant-financial-ledger-service";
import readline from "readline";

async function main() {
  const args = process.argv.slice(2);
  const paymentIdArg = args.find(a => a.startsWith("--payment-id="))?.split("=")[1] || args[args.indexOf("--payment-id") + 1];
  const forceRecovery = args.includes("--force-recovery");
  const mockRazorpay = args.includes("--mock-razorpay");
  const operator = args.find(a => a.startsWith("--operator="))?.split("=")[1] || "CLI_RECOVERY_TOOL";

  if (!paymentIdArg) {
    console.error("❌ Error: --payment-id is required. Example: --payment-id pay_T71anynq8EEFDJ");
    process.exit(1);
  }

  console.log(`🔍 Starting Recovery Process for Payment ID: ${paymentIdArg}`);

  try {
    // 1. Check duplicate settlement safety gate
    await RecoveryValidator.validateDuplicateSettlement(paymentIdArg, forceRecovery);

    // 2. Fetch Razorpay payment details (Source of Truth)
    const gatewayDetails = await RecoveryPlanner.fetchRazorpayPayment(paymentIdArg, mockRazorpay);
    console.log("\n--- Razorpay Gateway Details ---");
    console.log(`Payment ID: ${gatewayDetails.id}`);
    console.log(`Order ID  : ${gatewayDetails.order_id}`);
    console.log(`Amount    : ₹${gatewayDetails.amount}`);
    console.log(`Status    : ${gatewayDetails.status}`);
    console.log(`Notes     : ${JSON.stringify(gatewayDetails.notes)}`);

    // 3. Resolve HMS attempt
    const targetAttempt = await prisma.paymentAttempt.findFirst({
      where: {
        provider_order_id: gatewayDetails.order_id
      }
    });

    if (!targetAttempt) {
      throw new Error(`ABORT: Could not resolve target HMS payment attempt for Razorpay Order ID: ${gatewayDetails.order_id}`);
    }

    console.log("\n--- Target HMS Payment Attempt ---");
    console.log(`Attempt ID: ${targetAttempt.id}`);
    console.log(`Tenant ID : ${targetAttempt.tenant_id}`);
    console.log(`Hostel ID : ${targetAttempt.hostel_id}`);
    console.log(`Amount    : ₹${targetAttempt.amount}`);
    console.log(`Status    : ${targetAttempt.status}`);

    // 4. Validate safety gates
    RecoveryValidator.validateSafetyGates(gatewayDetails, targetAttempt);

    // 5. Query and detect candidate incorrect recovery attempt
    const incorrectSettlements = await RecoveryPlanner.findIncorrectSettlements(
      targetAttempt.tenant_id,
      gatewayDetails.order_id
    );

    const incorrectSettlement = incorrectSettlements[0] || null;

    if (incorrectSettlement) {
      console.log("\n--- Detected Incorrect Settlement to Revert ---");
      console.log(`Attempt ID    : ${incorrectSettlement.attempt.id}`);
      console.log(`Amount        : ₹${incorrectSettlement.attempt.amount}`);
      console.log(`Status        : ${incorrectSettlement.attempt.status}`);
      console.log(`Ledger Credit : ₹${incorrectSettlement.ledgerCredits[0]?.amount} (${incorrectSettlement.ledgerCredits[0]?.reason})`);
    } else {
      console.log("\n--- No Incorrect Settlement Found (Fresh Replay Only) ---");
    }

    // 6. Outstanding obligations before preview
    const outstandingBefore = await VerificationEngine.getTenantOutstanding(
      targetAttempt.tenant_id,
      targetAttempt.hostel_id
    );

    // 7. Preview allocations before execution
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: targetAttempt.tenant_id,
        status: { in: ["PENDING", "PARTIAL", "OVERDUE"] }
      },
      orderBy: { rent_month: "asc" }
    });

    let remainingPayment = gatewayDetails.amount;
    const allocationPreview: { obligationId: string; amount: number; type: string }[] = [];
    for (const ob of obligations) {
      if (remainingPayment <= 0) break;
      const obAmount = Number(ob.amount);
      const allocated = Math.min(remainingPayment, obAmount);
      allocationPreview.push({
        obligationId: ob.id,
        amount: allocated,
        type: ob.obligation_type
      });
      remainingPayment -= allocated;
    }
    const futureCreditPreview = remainingPayment > 0 ? remainingPayment : 0;

    console.log("\n--- Reconciliation & Allocation Preview ---");
    console.log(`Outstanding Before Replay: ₹${outstandingBefore}`);
    console.log("Allocations:");
    for (const p of allocationPreview) {
      console.log(`  - Obligation ${p.obligationId} (${p.type}): ₹${p.amount}`);
    }
    if (futureCreditPreview > 0) {
      console.log(`  - Future Rent Credit (Top-up): ₹${futureCreditPreview}`);
    }
    const outstandingAfterPreview = Math.max(0, outstandingBefore - allocationPreview.reduce((sum, a) => sum + a.amount, 0));
    console.log(`Outstanding After Replay (Preview): ₹${outstandingAfterPreview}`);

    // 8. Confirm execution with the operator
    console.log("\n==============================================");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("⚠️  SAFE TO APPLY THESE CORRECTIONS? (yes/no): ", resolve);
    });
    rl.close();

    if (answer.trim().toLowerCase() !== "yes" && answer.trim().toLowerCase() !== "y") {
      console.log("❌ Execution aborted by operator.");
      process.exit(0);
    }

    console.log("\n🚀 Executing Recovery & Replay Operations...");
    const { opId } = await RecoveryExecutor.execute({
      config: { paymentId: paymentIdArg, operator, forceRecovery, mockRazorpay },
      gateway: gatewayDetails,
      targetAttempt,
      incorrectSettlement
    });

    // 9. Run post-flight verification
    console.log("🔍 Running Verification Engine & Invariant Checks...");
    const verification = await VerificationEngine.verify({
      tenantId: targetAttempt.tenant_id,
      targetAttemptId: targetAttempt.id,
      incorrectAttemptId: incorrectSettlement?.attempt?.id || null,
      capturedAmount: gatewayDetails.amount,
      outstandingBefore
    });

    const updatedLedger = await tenantFinancialLedgerService.getBalance(targetAttempt.tenant_id, targetAttempt.owner_id);

    // 10. Generate Audit Report
    const correctPayments = await prisma.payments.findMany({
      where: { payment_attempt_id: targetAttempt.id }
    });

    const report = AuditReportGenerator.generate({
      opId,
      gateway: gatewayDetails,
      targetAttempt,
      incorrectAttempt: incorrectSettlement?.attempt || null,
      outstandingBefore,
      outstandingAfter: verification.outstandingAfter,
      allocations: correctPayments,
      ledgerBalance: updatedLedger.balance
    });

    console.log("\n==============================================");
    console.log("✅ P0 RECOVERY COMPLETED SUCCESSFULLY!");
    console.log(JSON.stringify(report, null, 2));

  } catch (err: any) {
    console.error(`\n❌ Error during recovery execution:`, err);
    process.exit(1);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
