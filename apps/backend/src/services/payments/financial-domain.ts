export const PAYMENT_DOMAIN = {
  PLATFORM_BILLING: "PLATFORM_BILLING",
  RENT_COLLECTION: "RENT_COLLECTION",
} as const;

export const PAYMENT_SCOPE = {
  PLATFORM: "PLATFORM",
  OWNER: "OWNER",
  HOSTEL: "HOSTEL",
} as const;

export const PAYMENT_FLOW = {
  SUBSCRIPTION: "SUBSCRIPTION",
  ADDON: "ADDON",
  RENT: "RENT",
  FUTURE_RENT_CREDIT: "FUTURE_RENT_CREDIT",
  SECURITY_DEPOSIT: "SECURITY_DEPOSIT",
  ADVANCE: "ADVANCE",
  DEPOSIT: "DEPOSIT",
} as const;

export const MERCHANT_CONTEXT = {
  HMS_PLATFORM: "HMS_PLATFORM",
  HMS_TREASURY: "HMS_TREASURY",
} as const;

export const SETTLEMENT_STATUS = {
  NOT_APPLICABLE: "NOT_APPLICABLE",
  NOT_SETTLED: "NOT_SETTLED",
  SETTLED: "SETTLED",
  SETTLEMENT_FAILED: "SETTLEMENT_FAILED",
} as const;

export type PaymentDomain = typeof PAYMENT_DOMAIN[keyof typeof PAYMENT_DOMAIN];
export type PaymentScope = typeof PAYMENT_SCOPE[keyof typeof PAYMENT_SCOPE];
export type PaymentFlow = typeof PAYMENT_FLOW[keyof typeof PAYMENT_FLOW];

export function inferAttemptFinancialMetadata(attempt: any) {
  if (attempt?.payment_domain && attempt?.flow_type && attempt?.scope_type) {
    return {
      payment_domain: attempt.payment_domain,
      scope_type: attempt.scope_type,
      flow_type: attempt.flow_type,
      merchant_context_type: attempt.merchant_context_type,
      merchant_context_id: attempt.merchant_context_id,
      settlement_status: attempt.settlement_status,
    };
  }

  if (attempt?.invoice_id) {
    return platformBillingMetadata(PAYMENT_FLOW.SUBSCRIPTION);
  }

  if (attempt?.payment_type === "ADDON") {
    return platformBillingMetadata(PAYMENT_FLOW.ADDON);
  }

  if (attempt?.payment_type === "FUTURE_RENT_CREDIT" || attempt?.flow_type === PAYMENT_FLOW.FUTURE_RENT_CREDIT || attempt?.payment_type === "ADVANCE" || attempt?.flow_type === "ADVANCE") {
    return rentCollectionMetadata(PAYMENT_FLOW.FUTURE_RENT_CREDIT, attempt?.hostel_id);
  }

  if (attempt?.payment_type === "SECURITY_DEPOSIT" || attempt?.flow_type === PAYMENT_FLOW.SECURITY_DEPOSIT || attempt?.payment_type === "DEPOSIT" || attempt?.flow_type === "DEPOSIT") {
    return rentCollectionMetadata(PAYMENT_FLOW.SECURITY_DEPOSIT, attempt?.hostel_id);
  }

  return rentCollectionMetadata(PAYMENT_FLOW.RENT, attempt?.hostel_id);
}

export function platformBillingMetadata(flowType: string) {
  return {
    payment_domain: PAYMENT_DOMAIN.PLATFORM_BILLING,
    scope_type: PAYMENT_SCOPE.PLATFORM,
    flow_type: flowType,
    merchant_context_type: MERCHANT_CONTEXT.HMS_PLATFORM,
    merchant_context_id: MERCHANT_CONTEXT.HMS_PLATFORM,
    settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
  };
}

export function rentCollectionMetadata(flowType: string, _hostelId?: string | null | undefined) {
  return {
    payment_domain: PAYMENT_DOMAIN.RENT_COLLECTION,
    scope_type: PAYMENT_SCOPE.HOSTEL,
    flow_type: flowType,
    merchant_context_type: MERCHANT_CONTEXT.HMS_TREASURY,
    merchant_context_id: MERCHANT_CONTEXT.HMS_TREASURY,
    settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
  };
}

export function terminalSettlementStatus(status: string, settled: boolean) {
  if (settled) return SETTLEMENT_STATUS.SETTLED;
  if (["FAILED", "EXPIRED", "CANCELLED"].includes(status)) return SETTLEMENT_STATUS.NOT_APPLICABLE;
  return SETTLEMENT_STATUS.NOT_SETTLED;
}
