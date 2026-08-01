/**
 * Owner-facing presentation of the activation workflow.
 *
 * The state machine itself lives in the backend
 * (`activationWorkflowService.computeState`) and is the single source of
 * truth. Nothing in this module decides which step a tenant is on — it reads
 * `current_step`, `completed_steps` and `blocked_steps` as given and turns
 * them into labels. If the backend's rules change, this follows automatically.
 *
 * KYC is deliberately absent from every step calculation here:
 * `document_verified` is a separate state machine that never gates
 * activation, and is rendered as its own badge (`kycBadge`).
 */

export type ActivationStep = 'ACCOUNT' | 'RULES' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE';

export const ACTIVATION_STEP_ORDER: ActivationStep[] = [
  'ACCOUNT',
  'RULES',
  'AGREEMENT',
  'PROFILE',
  'ACTIVATE',
];

export const PENDING_ACTIVATIONS_PATH = '/owner/tenants/activations';

const STEP_LABELS: Record<string, string> = {
  ACCOUNT: 'Waiting for account creation',
  RULES: 'Waiting for rules acceptance',
  AGREEMENT: 'Waiting for agreement',
  PROFILE: 'Waiting for profile completion',
  ACTIVATE: 'Ready to activate',
};

/** Short form used inside the step tracker. */
const STEP_SHORT: Record<string, string> = {
  ACCOUNT: 'Account',
  RULES: 'Rules',
  AGREEMENT: 'Agreement',
  PROFILE: 'Profile',
  ACTIVATE: 'Activate',
};

export interface ActivationStateLike {
  current_step?: string;
  completed_steps?: string[];
  blocked_steps?: string[];
  activation_completed?: boolean;
  progress_percent?: number;
  missing_fields?: { tier_1_required?: string[] };
  activation_started_at?: string | null;
}

export type StepStatus = 'done' | 'current' | 'blocked' | 'pending';

export interface ActivationProgress {
  steps: Array<{ step: ActivationStep; label: string; shortLabel: string; status: StepStatus }>;
  percent: number;
  currentLabel: string;
  missingFields: string[];
}

export function activationStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}

function asRecord(value: unknown): ActivationStateLike {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ActivationStateLike) : {};
}

/**
 * `ACTIVATE` means two different things depending on `activation_completed` —
 * "everything is done, ready to finish" vs "finished". Only that flag
 * distinguishes them, so it is checked first.
 */
export function currentStepLabel(state: unknown): string {
  const s = asRecord(state);
  if (s.activation_completed) return 'Activated';
  return activationStepLabel(String(s.current_step ?? 'ACCOUNT'));
}

export function toActivationProgress(state: unknown): ActivationProgress {
  const s = asRecord(state);
  const completed = new Set(s.completed_steps ?? []);
  const blocked = new Set(s.blocked_steps ?? []);
  const current = String(s.current_step ?? '');
  const done = Boolean(s.activation_completed);

  const steps = ACTIVATION_STEP_ORDER.map((step) => {
    let status: StepStatus;
    if (completed.has(step)) status = 'done';
    else if (!done && step === current) status = 'current';
    else if (blocked.has(step)) status = 'blocked';
    else status = 'pending';
    return { step, label: activationStepLabel(step), shortLabel: STEP_SHORT[step], status };
  });

  return {
    steps,
    // Read, never recomputed — if the backend reweights its steps the owner
    // sees the backend's number, not a second opinion.
    percent: Number(s.progress_percent ?? 0),
    currentLabel: currentStepLabel(state),
    missingFields: s.missing_fields?.tier_1_required ?? [],
  };
}

/**
 * Whether this tenant still belongs in the Pending Activations queue.
 *
 * `activation_completed` wins over the row's status so a tenant drops out the
 * moment the backend says they are done, without waiting for a list refetch to
 * report a new status string.
 */
export function isAwaitingActivation(tenantStatus: string, state: unknown): boolean {
  if (asRecord(state).activation_completed) return false;
  return String(tenantStatus ?? '').toUpperCase() === 'INVITED';
}

/** KYC, rendered separately — it never blocks activation. */
export function kycBadge(documentVerified: boolean): { label: string; tone: 'success' | 'warning' } {
  return documentVerified
    ? { label: 'KYC Verified', tone: 'success' }
    : { label: 'KYC Pending', tone: 'warning' };
}

export function waitingSinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
