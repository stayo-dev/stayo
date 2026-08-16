import { SALES_STAGES, STATUS_LABEL, type LeadStatus } from './leadQueue';

/**
 * Pipeline shaping for the Leads screen.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export const LOST_REASON_LABEL: Record<string, string> = {
  PRICE: 'Too expensive',
  WENT_WITH_COMPETITOR: 'Went with a competitor',
  NOT_READY: 'Not ready yet',
  NO_RESPONSE: 'Stopped responding',
  MISSING_FEATURE: 'Missing a feature they need',
  TOO_SMALL: 'Too small to benefit',
  OTHER: 'Other',
};

export const LOST_REASONS = Object.keys(LOST_REASON_LABEL);

const DASH = '—';

/** The stage a lead moves to next. `null` means "not by hand from here". */
export function nextStage(status: string): LeadStatus | null {
  const s = String(status || '').toUpperCase();
  // UNDER_REVIEW predates the merge and means the same as CONTACTED.
  const current = s === 'UNDER_REVIEW' ? 'CONTACTED' : s;
  const index = SALES_STAGES.indexOf(current as LeadStatus);
  if (index < 0 || index >= SALES_STAGES.length - 1) return null;
  return SALES_STAGES[index + 1];
}

/**
 * Advancing stops at NEGOTIATING on purpose. The step after it is approval,
 * which mints an activation token and messages the owner — that belongs
 * behind its own deliberate button, not behind "next stage".
 */
export function canAdvance(status: string): boolean {
  return nextStage(status) !== null;
}

export type StageChip = { key: string; label: string; count: number };

export function stageChips(counts: Record<string, number>): StageChip[] {
  const total = Object.values(counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const at = (key: string) => Number(counts?.[key] ?? 0);

  return [
    { key: 'all', label: 'All', count: total },
    // Legacy UNDER_REVIEW rows fold into CONTACTED so the chip totals still
    // add up to `all` after migration 067.
    { key: 'NEW', label: STATUS_LABEL.NEW, count: at('NEW') },
    { key: 'CONTACTED', label: 'Contacted', count: at('CONTACTED') + at('UNDER_REVIEW') },
    { key: 'DEMO', label: 'Demo booked', count: at('DEMO') },
    { key: 'NEGOTIATING', label: 'Negotiating', count: at('NEGOTIATING') },
    { key: 'INVITE_SENT', label: 'Invited', count: at('APPROVED') + at('INVITE_SENT') },
    { key: 'LIVE', label: 'Won', count: at('OWNER_ACTIVATED') + at('HOSTEL_CREATED') + at('LIVE') },
    { key: 'LOST', label: 'Lost', count: at('LOST') },
  ];
}

export type PipelineStat = { key: string; label: string; value: string; sub: string; tone?: string };

export function leadPipelineStats(counts: Record<string, number>): PipelineStat[] {
  const at = (key: string) => Number(counts?.[key] ?? 0);
  const total = Object.values(counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

  const won = at('OWNER_ACTIVATED') + at('HOSTEL_CREATED') + at('LIVE');
  const lost = at('LOST');
  // Everything still being worked — won and lost are finished, not open.
  const open = total - won - lost;

  return [
    { key: 'open', label: 'Open leads', value: String(open), sub: 'across all stages' },
    {
      key: 'negotiating',
      label: 'In negotiation',
      value: String(at('NEGOTIATING')),
      sub: 'closest to converting',
      tone: 'amber',
    },
    { key: 'won', label: 'Converted', value: String(won), sub: 'now on the platform', tone: 'green' },
    {
      key: 'conversion',
      label: 'Conversion',
      value: total > 0 ? `${((won / total) * 100).toFixed(1)}%` : DASH,
      sub: 'of every lead captured',
      tone: 'green',
    },
  ];
}

export type LostReasonRow = { reason: string; label: string; count: number; width: string };

export function formatLostReasons(rows: { reason: string; count: number }[]): LostReasonRow[] {
  if (!rows || rows.length === 0) return [];
  const max = Math.max(...rows.map((r) => r.count));
  return rows.map((r) => ({
    reason: r.reason,
    // Unknown enum values render as themselves rather than blank — a chart
    // row with no label is worse than an ugly one.
    label: LOST_REASON_LABEL[r.reason] ?? r.reason,
    count: r.count,
    width: max > 0 ? `${Math.round((r.count / max) * 100)}%` : '0%',
  }));
}
