
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
