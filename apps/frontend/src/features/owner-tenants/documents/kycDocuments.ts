/**
 * Owner KYC verification — the decision logic the review UI renders on top of.
 *
 * The backend has had `PATCH …/documents/:docId/verify`, `…/reject` and
 * `…/download` for a long time; the owner simply had no way to reach any of
 * them, so a tenant could upload documents that nobody could ever approve and
 * onboarding stopped dead at KYC (audit item P0-4).
 *
 * Kept pure and separate from the components so the rules that matter — which
 * documents are actionable, how the rejection thread is read back — are
 * testable without a DOM, and so the UI can't quietly disagree with the guards
 * the routes already enforce.
 */

export type ReviewDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'MISSING';

export interface RejectionMessage {
  sender: string;
  senderName: string;
  message: string;
  timestamp: string;
}

export interface ReviewDocument {
  id: string;
  docType: string;
  status: ReviewDocumentStatus;
  isActive: boolean;
  downloadUrl: string | null;
  /** Newest owner message from the rejection thread, for the card headline. */
  latestRejectionReason: string | null;
  thread: RejectionMessage[];
  uploadedAt: string | null;
}

export interface PendingTenantGroup {
  tenantId: string;
  tenantName: string;
  roomNo: string;
  hostelName: string;
  /** Oldest upload in the group — what the queue is ordered by. */
  waitingSince: string | null;
  documents: Array<{ id: string; docType: string; downloadUrl: string | null; uploadedAt: string | null }>;
}

/** The backend rejects a reason longer than this with a 400. */
export const MAX_REJECT_REASON_LENGTH = 800;

export const PENDING_VERIFICATIONS_PATH = '/owner/tenants/verifications';

const DOC_TYPE_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar Card',
  COLLEGE_ID: 'College ID',
  WORK_ID: 'Work ID',
  RENTAL_AGREEMENT: 'Rental Agreement',
};

export function documentTypeLabel(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? docType;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads `identification_documents.rejection_reason`, which the backend writes
 * two different ways: a JSON array of messages (current), or a bare string
 * (legacy rows written before the thread existed). Never throws — a malformed
 * value must not take down the document list.
 */
export function parseRejectionThread(raw: unknown): RejectionMessage[] {
  const text = asText(raw);
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry && typeof entry === 'object' && asText((entry as any).message))
        .map((entry: any) => ({
          sender: String(entry.sender ?? 'owner'),
          senderName: String(entry.sender_name ?? entry.senderName ?? 'Owner'),
          message: String(entry.message),
          timestamp: String(entry.timestamp ?? ''),
        }));
    } catch {
      return [];
    }
  }

  return [{ sender: 'owner', senderName: 'Owner', message: text, timestamp: '' }];
}

function toStatus(raw: unknown): ReviewDocumentStatus {
  const value = String(raw ?? '').toUpperCase();
  if (value === 'APPROVED' || value === 'VERIFIED') return 'VERIFIED';
  if (value === 'REJECTED') return 'REJECTED';
  if (value === 'MISSING') return 'MISSING';
  // Anything unrecognised stays PENDING — never silently "verified".
  return 'PENDING';
}

/** Normalises one `GET /api/tenants/:id/documents` row for the review UI. */
export function toReviewDocument(raw: Record<string, unknown>): ReviewDocument {
  const thread = parseRejectionThread(raw.rejection_reason);
  const lastOwnerMessage = [...thread].reverse().find((m) => m.sender === 'owner');
  const status = toStatus(raw.document_status);

  return {
    id: String(raw.id ?? ''),
    docType: String(raw.doc_type ?? ''),
    status,
    isActive: raw.is_active !== false,
    downloadUrl: asText(raw.download_url),
    latestRejectionReason: status === 'REJECTED' ? (lastOwnerMessage?.message ?? null) : null,
    thread,
    uploadedAt: asText(raw.created_at) ?? asText(raw.uploaded_at),
  };
}

/**
 * Whether Approve/Reject should be offered at all.
 *
 * Mirrors the route guards rather than duplicating their intent: an archived
 * document answers 409 and an already-approved one has nothing left to do, so
 * offering the button would only produce an error toast. A REJECTED document
 * stays actionable — the tenant may have re-uploaded against the same row.
 */
export function canActOnDocument(doc: ReviewDocument): boolean {
  if (!doc.isActive) return false;
  if (doc.status === 'VERIFIED' || doc.status === 'MISSING') return false;
  return true;
}

export function isRejectReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_REJECT_REASON_LENGTH;
}

/**
 * Turns the flat `GET /api/tenants/pending-documents` list into one card per
 * tenant, oldest wait first — an owner reviews a person, not a row, and the
 * one who has been waiting longest is the one blocking their own move-in.
 */
export function groupPendingByTenant(items: unknown): PendingTenantGroup[] {
  if (!Array.isArray(items)) return [];

  const byTenant = new Map<string, PendingTenantGroup>();

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const tenantId = String(item.tenant_id ?? '');
    if (!tenantId) continue;

    const uploadedAt = asText(item.uploaded_at) ?? asText(item.created_at);

    let group = byTenant.get(tenantId);
    if (!group) {
      group = {
        tenantId,
        tenantName: String(item.tenant_name ?? 'Tenant'),
        roomNo: String(item.room_no ?? '—'),
        hostelName: String(item.hostel_name ?? '—'),
        waitingSince: uploadedAt,
        documents: [],
      };
      byTenant.set(tenantId, group);
    }

    group.documents.push({
      id: String(item.id ?? ''),
      docType: String(item.doc_type ?? ''),
      downloadUrl: asText(item.download_url),
      uploadedAt,
    });

    if (uploadedAt && (!group.waitingSince || uploadedAt < group.waitingSince)) {
      group.waitingSince = uploadedAt;
    }
  }

  return [...byTenant.values()].sort((a, b) => {
    if (!a.waitingSince) return 1;
    if (!b.waitingSince) return -1;
    return a.waitingSince.localeCompare(b.waitingSince);
  });
}

/** Where the Home dashboard's "Verify Pending KYC" card sends the owner. */
export function pendingVerificationsRoute(tenantId?: string): string {
  return tenantId ? `${PENDING_VERIFICATIONS_PATH}?tenantId=${tenantId}` : PENDING_VERIFICATIONS_PATH;
}
