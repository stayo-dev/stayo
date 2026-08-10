import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import dns from "dns";
import * as dotenv from "dotenv";
import path from "path";

// Auto-load env if not present (helps with standalone scripts under ESM resolution)
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
}

// 🌐 Global DNS Patch: systemd-resolved has broken upstream IPv6 (AAAA) resolution on this environment,
// causing getaddrinfo / dns.lookup (used by undici/fetch) to hang for 10s before timing out.
// Bypassing it by resolving supabase.co domains directly using public DNS via dns.resolve4.
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  console.warn("[DNS Patch] Failed to set DNS servers:", e);
}

const originalLookup = dns.lookup;
// @ts-ignore
dns.lookup = function (hostname: string, options: any, callback: any) {
  let cb = callback;
  let opts = options;
  if (typeof options === "function") {
    cb = options;
    opts = {};
  }
  
  const family = typeof opts === "number" ? opts : opts?.family;
  const all = opts?.all;

  if (
    hostname &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1" &&
    !hostname.endsWith(".local")
  ) {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        return originalLookup(hostname, options, callback);
      }
      if (addresses && addresses.length > 0) {
        if (all) {
          const results = addresses.map(addr => ({ address: addr, family: 4 }));
          return cb(null, results);
        } else {
          return cb(null, addresses[0], 4);
        }
      }
      return originalLookup(hostname, options, callback);
    });
    return;
  }

  return originalLookup(hostname, options, callback);
};

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// The current Prisma schema uses database-style model names for many tables
// (for example `refresh_tokens`, `rent_obligations`, `hostels`) while older
// application code still contains friendly delegate/relation names in places.
// Keep the central client permissive so deployment type checks do not fail one
// generated delegate at a time while the schema/client naming is normalized.
let dbUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "test") {
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error("CRITICAL: DATABASE_URL_TEST must be defined when running tests to prevent accidental production mutations.");
  }
  dbUrl = process.env.DATABASE_URL_TEST;
}

console.log(
  "PRISMA INITIALIZING: NODE_ENV =",
  process.env.NODE_ENV,
  "dbHost =",
  dbUrl ? dbUrl.replace(/^(postgres(?:ql)?:\/\/)[^@]*@/, "$1***:***@") : dbUrl
);
export const prisma: any =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: dbUrl,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

const delegateAliases: Record<string, string> = {
  refreshToken: "refresh_tokens",
  identityToken: "identity_tokens",
  tenant: "tenants",
  hostel: "hostels",
  room: "rooms",
  rentObligation: "rent_obligations",
  tenantBillingPlan: "tenant_billing_plans",
  paymentFrequencyChangeRequest: "payment_frequency_change_requests",
  reminderLog: "reminder_logs",
  payment: "payments",
  expense: "expenses",
  plan: "plans",
  ownerSubscription: "owner_subscriptions",
  bulkImportBatch: "bulk_import_batches",
  activityLog: "activity_logs",
  notification: "notifications",
  rentGenerationLedger: "rent_generation_ledgers",
  rentGenerationLog: "rent_generation_logs",
  tenantAdvanceLedger: "tenant_financial_ledger",
  tenant_advance_ledger: "tenant_financial_ledger",
  tenantBehaviorScore: "tenant_behavior_scores",
  reactivationRequest: "reactivation_requests",
  tenantTransferLog: "tenant_transfer_logs",
  ownerDashboardSnapshot: "owner_dashboard_snapshots",
  hostelInvariantCheck: "hostel_invariant_checks",
  receipt: "receipts",
  overflowLedger: "overflow_ledger",
  ownerUsageSnapshot: "owner_usage_snapshots",
  paymentAttemptObligation: "payment_attempt_obligations",
  usageTracking: "usage_tracking",
  roomActivityLog: "room_activity_logs",
  loginAttempt: "login_attempts",
  subscription: "subscriptions",
  autopayAttempt: "autopay_attempts",
  messageLog: "message_logs",
  messagePack: "message_packs",
  messagePacks: "message_packs",
  whatsappOwnerSession: "whatsapp_owner_sessions",
  hostelDailySnapshot: "hostel_daily_snapshots",
  ownerOnboardingState: "owner_onboarding_states",
  paymentWebhookEvent: "payment_webhook_events",
  paymentAttemptStatusEvent: "payment_attempt_status_events",
  paymentProviderVerificationSnapshot: "payment_provider_verification_snapshots",
  paymentOperationalAnomaly: "payment_operational_anomalies",
  paymentReconciliationItem: "payment_reconciliation_items",
  paymentReconciliationRun: "payment_reconciliation_runs",
  migrationAuditRun: "migration_audit_runs",
  financialInvariantFailure: "financial_invariant_failures",
  visitorLead: "visitor_leads",
  leadActivity: "lead_activities",
  roomReservation: "room_reservations",
  leadNote: "lead_notes",
};

for (const [alias, target] of Object.entries(delegateAliases)) {
  if (!prisma[alias] && prisma[target]) {
    prisma[alias] = prisma[target];
  }
}

globalForPrisma.prisma = prisma;

// Supabase Client for RPC calls (Atomic Operations)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
