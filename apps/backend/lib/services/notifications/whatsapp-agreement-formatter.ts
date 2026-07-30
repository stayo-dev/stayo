import { formatShortDate } from "@/lib/format";

/**
 * Smart agreement formatter for WhatsApp.
 * Never shows "N/A" for dates — uses contextual formatting based on agreement type.
 */

export type AgreementDisplayInput = {
  startDate: Date | string | null;
  endDate: Date | string | null;
  billingFrequency?: string | null; // "MONTHLY" | "QUARTERLY" | "YEARLY" etc.
  moveOutDate?: Date | string | null;
  status?: string | null; // tenant status: "ACTIVE", "INVITED" etc.
};

export type AgreementDisplay = {
  lines: string[];
  text: string;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function monthsBetween(start: Date, end: Date): number {
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  return Math.max(1, months);
}

function formatFrequency(freq: string | null | undefined): string {
  if (!freq) return "Monthly";
  const normalized = String(freq).toUpperCase();
  if (normalized === "QUARTERLY") return "Quarterly";
  if (normalized === "YEARLY" || normalized === "ANNUAL") return "Yearly";
  if (normalized === "HALF_YEARLY" || normalized === "SEMI_ANNUAL") return "Half-Yearly";
  return "Monthly";
}

/**
 * Format agreement/contract information for WhatsApp display.
 *
 * Rules:
 * - Monthly agreements (no end_date): Show start date + billing frequency + status
 * - Fixed-term (has end_date): Show date range + duration + status
 * - Move-out scheduled: Show range with move-out status
 * - NEVER show "N/A" for any date
 */
export function formatAgreementStatus(input: AgreementDisplayInput): AgreementDisplay {
  const start = toDate(input.startDate);
  const end = toDate(input.endDate);
  const moveOut = toDate(input.moveOutDate);
  const lines: string[] = [];

  // ─── Move-Out Scheduled ───
  if (moveOut && start) {
    lines.push(`${formatShortDate(start)} → ${formatShortDate(moveOut)}`);
    lines.push("");
    lines.push(`Status: Move-Out Scheduled`);
    return { lines, text: lines.join("\n") };
  }

  // ─── Fixed-Term Agreement ───
  if (start && end) {
    const months = monthsBetween(start, end);
    lines.push(`${formatShortDate(start)} → ${formatShortDate(end)}`);
    lines.push("");
    lines.push(`Duration: ${months} Month${months !== 1 ? "s" : ""}`);
    lines.push(`Status: Active`);
    return { lines, text: lines.join("\n") };
  }

  // ─── Monthly / Open-Ended Agreement ───
  if (start) {
    lines.push(`Started: ${formatShortDate(start)}`);
    lines.push("");
    lines.push(`Billing: ${formatFrequency(input.billingFrequency)}`);
    lines.push(`Status: Active`);
    return { lines, text: lines.join("\n") };
  }

  // ─── Fallback (no start date at all — should not happen) ───
  lines.push(`Status: Active`);
  return { lines, text: lines.join("\n") };
}
