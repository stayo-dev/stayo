export type WhatsAppTemplateLanguage = {
  code: string;
};

export type WhatsAppTemplateParameter = {
  type: "text";
  text: string;
};

export type WhatsAppTemplateComponent = {
  type: "body";
  parameters: WhatsAppTemplateParameter[];
};

export type WhatsAppTemplateMessage = {
  to: string;
  templateName: string;
  language?: WhatsAppTemplateLanguage;
  bodyParameters?: string[];
  /** Optional media header document (PDF/Image) for media template headers */
  headerDocument?: { mediaId?: string; link?: string; filename?: string };
  /** URL suffix parameters for CTA URL button components */
  buttonParameters?: string[];
};

export type WhatsAppButton = {
  id: string;
  title: string;
};

export type WhatsAppListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppListSection = {
  title: string;
  rows: WhatsAppListRow[];
};

export type WhatsAppSendResult = {
  providerMessageId: string | null;
  raw: unknown;
  attempts: number;
};

export type MetaWhatsAppErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type WhatsAppProviderConfig = {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
};

