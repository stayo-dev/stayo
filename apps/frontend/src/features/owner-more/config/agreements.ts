import { UNAVAILABLE_LABEL, type ConfigRow } from './configRows';
import type { ConfigSection } from './deriveConfigSections';

/**
 * Agreements logic for the Configuration module: template summaries, the
 * variable set, and clause counting.
 *
 * Pure by design — the things an owner would notice being wrong (a wrong tenant
 * count, a variable claimed as auto-filled that the backend cannot fill, a
 * preview that highlights the wrong span) are all decided here and tested
 * without a DOM.
 */

/**
 * The complete substitution map from
 * `src/services/tenants/agreement-generation-service.ts` — eight variables, not
 * the mockup's eighteen. A template referencing anything outside this list
 * renders the token literally in the tenant's agreement, so this must not drift
 * from the backend.
 */
export const AGREEMENT_VARIABLES = [
  'TENANT_NAME',
  'ROOM_NUMBER',
  'MONTHLY_RENT',
  'SECURITY_DEPOSIT_AMOUNT',
  'MAINTENANCE_CHARGE_AMOUNT',
  'HOSTEL_NAME',
  'OWNER_NAME',
  'JOINING_DATE',
] as const;

export type AgreementVariable = (typeof AGREEMENT_VARIABLES)[number];

export interface RulesCategory {
  id: string;
  title: string;
  /** Stored as `important` | `standard` — surfaced as-is, not remapped. */
  severity?: string;
  highlights?: string[];
  rules?: string[];
  /** Absent means included: existing templates predate this flag. */
  enabled?: boolean;
}

export interface RulesContent {
  categories?: RulesCategory[];
  terms_and_conditions?: unknown;
}

export interface AgreementTemplateSummary {
  id: string;
  title: string;
  status: string;
  version_number: number;
  published_at: string | null;
  updated_at: string;
  agreements_count: number;
}

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

function daysAgo(from: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 86_400_000));
}

/**
 * The card line for one template.
 *
 * A published template with no agreements says "Not used yet" rather than
 * "0 tenants" — the zero reads like a fault when it usually means the template
 * is simply new.
 */
export function summarizeTemplate(
  template: AgreementTemplateSummary,
  now: Date = new Date(),
): { statusLabel: string; detail: string; isDraft: boolean } {
  const isDraft = template.status !== 'PUBLISHED';

  if (isDraft) {
    const detail = template.published_at
      ? (() => {
          const days = daysAgo(template.updated_at, now);
          if (days === 0) return 'Edited today';
          if (days === 1) return 'Edited yesterday';
          return `Edited ${days} days ago`;
        })()
      : 'Not yet published';
    return { statusLabel: 'Draft', detail, isDraft: true };
  }

  const usage =
    template.agreements_count > 0 ? plural(template.agreements_count, 'tenant') : 'Not used yet';
  return { statusLabel: 'Published', detail: `v${template.version_number} · ${usage}`, isDraft: false };
}

const VARIABLE_PATTERN = /\{\{([A-Z_]+)\}\}/g;

/** Every category's text, flattened — highlights and rules alike. */
function allText(rules: RulesContent | null | undefined): string[] {
  return (rules?.categories ?? []).flatMap((category) => [
    ...(category.highlights ?? []),
    ...(category.rules ?? []),
  ]);
}

/** Which of the known variables this template actually references, in declaration order. */
export function usedVariables(rules: RulesContent | null | undefined): AgreementVariable[] {
  const text = allText(rules).join('\n');
  const found = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) found.add(match[1]);
  return AGREEMENT_VARIABLES.filter((variable) => found.has(variable));
}

/** Splits text into plain and variable spans so the preview can highlight tokens. */
export function splitByVariables(text: string): Array<{ text: string; isVariable: boolean }> {
  const parts: Array<{ text: string; isVariable: boolean }> = [];
  let cursor = 0;

  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), isVariable: false });
    parts.push({ text: match[1], isVariable: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), isVariable: false });

  return parts.length > 0 ? parts : [{ text, isVariable: false }];
}

export function countClauses(rules: RulesContent | null | undefined): {
  categories: number;
  clauses: number;
} {
  const categories = rules?.categories ?? [];
  return {
    categories: categories.length,
    clauses: categories.reduce(
      (sum, category) => sum + (category.highlights?.length ?? 0) + (category.rules?.length ?? 0),
      0,
    ),
  };
}

