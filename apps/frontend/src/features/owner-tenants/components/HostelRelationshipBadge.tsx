import { Lock } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import type { DisclosedHistory } from '../api/tenantHistory';
import type { HostelRelationship } from '../hostelRelationship';

const COPY: Record<Exclude<HostelRelationship, 'UNKNOWN'>, string> = {
  NEW: 'New to this hostel',
  CURRENT_TENANT: 'Currently a tenant here',
  PREVIOUS_TENANT: 'Previously stayed here',
};

const UNKNOWN_COPY: Record<DisclosedHistory['reason'], string> = {
  TENANCY: 'Stay history not available',
  OPEN_ENQUIRY: 'Stay history not available',
  TENANT_APPROVED: 'Stay history not available',
  AWAITING_TENANT: 'Stay history: awaiting response',
  TENANT_DECLINED: "Hasn't shared stay history",
  NOT_ENGAGED: 'Stay history not available',
};

/**
 * "New to this hostel" / "Previously stayed here" / "Currently a tenant
 * here" — or, when disclosure hasn't been earned, a neutral "not available"
 * state. Never renders UNKNOWN as if it were NEW: an owner without access
 * must see neither a false "new" claim nor a hint that history exists,
 * matching TenantHistoryPanel's NotDisclosed principle.
 */
export function HostelRelationshipBadge({
  relationship,
  reason,
}: {
  relationship: HostelRelationship;
  reason: DisclosedHistory['reason'];
}) {
  if (relationship === 'UNKNOWN') {
    return (
      <StatusPill tone="neutral" variant="filter" className="gap-1">
        <Lock className="h-3 w-3" strokeWidth={2} />
        {UNKNOWN_COPY[reason]}
      </StatusPill>
    );
  }

  return (
    <StatusPill tone={relationship === 'NEW' ? 'neutral' : 'info'} variant="filter">
      {COPY[relationship]}
    </StatusPill>
  );
}
