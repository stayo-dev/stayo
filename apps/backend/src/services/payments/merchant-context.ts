import { prisma } from "@/lib/db";
import { PAYMENT_DOMAIN, PAYMENT_FLOW, PAYMENT_SCOPE, MERCHANT_CONTEXT } from "./financial-domain";
import { backendUrl, getBackendUrl } from "@/lib/config/domains";

type MaybeHostelId = string | null;

export async function getProviderContext(params: {
  paymentDomain: string;
  flowType: string;
  operationalOwnerId: string;
  financialOwnerId?: string | null;
  hostelId?: MaybeHostelId;
  scopeType: string;
}) {
  const {
    paymentDomain,
    flowType,
    operationalOwnerId,
    financialOwnerId,
    hostelId,
    scopeType,
  } = params;

  if (paymentDomain === PAYMENT_DOMAIN.PLATFORM_BILLING) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("CONFIG_ERROR: HMS platform Razorpay credentials are not configured");
    }
    return {
      provider: "RAZORPAY",
      payment_domain: PAYMENT_DOMAIN.PLATFORM_BILLING,
      flow_type: flowType,
      scope_type: PAYMENT_SCOPE.PLATFORM,
      merchant_context_type: MERCHANT_CONTEXT.HMS_PLATFORM,
      merchant_context_id: MERCHANT_CONTEXT.HMS_PLATFORM,
      operational_owner_id: operationalOwnerId,
      financial_owner_id: financialOwnerId || process.env.HMS_FINANCIAL_OWNER_ID || null,
      hostel_id: null,
      config: {
        key_id: process.env.RAZORPAY_KEY_ID || "",
        key_secret: process.env.RAZORPAY_KEY_SECRET || "",
        webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
        base_url: process.env.RAZORPAY_BASE_URL || "https://api.razorpay.com",
        callbackUrl: backendUrl("/api/webhooks/payments/razorpay"),
      },
    };
  }

  if (paymentDomain !== PAYMENT_DOMAIN.RENT_COLLECTION) {
    throw new Error(`UNSUPPORTED_PAYMENT_DOMAIN: ${paymentDomain}`);
  }
  if (scopeType !== PAYMENT_SCOPE.HOSTEL) {
    throw new Error("HOSTEL_CONTEXT_REQUIRED: rent collection provider routing requires HOSTEL scope");
  }
  if (!hostelId) {
    throw new Error("HOSTEL_CONTEXT_REQUIRED: hostelId is required for rent collection provider routing");
  }

  const hostel = await prisma.hostels.findUnique({
    where: { id: hostelId },
    include: { profiles: true },
  });

  if (!hostel || hostel.owner_id !== operationalOwnerId) {
    throw new Error("HOSTEL_ACCESS_DENIED: Payment provider hostel does not belong to this owner.");
  }

  if (![PAYMENT_FLOW.RENT, PAYMENT_FLOW.FUTURE_RENT_CREDIT, PAYMENT_FLOW.SECURITY_DEPOSIT, "ADVANCE", "DEPOSIT"].includes(flowType as any)) {
    throw new Error(`UNSUPPORTED_RENT_COLLECTION_FLOW: ${flowType}`);
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("CONFIG_ERROR: HMS treasury Razorpay credentials are not configured");
  }

  console.info("[merchant-context] HMS_TREASURY Razorpay context resolved", {
    payment_domain:           PAYMENT_DOMAIN.RENT_COLLECTION,
    merchant_context_type:    MERCHANT_CONTEXT.HMS_TREASURY,
    flow_type:                flowType,
    hostel_id:                hostelId,
    operational_owner_id:     operationalOwnerId,
    RAZORPAY_KEY_ID_set:      Boolean(process.env.RAZORPAY_KEY_ID),
    backend_url:              getBackendUrl(),
  });

  return {
    provider: "RAZORPAY",
    payment_domain: PAYMENT_DOMAIN.RENT_COLLECTION,
    flow_type: flowType,
    scope_type: PAYMENT_SCOPE.HOSTEL,
    merchant_context_type: MERCHANT_CONTEXT.HMS_TREASURY,
    merchant_context_id: MERCHANT_CONTEXT.HMS_TREASURY,
    operational_owner_id: operationalOwnerId,
    financial_owner_id: financialOwnerId || operationalOwnerId,
    hostel_id: hostel.id,
    config: {
      key_id: process.env.RAZORPAY_KEY_ID || "",
      key_secret: process.env.RAZORPAY_KEY_SECRET || "",
      webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
      base_url: process.env.RAZORPAY_BASE_URL || "https://api.razorpay.com",
      callbackUrl: backendUrl("/api/webhooks/payments/razorpay"),
      treasuryMode: true,
      hostelId: hostel.id,
      operationalOwnerId,
    },
  };
}
