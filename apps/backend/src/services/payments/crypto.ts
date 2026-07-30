import crypto from "crypto";

export function generateHMAC(secret: string, body: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function generateSHA256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function compareDigest(provided: string, expected: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch (e) {
    return provided === expected;
  }
}
