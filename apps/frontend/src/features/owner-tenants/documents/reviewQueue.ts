import type { PendingTenantGroup } from './kycDocuments';

/**
 * The owner's document review as a queue: one document on screen, the next one
 * the moment a decision is made.
 *
 * An owner clearing a weekend's worth of Aadhaar and ID uploads does not want
 * to tap back to a list after every decision. So the review advances by
 * itself — and it advances **locally**, from the set of documents decided in
 * this session, rather than waiting for the pending list to refetch. Waiting
 * would show the just-decided document again for a beat, which reads as the
 * tap not having worked.
 *
 * Order is the server's: tenants longest-waiting first (their move-in is the
 * one being held up), each tenant's documents together so the owner compares
 * one person's papers side by side.
 */

export interface QueueItem {
  id: string;
  docType: string;
  downloadUrl: string | null;
  uploadedAt: string | null;
  tenantId: string;
  tenantName: string;
  roomNo: string;
  hostelName: string;
  /** When this tenant's oldest pending upload arrived. */
  waitingSince: string | null;
}

export function flattenQueue(groups: PendingTenantGroup[] | undefined): QueueItem[] {
  return (groups ?? []).flatMap((g) =>
    g.documents.map((d) => ({
      id: d.id,
      docType: d.docType,
      downloadUrl: d.downloadUrl,
      uploadedAt: d.uploadedAt,
      tenantId: g.tenantId,
      tenantName: g.tenantName,
      roomNo: g.roomNo,
      hostelName: g.hostelName,
      waitingSince: g.waitingSince,
    })),
  );
}

/**
 * The document to show: the one the owner picked from "up next" if it is still
 * undecided, else the first undecided in queue order. Null means finished.
 */
export function currentItem(queue: QueueItem[], decided: ReadonlySet<string>, picked?: string | null): QueueItem | null {
  if (picked && !decided.has(picked)) {
    const chosen = queue.find((i) => i.id === picked);
    if (chosen) return chosen;
  }
  return queue.find((i) => !decided.has(i.id)) ?? null;
}

export function queueProgress(queue: QueueItem[], decided: ReadonlySet<string>) {
  const left = queue.filter((i) => !decided.has(i.id));
  return {
    remaining: left.length,
    tenants: new Set(left.map((i) => i.tenantId)).size,
    decided: queue.length - left.length,
  };
}

/** Everything still waiting, except the document on screen. */
export function upNext(queue: QueueItem[], decided: ReadonlySet<string>, currentId: string | null): QueueItem[] {
  return queue.filter((i) => !decided.has(i.id) && i.id !== currentId);
}
