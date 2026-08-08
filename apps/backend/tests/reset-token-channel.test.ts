import { describe, expect, it } from "vitest";
import { SignJWT, decodeJwt } from "jose";
import { generateResetToken, verifyResetToken } from "@/lib/auth-edge";

/**
 * Password-reset tokens gained a channel and a caller-chosen lifetime so the
 * phone/OTP reset path can mint a deliberately short-lived token (the code is
 * handed to the browser in an API response rather than mailed to an inbox),
 * while the emailed link keeps its 1-hour life.
 *
 * Back-compat matters here in a way it usually doesn't: reset links already
 * sitting in people's inboxes carry no channel claim and must keep working.
 */
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_hms_secret_key_change_me",
);

const secondsUntilExpiry = (token: string) => {
  const { exp } = decodeJwt(token);
  return (exp as number) - Math.floor(Date.now() / 1000);
};

describe("password reset token channel", () => {
  it("defaults to the email channel", async () => {
    const token = await generateResetToken("owner@example.com");

    expect(await verifyResetToken(token)).toEqual({
      email: "owner@example.com",
      channel: "email",
    });
  });

  it("defaults to a one-hour lifetime", async () => {
    const token = await generateResetToken("owner@example.com");

    expect(secondsUntilExpiry(token)).toBeGreaterThan(3500);
    expect(secondsUntilExpiry(token)).toBeLessThanOrEqual(3600);
  });

  it("records the phone channel when minted from a verified OTP", async () => {
    const token = await generateResetToken("owner@example.com", { channel: "phone" });

    expect((await verifyResetToken(token))?.channel).toBe("phone");
  });

  it("honours a caller-supplied short lifetime", async () => {
    const token = await generateResetToken("owner@example.com", { expiresIn: "5m" });

    expect(secondsUntilExpiry(token)).toBeGreaterThan(240);
    expect(secondsUntilExpiry(token)).toBeLessThanOrEqual(300);
  });

  it("treats a legacy token with no channel claim as email", async () => {
    const legacy = await new SignJWT({ email: "owner@example.com", action: "password_reset" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(SECRET);

    expect(await verifyResetToken(legacy)).toEqual({
      email: "owner@example.com",
      channel: "email",
    });
  });

  it("rejects a token minted for a different action", async () => {
    const wrongAction = await new SignJWT({ email: "owner@example.com", action: "sse" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(SECRET);

    expect(await verifyResetToken(wrongAction)).toBeNull();
  });
});
