import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const logger = getLogger("whatsapp-billing-intelligence");

/**
 * Next billing information for a tenant.
 */
export type NextBillingInfo = {
  obligationId: string;
  amount: number;
  remainingAmount: number;
  dueDate: Date;
  label: string;
  obligationType: string;
};

/**
 * Payment health status for a tenant.
 */
export type PaymentHealthStatus = "ON_TRACK" | "DUE_SOON" | "OVERDUE";

export type PaymentHealth = {
  status: PaymentHealthStatus;
  emoji: string;
  label: string;
  detail: string | null;
};

/**
 * Get the next unpaid obligation for a tenant.
 * Returns null if all obligations are paid.
 */
export async function getNextBillingInfo(
  tenantId: string
): Promise<NextBillingInfo | null> {
  const obligation = await prisma.rent_obligations.findFirst({
    where: {
      tenant_id: tenantId,
      status: { in: ["PENDING", "PARTIAL"] },
      is_superseded: false,
    },
    orderBy: { due_date: "asc" },
    include: {
      payments: {
        select: { amount_paid: true },
      },
    },
  });

  if (!obligation) return null;

  const totalPaid = obligation.payments.reduce(
    (sum: number, p: { amount_paid: any }) => sum + Number(p.amount_paid),
    0
  );
  const totalAmount = Number(
    (obligation as any).total_amount || obligation.amount
  );
  const remaining = Math.max(0, totalAmount - totalPaid);

  // Derive label from obligation type and installment info
  const installmentLabel = (obligation as any).installment_label;
  const obligationType = obligation.obligation_type || "RENT";
  let label: string;

  if (installmentLabel) {
    label = String(installmentLabel);
  } else if (obligationType === "SECURITY_DEPOSIT" || obligationType === "ADVANCE") {
    label = "Security Deposit";
  } else if (obligationType === "MAINTENANCE") {
    label = "Maintenance Fee";
  } else {
    label = "Monthly Rent";
  }

  return {
    obligationId: obligation.id,
    amount: totalAmount,
    remainingAmount: remaining,
    dueDate: obligation.due_date,
    label,
    obligationType,
  };
}

/**
 * Calculate payment health indicator based on overdue status.
 *
 * - 🟢 ON TRACK: No overdue, next due > 7 days away
 * - 🟡 DUE SOON: Next due within 7 days (or today)
 * - 🔴 OVERDUE: Any obligation past due date
 */
export async function getPaymentHealth(
  tenantId: string
): Promise<PaymentHealth> {
  const now = new Date();

  // Check for any overdue obligations
  const overdueCount = await prisma.rent_obligations.count({
    where: {
      tenant_id: tenantId,
      status: { in: ["PENDING", "PARTIAL"] },
      is_superseded: false,
      due_date: { lt: now },
    },
  });

  if (overdueCount > 0) {
    // Find the oldest overdue
    const oldestOverdue = await prisma.rent_obligations.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ["PENDING", "PARTIAL"] },
        is_superseded: false,
        due_date: { lt: now },
      },
      orderBy: { due_date: "asc" },
      include: {
        payments: { select: { amount_paid: true } },
      },
    });

    if (oldestOverdue) {
      const totalPaid = oldestOverdue.payments.reduce(
        (s: number, p: { amount_paid: any }) => s + Number(p.amount_paid),
        0
      );
      const totalAmt = Number(
        (oldestOverdue as any).total_amount || oldestOverdue.amount
      );
      const remaining = Math.max(0, totalAmt - totalPaid);
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(oldestOverdue.due_date).getTime()) /
          (24 * 60 * 60 * 1000)
      );

      return {
        status: "OVERDUE",
        emoji: "🔴",
        label: "OVERDUE",
        detail: `₹${formatAmount(remaining)} overdue by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}`,
      };
    }
  }

  // Check for upcoming within 7 days
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingDue = await prisma.rent_obligations.findFirst({
    where: {
      tenant_id: tenantId,
      status: { in: ["PENDING", "PARTIAL"] },
      is_superseded: false,
      due_date: { gte: now, lte: sevenDaysFromNow },
    },
    orderBy: { due_date: "asc" },
    include: {
      payments: { select: { amount_paid: true } },
    },
  });

  if (upcomingDue) {
    const totalPaid = upcomingDue.payments.reduce(
      (s: number, p: { amount_paid: any }) => s + Number(p.amount_paid),
      0
    );
    const totalAmt = Number(
      (upcomingDue as any).total_amount || upcomingDue.amount
    );
    const remaining = Math.max(0, totalAmt - totalPaid);

    return {
      status: "DUE_SOON",
      emoji: "🟡",
      label: "DUE SOON",
      detail: `₹${formatAmount(remaining)} due on ${formatDueDate(upcomingDue.due_date)}`,
    };
  }

  // All clear
  return {
    status: "ON_TRACK",
    emoji: "🟢",
    label: "ON TRACK",
    detail: null,
  };
}

// ─── Helpers ──────────────────────────────────────────

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatDueDate(date: Date | string): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
}
