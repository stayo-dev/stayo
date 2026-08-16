import { tintForId } from '../theme/palette';

/**
 * Groups pending owner documents into one review card per owner.
 *
 * The endpoint returns one row per file, but KYC is a decision about a
 * person, not about a file: three documents from one owner are one thing to
 * review. Grouping here is what stops the sidebar badge and the screen from
 * disagreeing about the size of the backlog.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export type KycDoc = {
  id: string;
  docType: string;
  status: string;
  uploadedAt: string;
};

export type KycCard = {
  profileId: string;
  name: string;
  contact: string;
  initials: string;
  tint: string;
  docs: KycDoc[];
  latestUpload: number;
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function groupDocumentsByOwner(documents: any[]): KycCard[] {
  const byOwner = new Map<string, KycCard>();

  for (const doc of documents ?? []) {
    const profile = doc.profile ?? {};
    const profileId = String(profile.id ?? 'unknown');
    const uploadedAt = String(doc.uploaded_at ?? '');
    const uploadedMs = new Date(uploadedAt).getTime() || 0;

    let card = byOwner.get(profileId);
    if (!card) {
      const name = String(profile.name ?? 'Unnamed owner');
      card = {
        profileId,
        name,
        // Phone first: KYC follow-up is a phone call, not an email.
        contact: profile.phone || profile.email || '—',
        initials: initialsOf(name),
        tint: tintForId(profileId),
        docs: [],
        latestUpload: 0,
      };
      byOwner.set(profileId, card);
    }

    card.docs.push({
      id: String(doc.id),
      docType: String(doc.doc_type ?? 'UNKNOWN'),
      status: String(doc.status ?? 'PENDING'),
      uploadedAt,
    });
    if (uploadedMs > card.latestUpload) card.latestUpload = uploadedMs;
  }

  // Most recent submission first — the freshest queue item is the one an
  // owner is most likely waiting on right now.
  return [...byOwner.values()].sort((a, b) => b.latestUpload - a.latestUpload);
}
