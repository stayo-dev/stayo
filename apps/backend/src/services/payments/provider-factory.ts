import { RazorpayProvider } from "./providers/razorpay";
import { PaymentProvider } from "./provider-base";

export class PaymentProviderFactory {
  static getProvider(name: string, config: any): PaymentProvider {
    switch (name.toUpperCase()) {
      case "RAZORPAY":
        return new RazorpayProvider(config);
      default:
        throw new Error(`Unsupported payment provider: ${name}`);
    }
  }
}
