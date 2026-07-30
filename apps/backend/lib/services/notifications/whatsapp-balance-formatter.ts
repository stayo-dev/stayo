import { formatShortDate } from "@/lib/format";
import { formatAgreementStatus, AgreementDisplayInput } from "./whatsapp-agreement-formatter";
import { PaymentHealth } from "./whatsapp-billing-intelligence";

/**
 * V2 Balance Response Formatter for WhatsApp.
 *
 * Produces a rich text message with:
 * 1. Payment health indicator (🟢🟡🔴)
 * 2. Current status (outstanding + due date)
 * 3. Financial progress bar
 * 4. Lifetime summary
 * 5. Next billing info
 * 6. Agreement status
 *
 * Designed for WhatsApp's 4096-character message limit.
 */

export type BalanceFormatInput = {
  residentName: string;
  roomNumber: string;
  health: PaymentHealth;
  totalBilled: number;
  totalPaid: number;
  payableNow: number;
  futureOutstanding: number;
  lastPaymentAmount: number;
  lastPaymentDate: Date | null;
  nextGenerationDate: Date | null;
  nextDueDate: Date | null;
  expectedAmount: number | null;
  fullySettled: boolean;
  agreement: AgreementDisplayInput;
  /** Credit balance (overpayment), usually 0 */
  creditBalance?: number;
};

/**
 * Format the full V2 balance response.
 */
export function formatBalanceResponse(input: BalanceFormatInput): string {
  const sections: string[] = [];

  // ─── Health + Identity Header ───
  sections.push(formatHeader(input));

  // ─── Current Status ───
  sections.push(formatCurrentStatus(input));

  // ─── Progress Bar ───
  if (input.totalBilled > 0) {
    sections.push(formatProgress(input));
  }

  // ─── Lifetime Summary ───
  sections.push(formatLifetimeSummary(input));

  // ─── Next Billing ───
  if (input.nextGenerationDate) {
    sections.push(formatNextBilling(input));
  }

  // ─── Agreement ───
  sections.push(formatAgreement(input.agreement));

  return sections.join("\n\n");
}

// ─── Section Formatters ──────────────────────────────

function formatHeader(input: BalanceFormatInput): string {
  const healthLine = `${input.health.emoji} ${input.health.label}`;
  const identityLine = `${input.residentName} (Room ${input.roomNumber})`;

  const lines = [healthLine, identityLine];
  if (input.health.detail) {
    lines.push(input.health.detail);
  }

  return lines.join("\n");
}

function formatCurrentStatus(input: BalanceFormatInput): string {
  const lines = ["━━ Current Status ━━"];

  if (input.payableNow > 0) {
    lines.push(`Outstanding: ₹${money(input.payableNow)}`);

    if (input.nextDueDate) {
      lines.push(`Due Date: ${formatShortDate(input.nextDueDate)}`);
    }

    // Status badge
    if (input.health.status === "OVERDUE") {
      lines.push("Status: 🔴 Overdue");
    } else if (input.health.status === "DUE_SOON") {
      lines.push("Status: 🟡 Due Soon");
    } else {
      lines.push("Status: 🟢 On Track");
    }
  } else if (input.fullySettled) {
    lines.push("Outstanding: ₹0");
    lines.push("Status: 🟢 Fully Settled");
  } else {
    // State 2: Nothing Due Right Now
    lines.push("Outstanding: ₹0");
    lines.push("Status: 🟢 Nothing Due Right Now");
    if (input.nextGenerationDate) {
      lines.push(`Next Billing: ₹${money(input.expectedAmount ?? 0)} on ${formatShortDate(input.nextGenerationDate)}`);
    }
  }

  return lines.join("\n");
}

function formatProgress(input: BalanceFormatInput): string {
  const paidRatio =
    input.totalBilled > 0
      ? Math.min(1, Math.max(0, input.totalPaid / input.totalBilled))
      : 0;
  const pct = Math.round(paidRatio * 100);
  const bar = buildProgressBar(paidRatio, 10);

  const lines = [
    "━━ Progress ━━",
    `${bar} ${pct}%`,
    `Paid: ₹${money(input.totalPaid)} | Remaining: ₹${money(input.futureOutstanding)}`,
  ];

  return lines.join("\n");
}

function formatLifetimeSummary(input: BalanceFormatInput): string {
  const credit = input.creditBalance || 0;
  const lines = [
    "━━ Lifetime Summary ━━",
    `Total Paid: ₹${money(input.totalPaid)}`,
  ];

  if (credit > 0) {
    lines.push(`Credit Balance: ₹${money(credit)}`);
  }

  if (input.lastPaymentDate && input.lastPaymentAmount > 0) {
    lines.push(
      `Last Payment: ₹${money(input.lastPaymentAmount)} on ${formatShortDate(input.lastPaymentDate)}`
    );
  }

  return lines.join("\n");
}

function formatNextBilling(input: BalanceFormatInput): string {
  if (!input.nextGenerationDate) return "";

  const lines = [
    "━━ Next Billing ━━",
    `Expected: ₹${money(input.expectedAmount ?? 0)}`,
    `Generation: ${formatShortDate(input.nextGenerationDate)}`,
  ];
  if (input.nextDueDate) {
    lines.push(`Due Date: ${formatShortDate(input.nextDueDate)}`);
  }

  return lines.join("\n");
}

function formatAgreement(agreement: AgreementDisplayInput): string {
  const display = formatAgreementStatus(agreement);
  return `━━ Agreement ━━\n${display.text}`;
}

// ─── Helpers ─────────────────────────────────────────

function money(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Build a progress bar: "███████░░░"
 * @param ratio 0–1 ratio of completion
 * @param width number of blocks (default 10)
 */
function buildProgressBar(ratio: number, width = 10): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
