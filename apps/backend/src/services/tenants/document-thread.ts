/**
 * The owner ↔ tenant conversation on one KYC document.
 *
 * Stored in `identification_documents.rejection_reason` two ways, both of which
 * this module reads: a JSON array of messages (current), or a bare string
 * (legacy rows written before the thread existed). Never throws — a malformed
 * value must not take down a document list or a review action.
 *
 * The frontend has its own mirror of `parseRejectionThread`
 * (`features/owner-tenants/documents/kycDocuments.ts`); keep the two in sync.
 */

export type DocumentMessage = {
  sender: string;
  sender_name: string;
  message: string;
  timestamp: string;
};

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseRejectionThread(raw: unknown): DocumentMessage[] {
  const text = asText(raw);
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry && typeof entry === "object" && asText((entry as any).message))
        .map((entry: any) => ({
          sender: String(entry.sender ?? "owner"),
          sender_name: String(entry.sender_name ?? entry.senderName ?? "Owner"),
          message: String(entry.message),
          timestamp: String(entry.timestamp ?? ""),
        }));
    } catch {
      return [];
    }
  }

  return [{ sender: "owner", sender_name: "Owner", message: text, timestamp: "" }];
}

/** Append one message and return the JSON string to persist. */
export function appendMessage(
  raw: unknown,
  message: Omit<DocumentMessage, "timestamp"> & { timestamp?: string },
): string {
  const thread = parseRejectionThread(raw);
  thread.push({
    sender: message.sender,
    sender_name: message.sender_name,
    message: message.message,
    timestamp: message.timestamp ?? new Date().toISOString(),
  });
  return JSON.stringify(thread);
}

export function latestOwnerMessage(raw: unknown): string | null {
  const thread = parseRejectionThread(raw);
  const last = [...thread].reverse().find((m) => m.sender === "owner");
  return last?.message ?? null;
}
