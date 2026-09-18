import api from '@lib/api-client';
import type { AgreementDocument } from '@features/agreements/document/agreementDocument';
import type { RulesContent } from '../config/agreements';

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

export const ownerAgreementKeys = {
  document: (hostelId: string | null | undefined, hash: string) =>
    ['owner', 'agreement-document', hostelId, hash] as const,
};
