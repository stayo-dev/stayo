// `payments.payment_method` is a free-form string, not a Prisma enum (see
// CLAUDE.md — "many database statuses are plain strings"). This maps the
// known values to owner/tenant-facing copy; anything unrecognized falls back
// to a title-cased version of the raw value instead of showing it verbatim.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK: "Bank Transfer",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  CHEQUE: "Cheque",
  ONLINE: "Online Payment",
  PHONEPE: "PhonePe",
  RAZORPAY: "Razorpay",
  NET_BANKING: "Net Banking",
  WALLET: "Wallet",
  ADVANCE_ADJUSTMENT: "Advance Credit Applied",
};

export function paymentMethodLabel(method?: string | null): string {
  if (!method) return "Payment";
  const key = String(method).toUpperCase();
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  return key
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
