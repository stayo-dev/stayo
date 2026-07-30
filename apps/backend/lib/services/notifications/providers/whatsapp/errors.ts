export class WhatsAppConfigError extends Error {
  readonly code = "WHATSAPP_CONFIG_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "WhatsAppConfigError";
  }
}

export class WhatsAppValidationError extends Error {
  readonly code = "WHATSAPP_VALIDATION_ERROR";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "WhatsAppValidationError";
  }
}

export class WhatsAppProviderError extends Error {
  readonly code: string;
  readonly providerCode?: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly attempts: number;
  readonly raw?: unknown;

  constructor(params: {
    message: string;
    code: string;
    providerCode?: string;
    retryable: boolean;
    status?: number;
    attempts: number;
    raw?: unknown;
  }) {
    super(params.message);
    this.name = "WhatsAppProviderError";
    this.code = params.code;
    this.providerCode = params.providerCode;
    this.retryable = params.retryable;
    this.status = params.status;
    this.attempts = params.attempts;
    this.raw = params.raw;
  }
}
