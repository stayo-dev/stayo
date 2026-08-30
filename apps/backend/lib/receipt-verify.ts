import crypto from "crypto";

const HMAC_SECRET = process.env.RECEIPT_VERIFY_SECRET || "sunrise-residency-verify-secret-key-2026";

export function generateVerificationToken(receiptId: string, issuedAt: Date | string): string {
  const timestamp = new Date(issuedAt).getTime().toString();
  const signature = crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${receiptId}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);
  return `${receiptId}.${timestamp}.${signature}`;
}

export function verifyToken(token: string): { valid: boolean; receiptId: string | null } {
  try {
    const [receiptId, timestamp, signature] = token.split(".");
    if (!receiptId || !timestamp || !signature) {
      return { valid: false, receiptId: null };
    }
    const expected = crypto
      .createHmac("sha256", HMAC_SECRET)
      .update(`${receiptId}:${timestamp}`)
      .digest("hex")
      .slice(0, 16);
    if (signature === expected) {
      return { valid: true, receiptId };
    }
    return { valid: false, receiptId: null };
  } catch {
    return { valid: false, receiptId: null };
  }
}
