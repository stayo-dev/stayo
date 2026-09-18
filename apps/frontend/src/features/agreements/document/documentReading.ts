/**
 * Reading an agreement, decided here rather than in the component.
 *
 * The signing gate is why this is a module of its own: whether a tenant may
 * sign is a rule about evidence, not a rendering detail, and it is tested
 * without a DOM — which is also the only kind of test this app runs.
 */
import type { AgreementDocument, SectionBlock } from './agreementDocument';

/**
 * Real scrolling rarely lands exactly at the bottom — sub-pixel heights, browser
 * chrome and elastic overscroll all leave a pixel or two — so "read to the end"
 * is a threshold rather than an equality.
 */
const READ_THRESHOLD = 0.98;

export type SectionIndexEntry = {
  number: number;
  title: string;
  anchorId: string;
  severity?: 'important' | 'standard';
  origin: 'owner' | 'platform';
};

export function anchorIdFor(sectionNumber: number): string {
  return `agreement-section-${sectionNumber}`;
}

export function sectionIndex(doc: AgreementDocument | null | undefined): SectionIndexEntry[] {
  return (doc?.blocks ?? [])
    .filter((b): b is SectionBlock => b.kind === 'section')
    .map((s) => ({
      number: s.number,
      title: s.title,
      anchorId: anchorIdFor(s.number),
      severity: s.severity,
      origin: s.origin,
    }));
}

/** The sections the owner marked important, for the card shown before opening. */
export function highlightTitles(doc: AgreementDocument | null | undefined): string[] {
  return sectionIndex(doc)
    .filter((s) => s.severity === 'important')
    .map((s) => s.title);
}

export function clauseCount(doc: AgreementDocument | null | undefined): number {
  return (doc?.blocks ?? [])
    .filter((b): b is SectionBlock => b.kind === 'section')
    .reduce((sum, s) => sum + s.clauses.length, 0);
}

export function readProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const scrollable = scrollHeight - clientHeight;
  // A document shorter than the viewport has been read by being shown. Treating
  // it as 0% would leave the tenant unable to ever satisfy the gate.
  if (scrollable <= 0) return 1;
  return Math.min(1, Math.max(0, scrollTop / scrollable));
}

export function isReadComplete(progress: number): boolean {
  return progress >= READ_THRESHOLD;
}

export type GateInput = {
  readCompleted: boolean;
  hasTenantSignature: boolean;
  hasTenantName: boolean;
  /** Set by `policy.tenant_rules.guardian_signature_required`. */
  guardianRequired?: boolean;
  hasGuardianSignature?: boolean;
  hasGuardianName?: boolean;
};

/**
 * Whether the tenant may sign, and if not, what is missing.
 *
 * Order matters: the reasons are checked in the order the tenant would fix
 * them, so the message always names the next thing to do rather than the last
 * thing that failed.
 */
export function gateState(input: GateInput): { canSign: boolean; reason: string | null } {
  if (!input.readCompleted) return { canSign: false, reason: 'Read the full agreement first' };
  if (!input.hasTenantSignature) return { canSign: false, reason: 'Your signature is required' };
  if (!input.hasTenantName) return { canSign: false, reason: 'Type your full name to sign' };

  if (input.guardianRequired) {
    if (!input.hasGuardianSignature) {
      return { canSign: false, reason: 'This hostel requires a parent or guardian co-signature' };
    }
    if (!input.hasGuardianName) {
      return { canSign: false, reason: "Type your guardian's full name to sign" };
    }
  }

  return { canSign: true, reason: null };
}
