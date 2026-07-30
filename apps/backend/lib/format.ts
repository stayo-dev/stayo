/**
 * 🌍 Backend Format Engine — Preference-Aware Formatting
 *
 * ALL backend date, time, and currency formatting MUST go through this module.
 *
 * ❌ BANNED patterns:
 *   - new Date().toLocaleString()
 *   - toLocaleDateString("en-IN", ...)
 *   - `₹${amount}`
 *   - `Rs. ${amount}`
 *   - hardcoded "en-IN" or "en-GB"
 *
 * ✅ REQUIRED:
 *   import { formatCurrency, formatDate, ... } from "@/lib/format";
 */

import type { HostelPreferences } from "./preferences";

// ─── Currency ────────────────────────────────────────────────

const CURRENCY_MAP: Record<string, { symbol: string; locale: string }> = {
  INR: { symbol: "₹", locale: "en-IN" },
  USD: { symbol: "$", locale: "en-US" },
  EUR: { symbol: "€", locale: "de-DE" },
  GBP: { symbol: "£", locale: "en-GB" },
};

/**
 * Format a numeric amount as a currency string.
 * e.g., formatCurrency(8000, prefs) → "₹8,000" or "$8,000"
 */
export function formatCurrency(amount: number | string | null | undefined, prefs?: Partial<HostelPreferences>): string {
  const num = Number(amount);
  if (isNaN(num)) return "₹0";

  const currency = prefs?.currency || "INR";
  const info = CURRENCY_MAP[currency] || CURRENCY_MAP.INR;

  try {
    return new Intl.NumberFormat(info.locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${info.symbol}${num.toLocaleString(info.locale)}`;
  }
}

/**
 * Get just the currency symbol for a given preference set.
 */
export function getCurrencySymbol(prefs?: Partial<HostelPreferences>): string {
  const currency = prefs?.currency || "INR";
  return CURRENCY_MAP[currency]?.symbol || "₹";
}

// ─── Date / Time ─────────────────────────────────────────────

/**
 * Format a date as a short date string respecting timezone.
 * e.g., formatDate(date, prefs) → "28/04/2026" or "04/28/2026"
 */
export function formatDate(date: Date | string | null | undefined, prefs?: Partial<HostelPreferences>): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";

  const tz = prefs?.timezone || "Asia/Kolkata";
  const fmt = prefs?.date_format || "DD/MM/YYYY";

  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(d);

    const day = parts.find(p => p.type === "day")?.value || "";
    const month = parts.find(p => p.type === "month")?.value || "";
    const year = parts.find(p => p.type === "year")?.value || "";

    switch (fmt) {
      case "MM/DD/YYYY": return `${month}/${day}/${year}`;
      case "YYYY-MM-DD": return `${year}-${month}-${day}`;
      case "DD/MM/YYYY":
      default: return `${day}/${month}/${year}`;
    }
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Format a date with time: "28/04/2026, 10:26 PM" or "28/04/2026, 22:26"
 */
export function formatDateTime(date: Date | string | null | undefined, prefs?: Partial<HostelPreferences>): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";

  const tz = prefs?.timezone || "Asia/Kolkata";
  const timeFmt = prefs?.time_format || "12h";

  const dateStr = formatDate(d, prefs);

  try {
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: timeFmt === "12h",
    }).format(d);

    return `${dateStr}, ${timeStr}`;
  } catch {
    return dateStr;
  }
}

/**
 * Format a date as "Month YYYY": "April 2026"
 */
export function formatMonthYear(date: Date | string | null | undefined, prefs?: Partial<HostelPreferences>): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";

  const tz = prefs?.timezone || "Asia/Kolkata";

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toLocaleString("default", { month: "long", year: "numeric" });
  }
}

/**
 * Format a date as "DD MMM YYYY": "28 Apr 2026"
 * Used primarily in PDFs and receipts.
 */
export function formatShortDate(date: Date | string | null | undefined, prefs?: Partial<HostelPreferences>): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";

  const tz = prefs?.timezone || "Asia/Kolkata";

  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
}

/**
 * Format a date as short month label: "Jan", "Feb"
 */
export function formatShortMonth(date: Date | string | null | undefined, prefs?: Partial<HostelPreferences>): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";

  const tz = prefs?.timezone || "Asia/Kolkata";

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
    }).format(d);
  } catch {
    return d.toLocaleString("default", { month: "short" });
  }
}
