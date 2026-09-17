import api from '@lib/api-client';
import type { AgreementDocument } from './agreementDocument';

/**
 * The agreement document, and the record that it was read.
 *
 * Goes through `@lib/api-client` like every other feature API wrapper — raw
 * `fetch`/`axios` here fails `check:architecture`.
 */

/** Onboarding: token-authenticated, because the tenant has no account yet. */
export async function fetchActivationAgreementDocument(token: string): Promise<AgreementDocument> {
  const res = await api.get('/tenants/activate/agreement-document', { params: { token } });
  return res.data?.data?.document ?? res.data?.document;
}

/** An already-activated tenant, or the owner, re-reading an issued agreement. */
export async function fetchAgreementDocument(agreementId: string): Promise<AgreementDocument> {
  const res = await api.get(`/agreements/${agreementId}/document`);
  return res.data?.data?.document ?? res.data?.document;
}

/**
 * Records the read server-side.
 *
 * Deliberately server-side: a reload must not hand out a free pass, and the
 * evidence has to outlive the session that produced it.
 */
export async function recordAgreementRead(
  token: string,
  stage: 'opened' | 'completed',
  contentHash: string,
): Promise<void> {
  await api.post('/tenants/activate/agreement-read', { token, stage, content_hash: contentHash });
}

export const agreementDocumentKeys = {
  activation: (token: string) => ['agreement', 'document', 'activation', token] as const,
  byId: (agreementId: string) => ['agreement', 'document', agreementId] as const,
};