/** Human label for a stored severity value, unmapped. */
export function severityLabel(severity: string | undefined): string {
  if (!severity) return 'Standard';
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export interface AgreementsSource {
  templateCount: number;
  draftCount: number;
  rules: RulesContent | null;
  /** Whether the owner's signature stamp is set — agreements cannot be issued without it. */
  signatureConfigured: boolean;
  /**
   * `policy.tenant_rules.agreement_required`. Defaults to true, matching the
   * backend: an absent flag means a hostel that predates the setting.
   */
  agreementRequired: boolean;
}

const AGREEMENTS_BASE = '/owner/more/configuration/agreements';

export function deriveAgreementSections(source: AgreementsSource): ConfigSection[] {
  const { templateCount, draftCount, rules, signatureConfigured, agreementRequired } = source;
  const clauses = countClauses(rules);
  const variables = usedVariables(rules);
  const highlightCount = (rules?.categories ?? []).reduce(
    (sum, category) => sum + (category.highlights?.length ?? 0),
    0,
  );

  const templatesRow: ConfigRow = {
    key: 'templates',
    title: 'Templates',
    detail:
      templateCount === 0
        ? 'None yet'
        : `${plural(templateCount, 'document')}${draftCount > 0 ? ` · ${draftCount} in draft` : ''}`,
    // A draft is not in use, so it is a genuine loose end rather than a choice.
    state: draftCount > 0 ? 'attention' : templateCount > 0 ? 'configured' : 'attention',
    route: `${AGREEMENTS_BASE}/templates`,
  };

  return [
    {
      label: 'Requirement',
      rows: [
        {
          key: 'agreement-required',
          title: 'Tenant agreement',
          detail: agreementRequired
            ? 'Tenants accept rules and sign before activation'
            : 'Tenants are activated without signing',
          // Not requiring one is a deliberate stance, not an unfinished setup —
          // plenty of PGs run on trust and a phone call.
          state: agreementRequired ? 'configured' : 'off',
          route: `${AGREEMENTS_BASE}/requirement`,
        },
      ],
    },
    {
      label: 'Documents',
      rows: [
        templatesRow,
        {
          key: 'clauses',
          title: 'Clause library',
          detail:
            clauses.categories > 0
              ? `${plural(clauses.categories, 'section')} · ${plural(clauses.clauses, 'clause')}`
              : 'Not set up',
          state: clauses.categories > 0 ? 'configured' : 'attention',
          route: `${AGREEMENTS_BASE}/clauses`,
        },
      ],
    },
    {
      label: 'Content',
      rows: [
        {
          key: 'variables',
          title: 'Dynamic variables',
          detail: `${variables.length} of ${AGREEMENT_VARIABLES.length} auto-filled fields in use`,
          state: 'configured',
          route: `${AGREEMENTS_BASE}/variables`,
        },
        {
          key: 'highlights',
          title: 'Highlights',
          detail:
            highlightCount > 0
              ? `${plural(highlightCount, 'key term')} surfaced to tenants`
              : 'No key terms surfaced yet',
          state: highlightCount > 0 ? 'configured' : 'off',
          route: `${AGREEMENTS_BASE}/clauses`,
        },
      ],
    },
    {
      label: 'Signing & publishing',
      rows: [
        {
          key: 'signatures',
          title: 'Signatures',
          // Deliberately not "E-signature · Aadhaar OTP": signing is a captured
          // signature image (owner stamp + tenant signature), and no Aadhaar
          // integration exists anywhere in the codebase.
          detail: signatureConfigured
            ? 'Owner stamp set · tenants sign on activation'
            : 'Owner signature not set',
          state: signatureConfigured ? 'configured' : 'attention',
          route: '/owner/more/hostel',
        },
        {
          key: 'version-history',
          title: 'Version history',
          detail:
            templateCount > 0
              ? `${plural(templateCount, 'version')} tracked`
              : UNAVAILABLE_LABEL,
          state: templateCount > 0 ? 'configured' : 'unavailable',
          route: templateCount > 0 ? `${AGREEMENTS_BASE}/templates` : undefined,
        },
      ],
    },
  ];
}
