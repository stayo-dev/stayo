import { prisma } from "../db";
import { eventLog } from "./event-log-service";

// ─── Activation Score Weights ─────────────────────────────────────────────────
//
// These weights are the product-level definition of "what matters".
// Adjust only with intentional product reasoning.
//
const WEIGHTS = {
  ACCOUNT_CREATED:            10,
  HOSTEL_CREATED:             15,
  BILLING_CONFIGURED:         15,
  FIRST_ROOM_ADDED:           15,
  FIRST_TENANT_ADDED:         20,
  PAYMENT_SETUP_ENABLED:      10,
  FIRST_RENT_GENERATED:       15,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivationStep = keyof typeof WEIGHTS;

export type OperationalState =
  | "NEW"               // registered, no hostel
  | "HOSTEL_READY"      // hostel + billing config
  | "ROOM_READY"        // has rooms, no tenants
  | "TENANT_READY"      // has tenants, no rent
  | "RENT_ACTIVE"       // has rent obligations
  | "COLLECTING"        // has payments
  | "FULLY_OPERATIONAL"; // all 7 criteria met

export interface ActivationResult {
  owner_id:              string;
  operational_state:     OperationalState;
  activation_score:      number;          // 0–100
  completed_steps:       ActivationStep[];
  missing_steps:         ActivationStep[];
  blockers:              string[];
  recommendations:       Recommendation[];
  next_action:           Recommendation | null;
  raw: {
    has_hostel:           boolean;
    has_billing:          boolean;
    room_count:           number;
    active_tenant_count:  number;
    has_payment_setup:    boolean;
    has_rent_generated:   boolean;
    has_payments:         boolean;
    has_reminders_sent:   boolean;
    hostel_name:          string | null;
  };
}

export interface Recommendation {
  id:       string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title:    string;
  subtitle: string;
  path:     string;
  cta:      string;
  emoji:    string;
}

export interface ReadinessResult {
  status:   "READY" | "PARTIALLY_READY" | "BLOCKED";
  score:    number;
  reasons:  string[];
  blockers: string[];
}

// ─── Activation Service ───────────────────────────────────────────────────────

export class ActivationService {

  /**
   * Derive the owner's operational activation state entirely from real DB data.
   * Never trust only the UI localStorage or onboarding_step column.
   * This is the canonical source of truth for all activation-driven UI.
   */
  async deriveOperationalActivation(ownerId: string): Promise<ActivationResult> {
    // Single parallel batch — avoids N+1 queries and waterfall latency.
    const [hostelRow, roomCount, activeTenantCount, rentLedger, paymentRow, reminderRow] =
      await Promise.all([
        // Hostel + billing config
        prisma.hostels.findFirst({
          where:  { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
          select: { id: true, name: true, auto_rent_day: true, upi_id: true, phonepe_merchant_id: true },
        }),
        // Room count
        prisma.rooms.count({
          where: { hostel: { owner_id: ownerId }, is_active: true },
        }),
        // Active tenant count
        prisma.tenants.count({
          where: { owner_id: ownerId, status: "ACTIVE" },
        }),
        // Any successful rent generation ledger entry
        (prisma as any).rentGenerationLedger.findFirst({
          where:  { owner_id: ownerId, status: "COMPLETED", created_count: { gt: 0 } },
          select: { id: true, created_count: true },
        }),
        // Any payment ever recorded
        prisma.payments.findFirst({
          where:  { owner_id: ownerId },
          select: { id: true },
        }),
        // Any reminder ever sent
        prisma.reminder_logs.findFirst({
          where:  { tenant: { owner_id: ownerId } },
          select: { id: true },
        }),
      ]);

    // ── Derive boolean facts from real data ───────────────────────────────────
    const has_hostel          = Boolean(hostelRow);
    const has_billing         = Boolean(hostelRow?.auto_rent_day && hostelRow.auto_rent_day > 0);
    const has_payment_setup   = Boolean(hostelRow?.upi_id || hostelRow?.phonepe_merchant_id);
    const has_rent_generated  = Boolean(rentLedger);
    const has_payments        = Boolean(paymentRow);
    const has_reminders_sent  = Boolean(reminderRow);

    // ── Score computation ─────────────────────────────────────────────────────
    const completedSteps: ActivationStep[] = ["ACCOUNT_CREATED"]; // always true if we have an owner
    if (has_hostel)          completedSteps.push("HOSTEL_CREATED");
    if (has_billing)         completedSteps.push("BILLING_CONFIGURED");
    if (roomCount > 0)       completedSteps.push("FIRST_ROOM_ADDED");
    if (activeTenantCount > 0) completedSteps.push("FIRST_TENANT_ADDED");
    if (has_payment_setup)   completedSteps.push("PAYMENT_SETUP_ENABLED");
    if (has_rent_generated)  completedSteps.push("FIRST_RENT_GENERATED");

    const allSteps = Object.keys(WEIGHTS) as ActivationStep[];
    const missingSteps = allSteps.filter(s => !completedSteps.includes(s));

    const activation_score = completedSteps.reduce((sum, step) => sum + (WEIGHTS[step] ?? 0), 0);

    // ── Operational state ─────────────────────────────────────────────────────
    let operational_state: OperationalState;
    if (activation_score === 100)     operational_state = "FULLY_OPERATIONAL";
    else if (has_payments)            operational_state = "COLLECTING";
    else if (has_rent_generated)      operational_state = "RENT_ACTIVE";
    else if (activeTenantCount > 0)   operational_state = "TENANT_READY";
    else if (roomCount > 0)           operational_state = "ROOM_READY";
    else if (has_billing)             operational_state = "HOSTEL_READY";
    else                              operational_state = "NEW";

    // ── Blockers ──────────────────────────────────────────────────────────────
    const blockers: string[] = [];
    if (!has_hostel)         blockers.push("No hostel configured — rent generation is impossible");
    if (!has_billing)        blockers.push("Billing automation not configured — no rent will generate automatically");
    if (roomCount === 0)     blockers.push("No rooms added — tenants cannot be assigned");
    if (activeTenantCount === 0 && roomCount > 0)
                             blockers.push("No active tenants — add tenants to enable rent generation");
    if (!has_rent_generated && activeTenantCount > 0 && has_billing)
                             blockers.push("Rent has not been generated yet — trigger generation or wait for automation");

    // ── Recommendations (ordered by impact) ───────────────────────────────────
    const recommendations: Recommendation[] = [];

    if (!has_hostel) {
      recommendations.push({
        id: "setup_hostel", priority: "CRITICAL",
        title: "Set up your hostel", emoji: "🏠",
        subtitle: "Required before anything else can work",
        path: "/onboarding/hostel", cta: "Set Up Hostel",
      });
    } else if (!has_billing) {
      recommendations.push({
        id: "setup_billing", priority: "CRITICAL",
        title: "Configure rent automation", emoji: "⚡",
        subtitle: "Without this, rent won't generate automatically",
        path: "/onboarding/billing", cta: "Set Up Billing",
      });
    }

    if (has_hostel && has_billing && roomCount === 0) {
      recommendations.push({
        id: "add_room", priority: "HIGH",
        title: "Add your first room", emoji: "🚪",
        subtitle: "Rooms are required before you can add tenants",
        path: "/onboarding/rooms", cta: "Add Room",
      });
    }

    if (roomCount > 0 && activeTenantCount === 0) {
      recommendations.push({
        id: "add_tenant", priority: "HIGH",
        title: "Add your first tenant", emoji: "👤",
        subtitle: "Your rooms are ready — add tenants to start tracking rent",
        path: "/onboarding/tenant", cta: "Add Tenant",
      });
    }

    if (activeTenantCount > 0 && !has_rent_generated) {
      recommendations.push({
        id: "generate_rent", priority: "HIGH",
        title: "Generate your first rent", emoji: "📋",
        subtitle: "Tenants are set up — trigger the first rent cycle now",
        path: "/owner/payments", cta: "Generate Rent",
      });
    }

    if (!has_payment_setup) {
      recommendations.push({
        id: "setup_payments", priority: "MEDIUM",
        title: "Enable online collections", emoji: "💳",
        subtitle: "Accept UPI payments from tenants directly",
        path: "/onboarding/payments", cta: "Set Up Payments",
      });
    }

    if (has_rent_generated && !has_reminders_sent && activeTenantCount > 0) {
      recommendations.push({
        id: "send_reminders", priority: "MEDIUM",
        title: "Send your first reminder", emoji: "🔔",
        subtitle: "Owners who send reminders collect 40% faster",
        path: "/owner/payments", cta: "View Dues",
      });
    }

    const next_action = recommendations[0] ?? null;

    return {
      owner_id: ownerId,
      operational_state,
      activation_score,
      completed_steps: completedSteps,
      missing_steps: missingSteps,
      blockers,
      recommendations,
      next_action,
      raw: {
        has_hostel,
        has_billing,
        room_count: roomCount,
        active_tenant_count: activeTenantCount,
        has_payment_setup,
        has_rent_generated,
        has_payments,
        has_reminders_sent,
        hostel_name: hostelRow?.name ?? null,
      },
    };
  }

  /**
   * Compute and return the operational readiness check.
   * Used by automation pipelines before rent generation or reminder dispatch.
   */
  async checkReadiness(ownerId: string): Promise<ReadinessResult> {
    const activation = await this.deriveOperationalActivation(ownerId);
    const score = activation.activation_score;

    const reasons: string[] = [];
    const blockers: string[] = [...activation.blockers];

    if (activation.raw.has_hostel)          reasons.push("Hostel configured ✓");
    if (activation.raw.has_billing)         reasons.push("Billing automation configured ✓");
    if (activation.raw.room_count > 0)      reasons.push(`${activation.raw.room_count} room(s) added ✓`);
    if (activation.raw.active_tenant_count > 0)
                                            reasons.push(`${activation.raw.active_tenant_count} active tenant(s) ✓`);
    if (activation.raw.has_payment_setup)   reasons.push("Payment collection enabled ✓");
    if (activation.raw.has_rent_generated)  reasons.push("First rent generated ✓");

    let status: ReadinessResult["status"];
    if (blockers.length === 0)              status = "READY";
    else if (score >= 40)                   status = "PARTIALLY_READY";
    else                                    status = "BLOCKED";

    return { status, score, reasons, blockers };
  }

  /**
   * Persist the onboarding state server-side (upsert).
   * Called from the /owner/me/activation PATCH endpoint.
   */
  async persistOnboardingStep(
    ownerId:  string,
    step:     string,
    options?: { skipped?: boolean; source?: string; version?: string }
  ): Promise<void> {
    const isCompleted = step === "COMPLETED";
    const now = new Date();
    const existing = await (prisma as any).ownerOnboardingState.findUnique({
      where: { owner_id: ownerId },
      select: { skipped_steps: true },
    });

    const currentSkipped: string[] = (existing?.skipped_steps as string[]) ?? [];
    const newSkipped = options?.skipped && !currentSkipped.includes(step)
      ? [...currentSkipped, step]
      : currentSkipped;

    await (prisma as any).ownerOnboardingState.upsert({
      where: { owner_id: ownerId },
      create: {
        owner_id:                ownerId,
        onboarding_step:         step,
        onboarding_last_seen_at: now,
        onboarding_completed_at: isCompleted ? now : null,
        skipped_steps:           newSkipped,
        onboarding_source:       options?.source ?? null,
        onboarding_version:      options?.version ?? "v2",
        activation_score:        0,
        updated_at:              now,
      },
      update: {
        onboarding_step:         step,
        onboarding_last_seen_at: now,
        ...(isCompleted ? { onboarding_completed_at: now } : {}),
        skipped_steps:           newSkipped,
        updated_at:              now,
      },
    });
  }

  /**
   * Refresh the cached activation score on the onboarding state row.
   * Call this after any significant owner action (tenant added, room added, rent generated).
   */
  async refreshActivationScore(ownerId: string): Promise<number> {
    const activation = await this.deriveOperationalActivation(ownerId);
    const now = new Date();
    await (prisma as any).ownerOnboardingState.upsert({
      where: { owner_id: ownerId },
      create: {
        owner_id:                ownerId,
        onboarding_step:         activation.operational_state === "FULLY_OPERATIONAL" ? "COMPLETED" : "ACCOUNT_CREATED",
        activation_score:        activation.activation_score,
        onboarding_last_seen_at: now,
        skipped_steps:           [],
        updated_at:              now,
      },
      update: {
        activation_score: activation.activation_score,
        updated_at:       now,
        ...(activation.operational_state === "FULLY_OPERATIONAL"
          ? { onboarding_step: "COMPLETED", onboarding_completed_at: now }
          : {}),
      },
    });
    return activation.activation_score;
  }

  /**
   * Fetch the persisted onboarding state row for this owner.
   */
  async getPersistedState(ownerId: string) {
    return (prisma as any).ownerOnboardingState.findUnique({
      where: { owner_id: ownerId },
    });
  }
}

export const activationService = new ActivationService();
