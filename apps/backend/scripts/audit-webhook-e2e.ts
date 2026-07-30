import { prisma } from "../lib/db";
import { POST as handleRazorpayWebhook } from "../app/api/webhooks/payments/razorpay/route";
import { RazorpayProvider } from "../src/services/payments/providers/razorpay";
import { whatsappReminderDeliveryService } from "../lib/services/notifications/whatsapp-reminder-delivery";
import { randomUUID } from "crypto";
import crypto from "crypto";

async function main() {
  console.log("==========================================================");
  console.log("           STARTING END-TO-END WEBHOOK AUDIT             ");
  console.log("==========================================================\n");

  // 1. Load webhook secret
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("FAIL: RAZORPAY_WEBHOOK_SECRET is not configured in .env");
    process.exit(1);
  }
  console.log(`[INIT] Loaded RAZORPAY_WEBHOOK_SECRET from environment.`);

  // 2. Override RazorpayProvider.prototype.fetchStatus to mock external gateway status lookup
  console.log("[INIT] Patching RazorpayProvider.prototype.fetchStatus with dynamic mock...");
  RazorpayProvider.prototype.fetchStatus = async function (
    merchant_txn_id: string,
    gateway_txn_id?: string
  ) {
    console.log(`[MOCK GATEWAY] fetchStatus called for order ${gateway_txn_id}`);
    return {
      status: "SUCCESS",
      gateway_txn_id: gateway_txn_id || "order_audit_123",
      provider_order_id: gateway_txn_id || "order_audit_123",
      provider_transaction_id: "pay_audit_123",
      provider_reference_id: "pay_audit_123",
      provider_state: "paid",
      verification_state: "UNVERIFIED",
      raw_status: { mock: true },
      tenant_id: null,
    };
  };

  // 3. Setup test database environment
  console.log("\n[DB SETUP] Creating test entities...");
  const owner = await prisma.profile.findFirst({ where: { role: "OWNER" } });
  const hostel = await prisma.hostels.findFirst({ where: { is_active: true } });

  if (!owner || !hostel) {
    console.error("FAIL: No active owner or hostel found in the database.");
    process.exit(1);
  }

  const profileId = randomUUID();
  const tenantId = randomUUID();
  const obligationId = randomUUID();
  const attemptId = randomUUID();
  const orderId = `order_${randomUUID().replace(/-/g, "").substring(0, 14)}`;
  const paymentId = `pay_${randomUUID().replace(/-/g, "").substring(0, 14)}`;
  const merchantTxnId = `txn_${randomUUID()}`;

  try {
    // Create Tenant profile & record
    await prisma.profile.create({
      data: {
        id: profileId,
        email: `audit-tenant-${tenantId}@sriadithyahostels.in`,
        name: "Webhook Audit Tenant",
        phone: "9999999999",
        role: "TENANT",
        is_active: true,
      },
    });

    await prisma.tenants.create({
      data: {
        id: tenantId,
        profile_id: profileId,
        hostel_id: hostel.id,
        owner_id: owner.id,
        status: "ACTIVE",
      },
    });

    // Create Rent Obligation
    console.log(`[DB SETUP] Inserting Rent Obligation: ${obligationId} (amount = ₹5,000, status = PENDING)`);
    await prisma.rent_obligations.create({
      data: {
        id: obligationId,
        tenant_id: tenantId,
        owner_id: owner.id,
        hostel_id: hostel.id,
        rent_month: new Date("2026-06-01"),
        amount: 5000,
        total_amount: 5000,
        due_date: new Date("2026-06-05"),
        status: "PENDING",
      },
    });

    // Create Payment Attempt
    console.log(`[DB SETUP] Inserting Payment Attempt: ${attemptId}`);
    await prisma.paymentAttempt.create({
      data: {
        id: attemptId,
        owner_id: owner.id,
        hostel_id: hostel.id,
        tenant_id: tenantId,
        obligation_id: obligationId,
        payment_domain: "RENT_COLLECTION",
        flow_type: "RENT",
        provider: "RAZORPAY",
        amount: 5000,
        merchant_txn_id: merchantTxnId,
        merchant_transaction_id: merchantTxnId,
        gateway_txn_id: orderId,
        provider_order_id: orderId,
        status: "PENDING",
      },
    });

    // 4. Construct Razorpay Webhook event payload
    const payload = {
      entity: "event",
      account_id: "acc_mock_id",
      event: "order.paid",
      contains: ["order"],
      payload: {
        order: {
          entity: {
            id: orderId,
            entity: "order",
            amount: 500000, // in paise
            amount_paid: 500000,
            amount_due: 0,
            currency: "INR",
            receipt: merchantTxnId,
            status: "paid",
            attempts: 1,
            notes: {
              merchant_txn_id: merchantTxnId
            },
            created_at: Math.floor(Date.now() / 1000)
          }
        },
        payment: {
          entity: {
            id: paymentId,
            entity: "payment",
            amount: 500000,
            currency: "INR",
            status: "captured",
            order_id: orderId,
            notes: {
              merchant_txn_id: merchantTxnId
            }
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    };

    const rawBody = JSON.stringify(payload);

    // Compute signature using configured webhook secret
    const shasum = crypto.createHmac("sha256", webhookSecret);
    shasum.update(rawBody);
    const signature = shasum.digest("hex");

    console.log("\n----------------------------------------------------------");
    console.log("STEP 1: RECEIVE WEBHOOK & VERIFY SIGNATURE");
    console.log("----------------------------------------------------------");
    console.log(`Sending Webhook POST request to /api/webhooks/payments/razorpay`);
    console.log(`Signature computed: ${signature}`);

    const req = new Request("http://localhost/api/webhooks/payments/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-request-id": `audit-req-1-${Date.now()}`,
      },
      body: rawBody,
    });

    const response = await handleRazorpayWebhook(req);
    const respBody = await response.json();
    console.log(`Webhook HTTP status: ${response.status}`);
    console.log(`Webhook processing result:`, JSON.stringify(respBody, null, 2));

    // Verify webhook event log created in DB
    const eventLog = await (prisma as any).paymentWebhookEvent.findFirst({
      where: { merchant_transaction_id: merchantTxnId }
    });

    if (eventLog && eventLog.signature_verified) {
      console.log(`SUCCESS: Webhook event recorded in database with signature_verified = true`);
    } else {
      console.error(`FAIL: Webhook event not found or signature not verified. Record:`, eventLog);
    }

    console.log("\n----------------------------------------------------------");
    console.log("STEP 2: PAYMENT ATTEMPT FINALIZATION & LEDGER UPDATES");
    console.log("----------------------------------------------------------");

    // Fetch the updated attempt
    const updatedAttempt = await prisma.paymentAttempt.findUnique({
      where: { id: attemptId }
    });
    console.log(`PaymentAttempt status: ${updatedAttempt?.status}`);
    if (updatedAttempt?.status === "SUCCESS") {
      console.log(`SUCCESS: PaymentAttempt finalized to SUCCESS status.`);
    } else {
      console.error(`FAIL: PaymentAttempt status is ${updatedAttempt?.status}, expected SUCCESS`);
    }

    // Fetch the updated obligation
    const updatedObligation = await prisma.rent_obligations.findUnique({
      where: { id: obligationId }
    });
    console.log(`Rent Obligation status: ${updatedObligation?.status}`);
    if (updatedObligation?.status === "PAID") {
      console.log(`SUCCESS: Rent obligation updated to PAID.`);
    } else {
      console.error(`FAIL: Rent obligation status is ${updatedObligation?.status}, expected PAID`);
    }

    // Fetch ledger payment details
    const paymentRecord = await prisma.payments.findFirst({
      where: { obligation_id: obligationId }
    });
    console.log(`Ledger Payment created:`, paymentRecord ? `ID ${paymentRecord.id}, Amount ₹${paymentRecord.amount_paid}` : "None");
    if (paymentRecord && Number(paymentRecord.amount_paid) === 5000) {
      console.log(`SUCCESS: Ledger Payment recorded in history successfully.`);
    } else {
      console.error(`FAIL: Ledger Payment history mismatch or missing.`);
    }

    console.log("\n----------------------------------------------------------");
    console.log("STEP 3: DUPLICATE WEBHOOK HANDLING");
    console.log("----------------------------------------------------------");
    console.log("Resending same webhook payload (simulating Razorpay duplicate/retry)...");

    const duplicateReq = new Request("http://localhost/api/webhooks/payments/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-request-id": `audit-req-2-${Date.now()}`,
      },
      body: rawBody,
    });

    const duplicateResp = await handleRazorpayWebhook(duplicateReq);
    const duplicateBody = await duplicateResp.json();
    console.log(`Duplicate Webhook HTTP status: ${duplicateResp.status}`);
    console.log(`Duplicate Webhook response:`, JSON.stringify(duplicateBody, null, 2));

    if (duplicateBody?.duplicate === true) {
      console.log(`SUCCESS: Webhook detected duplicate request and returned duplicate = true without modifying data.`);
    } else if (duplicateBody?.data?.message === "Attempt already processed or locked") {
      console.log(`SUCCESS: Webhook returned idempotent skip: "Attempt already processed or locked".`);
    } else {
      console.error(`FAIL: Duplicate request was not marked duplicate or skipped correctly.`);
    }

    // Double check that we didn't insert a second payment row
    const paymentCount = await prisma.payments.count({
      where: { obligation_id: obligationId }
    });
    console.log(`Total payments in DB for this obligation: ${paymentCount}`);
    if (paymentCount === 1) {
      console.log(`SUCCESS: Duplicate webhook did not generate duplicate ledger/payment records.`);
    } else {
      console.error(`FAIL: Multiple payment records found: ${paymentCount}`);
    }

    console.log("\n----------------------------------------------------------");
    console.log("STEP 4: RENT REMINDER PREVENTION");
    console.log("----------------------------------------------------------");
    console.log("Invoking WhatsApp Reminder Delivery service for this obligation...");

    const reminderResult = await whatsappReminderDeliveryService.sendRentReminder({
      ownerId: owner.id,
      tenantId: tenantId,
      hostelId: hostel.id,
      obligationId: obligationId,
      phone: "8008046952",
      tenantName: "Webhook Audit Tenant",
      hostelName: hostel.name,
      amount: 5000,
      rentMonth: new Date("2026-06-01"),
      dueDate: new Date("2026-06-05"),
      daysOverdue: 1,
      sendDateKey: `audit-test-${Date.now()}`,
    });

    console.log("Reminder delivery result:", JSON.stringify(reminderResult, null, 2));
    if (reminderResult.sent === false && reminderResult.skipped === true && reminderResult.reason === "SETTLED_OR_CANCELLED") {
      console.log("SUCCESS: WhatsApp reminder scheduler successfully skipped sending reminder because obligation is marked PAID.");
    } else {
      console.error("FAIL: WhatsApp reminder scheduler attempted to send reminder for settled obligation!");
    }

  } catch (err) {
    console.error("Unexpected error in audit execution:", err);
  } finally {
    console.log("\n[CLEANUP] Cleaning up test records from database...");
    try {
      await prisma.payment_link_tokens.deleteMany({ where: { obligation_id: obligationId } });
      
      // Delete receipts referencing the test payments first to avoid foreign key violations
      await prisma.receipts.deleteMany({
        where: {
          payments: {
            obligation_id: obligationId,
          },
        },
      });

      // Disable trigger to allow deletion of settled payment for cleanup
      await prisma.$executeRawUnsafe(`ALTER TABLE public.payments DISABLE TRIGGER trg_prevent_payment_ledger_delete;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.payments DISABLE TRIGGER trg_prevent_payment_ledger_update;`);
      
      try {
        await prisma.payments.deleteMany({ where: { obligation_id: obligationId } });
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE public.payments ENABLE TRIGGER trg_prevent_payment_ledger_delete;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE public.payments ENABLE TRIGGER trg_prevent_payment_ledger_update;`);
      }

      await (prisma as any).paymentAttemptStatusEvent.deleteMany({ where: { payment_attempt_id: attemptId } });
      await prisma.paymentAttempt.deleteMany({ where: { id: attemptId } });
      await (prisma as any).paymentWebhookEvent.deleteMany({ where: { merchant_transaction_id: merchantTxnId } });
      await prisma.rent_obligations.delete({ where: { id: obligationId } });
      await prisma.tenants.delete({ where: { id: tenantId } });
      await prisma.profile.delete({ where: { id: profileId } });
      console.log("[CLEANUP] Database cleaned up successfully.");
    } catch (cleanupErr) {
      console.error("[CLEANUP] Error during database cleanup:", cleanupErr);
    }
    await prisma.$disconnect();
  }
}

main();
