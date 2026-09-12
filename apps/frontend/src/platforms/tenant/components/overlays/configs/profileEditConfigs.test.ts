import { describe, expect, it } from 'vitest';

import { aadhaarRow, buildProfileEditConfigs } from './profileEditConfigs';

/**
 * Regression cover for the Aadhaar row on Personal information.
 *
 * The row keyed entirely off `doc_number`, so it printed "Not uploaded" to
 * every tenant who had uploaded an Aadhaar — no current upload path writes
 * that column. These tests pin the distinction the row now makes: *have you
 * uploaded one* is a different question from *do we know the number*.
 */

const AADHAAR = (over: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  doc_type: 'AADHAAR',
  doc_number: null,
  document_status: 'PENDING',
  is_verified: false,
  ...over,
});

function personalRows(documents: any[]) {
  const configs = buildProfileEditConfigs({}, {}, {}, documents, null);
  const section = configs.personal_info.viewSections.find(
    (s: any) => s.kind === 'rows' && s.title === 'Government ID',
  ) as any;
  return section.rows as { label: string; value: string; mono?: boolean }[];
}

function aadhaarField(documents: any[]) {
  const configs = buildProfileEditConfigs({}, {}, {}, documents, null);
  const section = configs.personal_info.sections.find((s) => s.title === 'Government ID')!;
  return section.fields.find((f) => f.key === 'aadhaar')!;
}

describe('aadhaarRow', () => {
  it('says "Not uploaded" only when there is no document', () => {
    expect(aadhaarRow(undefined)).toEqual({ text: 'Not uploaded', mono: false, uploaded: false });
  });

  it('masks the number when one is on file', () => {
    expect(aadhaarRow(AADHAAR({ doc_number: '1234 5678 9012' }))).toEqual({
      text: 'XXXX XXXX 9012',
      mono: true,
      uploaded: true,
    });
  });

  it('reports an uploaded document that carries no number as uploaded, not missing', () => {
    expect(aadhaarRow(AADHAAR())).toEqual({
      text: 'Uploaded · Pending verification',
      mono: false,
      uploaded: true,
    });
  });

  it('reports an approved document without a number as verified', () => {
    expect(aadhaarRow(AADHAAR({ document_status: 'APPROVED', is_verified: true }))).toEqual({
      text: 'Uploaded · Verified',
      mono: false,
      uploaded: true,
    });
  });

  it('reports a rejected document as needing a re-upload', () => {
    expect(aadhaarRow(AADHAAR({ document_status: 'REJECTED' }))).toEqual({
      text: 'Rejected — upload again',
      mono: false,
      uploaded: true,
    });
  });

  it('ignores a number too short to be a real Aadhaar', () => {
    expect(aadhaarRow(AADHAAR({ doc_number: '12' })).text).toBe('Uploaded · Pending verification');
  });
});

describe('buildProfileEditConfigs — Government ID', () => {
  it('does not tell a tenant who uploaded an Aadhaar that it is not uploaded', () => {
    const [aadhaar] = personalRows([AADHAAR()]);
    expect(aadhaar.label).toBe('Aadhaar');
    expect(aadhaar.value).not.toBe('Not uploaded');
    expect(aadhaar.mono).toBe(false);
  });

  it('still says "Not uploaded" when nothing was uploaded', () => {
    const [aadhaar] = personalRows([]);
    expect(aadhaar.value).toBe('Not uploaded');
  });

  it('keeps the masked number in a mono row', () => {
    const [aadhaar] = personalRows([AADHAAR({ doc_number: '123456789012' })]);
    expect(aadhaar.value).toBe('XXXX XXXX 9012');
    expect(aadhaar.mono).toBe(true);
  });

  it('offers "Replace" rather than "Upload" once a document exists', () => {
    // ProfileEditScreen renders the Upload/Replace affordance off a truthy
    // `value`, so an uploaded-but-unnumbered document must not be blank.
    expect(aadhaarField([AADHAAR()]).value).toBe('Uploaded · Pending verification');
    expect(aadhaarField([AADHAAR()]).mono).toBe(false);
    expect(aadhaarField([]).value).toBe('');
  });

  it('renders a known number in the edit field as mono', () => {
    const field = aadhaarField([AADHAAR({ doc_number: '123456789012' })]);
    expect(field.value).toBe('XXXX XXXX 9012');
    expect(field.mono).toBe(true);
  });
});
