/**
 * Queue shaping for the owner-document review screen.
 *
 * Two ideas drive this, both about the reviewer rather than the data:
 *
 * 1. **The owner is the unit of review, not the file.** An owner uploads
 *    Aadhaar and PAN; judging them apart means opening the same person twice
 *    and losing the cross-check between the two names.
 * 2. **A queue is repetitive**, so moving through it must be predictable —
 *    hence the explicit next/previous helpers rather than index arithmetic
 *    scattered through the component.
 *
 * Pure, so all of it is testable in the node-only environment.
 */

export type ReviewStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type AdminOwnerDocument = {
  id: string;
  doc_type: 'AADHAAR' | 'PAN' | 'PHOTO';
  file_url: string;
  mime_type: string;
  status: string;
  uploaded_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  profile: { id: string; name: string; phone: string | null; email: string | null };
};

export type OwnerGroup = {
  ownerId: string;
  ownerName: string;
  phone: string | null;
  email: string | null;
  documents: AdminOwnerDocument[];
  /** Oldest upload in the group — what the queue sorts on. */
  waitingSince: string;
};

/** Identity documents. A profile photo is not one and never gates anything. */
export const IDENTITY_DOC_TYPES = ['AADHAAR', 'PAN'] as const;

export const DOC_LABEL: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  PHOTO: 'Profile photo',
};

/**
 * Group documents by owner, oldest waiting first.
 *
 * Oldest-first is deliberate: a newest-first queue means whoever has waited
 * longest keeps getting pushed down as new uploads arrive.
 */
export function groupByOwner(documents: AdminOwnerDocument[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>();

  for (const doc of documents) {
    const ownerId = doc.profile?.id ?? 'unknown';
    const existing = groups.get(ownerId);

    if (existing) {
      existing.documents.push(doc);
      if (doc.uploaded_at < existing.waitingSince) existing.waitingSince = doc.uploaded_at;
    } else {
      groups.set(ownerId, {
        ownerId,
        ownerName: doc.profile?.name || 'Unknown owner',
        phone: doc.profile?.phone ?? null,
        email: doc.profile?.email ?? null,
        documents: [doc],
        waitingSince: doc.uploaded_at,
      });
    }
  }

  const ordered = [...groups.values()];
  for (const group of ordered) {
    // Identity documents first, photo last — it is the least consequential.
    group.documents.sort((a, b) => docRank(a.doc_type) - docRank(b.doc_type));
  }

  return ordered.sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}

function docRank(type: string): number {
  const index = (IDENTITY_DOC_TYPES as readonly string[]).indexOf(type);
  return index === -1 ? 99 : index;
}

/** How long this owner has been waiting, in plain words. */
export function waitingLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m waiting`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h waiting`;

  const days = Math.floor(hours / 24);
  return `${days}d waiting`;
}

/**
 * Waiting long enough that it should stand out in the list.
 *
 * An owner cannot go live until this is done, so a queue that quietly ages is
 * a queue that costs signups.
 */
export function isOverdue(iso: string, now: number = Date.now()): boolean {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return false;
  return now - then > 24 * 60 * 60 * 1000;
}

/** The group to select after acting on the one at `index`. */
export function nextSelection(groups: OwnerGroup[], currentIndex: number): OwnerGroup | null {
  if (groups.length === 0) return null;
  // Stay at the same position: the list shrinks under you as items are
  // cleared, so the next item slides into the slot you were already looking at.
  const target = Math.min(Math.max(0, currentIndex), groups.length - 1);
  return groups[target] ?? null;
}

export function stepSelection(groups: OwnerGroup[], currentIndex: number, delta: number): number {
  if (groups.length === 0) return 0;
  return Math.min(groups.length - 1, Math.max(0, currentIndex + delta));
}

/** Is this file something we can show inline, or only link to? */
export function previewKind(mimeType: string): 'image' | 'pdf' | 'unknown' {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'unknown';
}
