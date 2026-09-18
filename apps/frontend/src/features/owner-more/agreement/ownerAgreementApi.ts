import api from '@lib/api-client';
import type { AgreementDocument } from '@features/agreements/document/agreementDocument';
import type { RulesContent } from '../config/agreements';
import type { AgreementVersion } from './versionHistory';

/**
 * The owner's view of their own agreement.
 *
 * Through `@lib/api-client` like every other feature wrapper — raw `fetch` or
 * `axios` here fails `check:architecture`.
 */

/** Composes the draft on the server and returns what a tenant would read. */
export async function fetchOwnerAgreementDocument(
  hostelId: string,
  rulesContent: RulesContent | null,
  versionNumber?: number,
): Promise<AgreementDocument> {
  const res = await api.post(`/owner/hostels/${hostelId}/agreement-template/document`, {
    rules_content: rulesContent ?? undefined,
    version_number: versionNumber,
  });
  // `apiResponse` spreads an object at the top level ({ success, document }).
  return res.data?.document ?? res.data?.data?.document;
}

/**
 * A sample PDF of the draft.
 *
 * This endpoint has existed since the template system was written and had
 * **zero callers** — so neither owner nor tenant could ever see the real
 * document before it was issued. It is finally wired here.
 */
export async function downloadSampleAgreementPdf(
  hostelId: string,
  rulesContent: RulesContent | null,
): Promise<Blob> {
  const res = await api.post(
    `/owner/hostels/${hostelId}/agreement-template/preview`,
    { rules_content: rulesContent ?? undefined, type: 'RESIDENCY' },
    { responseType: 'blob' },
  );
  return res.data as Blob;
}

/**
 * Every version of this hostel's agreement that was ever live, newest first.
 *
 * Bodies are deliberately not included — a list needs counts and a summary,
 * and one version's text is fetched only when the owner opens it.
 */
export async function fetchAgreementVersions(hostelId: string): Promise<AgreementVersion[]> {
  const res = await api.get(`/owner/hostels/${hostelId}/agreement-versions`);
  return res.data?.versions ?? res.data?.data?.versions ?? [];
}

/**
 * One past version's wording.
 *
 * Read-only. Reusing it is not an operation on that row: the content lands in
 * the owner's draft and is published as a *new* version through the path that
 * already exists, so the archived row — and the agreements pinned to it — are
 * never rewritten.
 */
export async function fetchAgreementVersionContent(
  hostelId: string,
  versionId: string,
): Promise<RulesContent | null> {
  const res = await api.get(`/owner/hostels/${hostelId}/agreement-versions/${versionId}`);
  const version = res.data?.version ?? res.data?.data?.version;
  return (version?.rules_content ?? null) as RulesContent | null;
}

export const ownerAgreementKeys = {
  document: (hostelId: string | null | undefined, hash: string) =>
    ['owner', 'agreement-document', hostelId, hash] as const,
  versions: (hostelId: string | null | undefined) =>
    ['owner', 'agreement-versions', hostelId] as const,
  versionContent: (hostelId: string | null | undefined, versionId: string) =>
    ['owner', 'agreement-version', hostelId, versionId] as const,
};
