export type PaymentProviderType = "RAZORPAY";

const VALID_PROVIDERS: PaymentProviderType[] = ["RAZORPAY"];

export function getActivePaymentProvider(): PaymentProviderType {
  const provider = process.env.PAYMENT_PROVIDER;
  if (!provider || provider.trim() === "") {
    return "RAZORPAY"; // default to Razorpay
  }
  const normalised = provider.trim().toUpperCase() as PaymentProviderType;
  if (!VALID_PROVIDERS.includes(normalised)) {
    throw new Error(
      `CONFIG_ERROR: PAYMENT_PROVIDER="${provider}" is not a recognised value. ` +
      `Accepted values: ${VALID_PROVIDERS.join(", ")}.`
    );
  }
  return normalised;
}

export function validatePaymentEnvironment(): void {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!keyId || keyId.trim() === "" || !keySecret || keySecret.trim() === "") {
    throw new Error(
      "PAYMENT_PROVIDER_CONFIGURATION_ERROR: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required."
    );
  }
  if (!webhookSecret || webhookSecret.trim() === "") {
    throw new Error(
      "PAYMENT_PROVIDER_CONFIGURATION_ERROR: RAZORPAY_WEBHOOK_SECRET is required."
    );
  }
  console.info(`[Payment] Razorpay configured. KEY_ID suffix: ${keyId.slice(-4)}`);
}

