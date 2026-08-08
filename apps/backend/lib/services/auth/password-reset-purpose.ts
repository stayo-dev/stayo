/**
 * The OTP purpose used by the phone leg of password reset.
 *
 * Kept in its own module so the constant is shared by the service, the API
 * routes and the tests without pulling `auth-otp-service` (and therefore
 * Prisma) into anything that only needs the string.
 *
 * Security note: this purpose must NEVER be added to
 * `SKIPPABLE_OTP_PURPOSES` in phone-verification-mode.ts. Those purposes
 * degrade to "no code required" when WhatsApp is unconfigured, which is
 * acceptable for signup phone verification but would make password reset a
 * way to take over any account by phone number alone. There is a test
 * asserting exactly this.
 */
export const PASSWORD_RESET_OTP_PURPOSE = "PASSWORD_RESET";
