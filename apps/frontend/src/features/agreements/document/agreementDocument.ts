/**
 * The agreement document, as the backend composes it.
 *
 * Mirrors `apps/backend/src/services/agreements/agreement-document.ts`. The two
 * must stay in step: this is the contract that lets the tenant's reader and the
 * generated PDF be provably the same document, and `contentHash` is what the
 * read gate records as evidence of what was read.
 */

export type SignaturePanel = {
  role: 'tenant' | 'guardian' | 'owner';
  name: string | null;
  signatureUrl: string | null;
  relation: string | null;
};

export type DocBlock =
  | { kind: 'title'; text: string; subtitle?: string }
  | { kind: 'preamble'; text: string }
  | { kind: 'facts'; rows: Array<{ label: string; value: string }> }
  | {
      kind: 'section';
      number: number;
      title: string;
      clauses: Array<{ number: string; text: string }>;
      origin: 'owner' | 'platform';
      band: 'terms' | 'rules';
      severity?: 'important' | 'standard';
    }
  | { kind: 'execution'; text: string }
  | { kind: 'signatures'; panels: SignaturePanel[] }
  | { kind: 'attestation'; text: string; verificationUrl: string | null };

export type AgreementDocument = {
  reference: string;
  contentHash: string;
  blocks: DocBlock[];
  meta: {
    hostelName: string;
    ownerName: string;
    tenantName: string;
    versionNumber: number;
    generatedAt: string;
    status: string;
  };
};

export type SectionBlock = Extract<DocBlock, { kind: 'section' }>;
