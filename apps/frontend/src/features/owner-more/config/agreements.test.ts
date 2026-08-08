import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_VARIABLES,
  countClauses,
  deriveAgreementSections,
  splitByVariables,
  summarizeTemplate,
  usedVariables,
  type AgreementTemplateSummary,
  type RulesContent,
} from './agreements';

/**
 * Agreements logic, kept pure so the parts an owner would notice being wrong
 * are verifiable without a DOM: what a template card says, which variables a
 * template actually uses, and how the document preview is split for
 * highlighting.
 */
const template = (overrides: Partial<AgreementTemplateSummary> = {}): AgreementTemplateSummary => ({
  id: 't1',
  title: 'Standard Rental Agreement',
  status: 'PUBLISHED',
  version_number: 4,
  published_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-06T10:00:00.000Z',
  agreements_count: 182,
  ...overrides,
});

const rules: RulesContent = {
  categories: [
    {
      id: 'payments',
      title: '1. Fee Structure & Payment Policy',
      severity: 'important',
      highlights: ['Fees are non-refundable.'],
      rules: [
        'Students pay monthly rent of ₹{{MONTHLY_RENT}} and a deposit of ₹{{SECURITY_DEPOSIT_AMOUNT}}.',
        'Late payment attracts a fee.',
      ],
    },
    {
      id: 'facilities',
      title: '2. Accommodation & Facilities',
      severity: 'standard',
      highlights: [],
      rules: ['Wi-Fi may face interruptions.'],
    },
  ],
};

describe('summarizeTemplate', () => {
  it('describes a published template by version and tenant count', () => {
    expect(summarizeTemplate(template()).detail).toBe('v4 · 182 tenants');
  });

  it('uses the singular for a single tenant', () => {
    expect(summarizeTemplate(template({ agreements_count: 1 })).detail).toBe('v4 · 1 tenant');
  });

  it('says a published template has no tenants yet rather than showing zero', () => {
    expect(summarizeTemplate(template({ agreements_count: 0 })).detail).toBe('v4 · Not used yet');
  });

  it('describes a draft that has never been published', () => {
    const summary = summarizeTemplate(template({ status: 'DRAFT', published_at: null }));

    expect(summary.statusLabel).toBe('Draft');
    expect(summary.detail).toBe('Not yet published');
  });

  it('describes a draft of a previously published template by when it was edited', () => {
    const summary = summarizeTemplate(
      template({ status: 'DRAFT', published_at: '2026-07-01T10:00:00.000Z' }),
      new Date('2026-08-08T10:00:00.000Z'),
    );

    expect(summary.detail).toBe('Edited 2 days ago');
  });

  it('marks a published template as published', () => {
    expect(summarizeTemplate(template()).statusLabel).toBe('Published');
  });
});

describe('usedVariables', () => {
  it('finds only the variables the template actually references', () => {
    const found = usedVariables(rules);

    expect(found).toContain('MONTHLY_RENT');
    expect(found).toContain('SECURITY_DEPOSIT_AMOUNT');
    expect(found).not.toContain('TENANT_NAME');
  });

  it('never invents a variable the backend cannot fill', () => {
    // The substitution map in agreement-generation-service.ts defines exactly
    // these. A template referencing anything else would render literally, so
    // this list must not drift from the backend's.
    expect(AGREEMENT_VARIABLES).toEqual([
      'TENANT_NAME',
      'ROOM_NUMBER',
      'MONTHLY_RENT',
      'SECURITY_DEPOSIT_AMOUNT',
      'MAINTENANCE_CHARGE_AMOUNT',
      'HOSTEL_NAME',
      'OWNER_NAME',
      'JOINING_DATE',
    ]);
  });

  it('returns nothing for content with no categories', () => {
    expect(usedVariables({ categories: [] })).toEqual([]);
    expect(usedVariables(null)).toEqual([]);
  });
});

describe('splitByVariables', () => {
  it('separates variable tokens from surrounding text for highlighting', () => {
    const parts = splitByVariables('Rent of ₹{{MONTHLY_RENT}} per month');

    expect(parts).toEqual([
      { text: 'Rent of ₹', isVariable: false },
      { text: 'MONTHLY_RENT', isVariable: true },
      { text: ' per month', isVariable: false },
    ]);
  });

  it('handles text with no variables', () => {
    expect(splitByVariables('No variables here')).toEqual([
      { text: 'No variables here', isVariable: false },
    ]);
  });

  it('handles back-to-back variables', () => {
    const parts = splitByVariables('{{HOSTEL_NAME}}{{OWNER_NAME}}');

    expect(parts.filter((p) => p.isVariable).map((p) => p.text)).toEqual(['HOSTEL_NAME', 'OWNER_NAME']);
  });
});

describe('countClauses', () => {
  it('counts categories and their clauses', () => {
    const counts = countClauses(rules);

    // 3 rules + 1 highlight across 2 categories.
    expect(counts.categories).toBe(2);
    expect(counts.clauses).toBe(4);
  });

  it('counts nothing for empty content', () => {
    expect(countClauses(null)).toEqual({ categories: 0, clauses: 0 });
  });
});

describe('deriveAgreementSections', () => {
  const sections = (t = 6, drafts = 3, agreementRequired = true) =>
    deriveAgreementSections({ templateCount: t, draftCount: drafts, rules, signatureConfigured: false, agreementRequired });

  const find = (key: string) =>
    sections().flatMap((s) => s.rows).find((r) => r.key === key)!;

  it('describes templates by count and drafts', () => {
    expect(find('templates').detail).toBe('6 documents · 3 in draft');
  });

  it('flags drafts as needing attention, since an unpublished template is not in use', () => {
    expect(find('templates').state).toBe('attention');
  });

  it('marks templates configured when nothing is in draft', () => {
    const rows = deriveAgreementSections({
      templateCount: 6,
      draftCount: 0,
      rules,
      signatureConfigured: true,
      agreementRequired: true,
    }).flatMap((s) => s.rows);

    expect(rows.find((r) => r.key === 'templates')!.state).toBe('configured');
  });

  it('leads with whether an agreement is required at all', () => {
    // The first thing an owner decides: some PGs run without signed paperwork.
    expect(sections()[0].label).toBe('Requirement');
    expect(sections()[0].rows[0].key).toBe('agreement-required');
  });

  it('describes a required agreement as part of activation', () => {
    const row = sections(6, 3, true).flatMap((s) => s.rows).find((r) => r.key === 'agreement-required')!;

    expect(row.state).toBe('configured');
    expect(row.detail).toContain('sign before activation');
  });

  it('treats "not required" as a stance rather than an unfinished setup', () => {
    const row = sections(6, 3, false).flatMap((s) => s.rows).find((r) => r.key === 'agreement-required')!;

    expect(row.state).toBe('off');
    expect(row.detail).toContain('without signing');
  });

  it('reports the real variable count, not the mockup figure', () => {
    // Two of the eight are referenced by this content.
    expect(find('variables').detail).toBe('2 of 8 auto-filled fields in use');
  });

  it('flags a missing owner signature, which blocks issuing agreements', () => {
    expect(find('signatures').state).toBe('attention');
  });

  it('never renders an Aadhaar e-signature row, which does not exist', () => {
    const all = sections().flatMap((s) => s.rows);

    expect(all.some((r) => /aadhaar/i.test(r.title) || /aadhaar/i.test(r.detail))).toBe(false);
  });
});
