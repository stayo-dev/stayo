import fs from "fs";

type Scenario = "duplicate-webhook" | "invalid-signature" | "reconcile-race";

const scenario = process.argv[2] as Scenario | undefined;
const baseUrl = process.env.HMS_API_BASE_URL || "http://localhost:3000";
const webhookFile = process.env.CHAOS_WEBHOOK_FILE || "";
const webhookAuth = process.env.CHAOS_WEBHOOK_AUTH || "";
const adminBearer = process.env.CHAOS_ADMIN_BEARER || "";
const repetitions = Math.min(Math.max(Number(process.env.CHAOS_REPETITIONS || 50), 1), 200);

function requireScenario(value: Scenario | undefined): Scenario {
  if (value && ["duplicate-webhook", "invalid-signature", "reconcile-race"].includes(value)) return value;
  throw new Error("Usage: npm run chaos:payments -- <duplicate-webhook|invalid-signature|reconcile-race>");
}

function readWebhookBody() {
  if (!webhookFile) throw new Error("CHAOS_WEBHOOK_FILE is required for webhook chaos scenarios");
  return fs.readFileSync(webhookFile, "utf8");
}

async function postWebhook(body: string, authHeader: string) {
  const response = await fetch(`${baseUrl}/api/webhooks/payments/phonepe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body,
  });
  return {
    status: response.status,
    body: await response.text().catch(() => ""),
  };
}

async function postReconcile() {
  const response = await fetch(`${baseUrl}/api/payments/reconcile`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminBearer ? { authorization: `Bearer ${adminBearer}` } : {}),
    },
    body: JSON.stringify({
      paymentDomain: process.env.CHAOS_PAYMENT_DOMAIN || "PLATFORM_BILLING",
      hostelId: process.env.CHAOS_HOSTEL_ID || undefined,
      payment_ids: process.env.CHAOS_ATTEMPT_ID ? [process.env.CHAOS_ATTEMPT_ID] : undefined,
    }),
  });
  return {
    status: response.status,
    body: await response.text().catch(() => ""),
  };
}

async function duplicateWebhook() {
  const body = readWebhookBody();
  if (!webhookAuth) throw new Error("CHAOS_WEBHOOK_AUTH is required for duplicate-webhook");
  const results = await Promise.all(
    Array.from({ length: repetitions }, () => postWebhook(body, webhookAuth)),
  );
  return { scenario: "duplicate-webhook", repetitions, results };
}

async function invalidSignature() {
  const body = readWebhookBody();
  const results = await Promise.all(
    Array.from({ length: repetitions }, () => postWebhook(body, "Basic invalid")),
  );
  return { scenario: "invalid-signature", repetitions, results };
}

async function reconcileRace() {
  const body = readWebhookBody();
  if (!webhookAuth) throw new Error("CHAOS_WEBHOOK_AUTH is required for reconcile-race");
  const results = await Promise.all([
    postWebhook(body, webhookAuth),
    postReconcile(),
    postWebhook(body, webhookAuth),
    postReconcile(),
  ]);
  return { scenario: "reconcile-race", results };
}

async function main() {
  const selected = requireScenario(scenario);
  const result =
    selected === "duplicate-webhook" ? await duplicateWebhook()
    : selected === "invalid-signature" ? await invalidSignature()
    : await reconcileRace();

  const results = result.results as Array<{ status: number; body: string }>;
  const statusCounts = results.reduce((acc: Record<string, number>, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    ...result,
    status_counts: statusCounts,
    expected_follow_up: [
      "Run npm run check:financial-safety after the scenario.",
      "Inspect /api/admin/finance-ops/attempts/{id} for one settlement and ordered timeline.",
      "Inspect /api/admin/finance-ops/anomalies for duplicate/signature anomalies.",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error("payment-chaos-simulation failed", error);
  process.exitCode = 1;
});
