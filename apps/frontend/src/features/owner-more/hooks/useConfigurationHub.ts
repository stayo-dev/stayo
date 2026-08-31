import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';

export interface ConfigAttentionItem {
  title: string;
  sub: string;
  route: string;
}

/**
 * What the Configure screen needs: the workspace name, and anything genuinely
 * asking for attention.
 *
 * It used to compose module cards, per-module area tallies and a completeness
 * percentage from four other derivations. All of that went with the module
 * grid; what remains is a hostel lookup and three gap checks. Attention items
 * come from genuine gaps only — a deliberately-off toggle is never flagged.
 */
export function useConfigurationHub() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);

  const isLoading = policyQuery.isLoading;

  const hostel = policyQuery.data?.hostel;
  const billing = policyQuery.data?.policy?.billing;

  const identityComplete = Boolean(hostel?.name && hostel?.phone && hostel?.address);

  const lateFee = billing?.late_fee;
  const lateFeeRule = lateFee?.rules?.[0];
  const lateFeeMisconfigured = Boolean(lateFee?.enabled && !lateFeeRule?.amount);

  const attention: ConfigAttentionItem[] = [];
  if (!identityComplete) {
    attention.push({ title: 'Hostel identity incomplete', sub: 'Hostel · add name, phone & address', route: '/owner/more/hostel' });
  }
  if (hostel && !hostel.gst_number) {
    attention.push({ title: 'GST number not added', sub: 'Hostel · add it if you need GST on receipts', route: '/owner/more/hostel' });
  }
  if (lateFeeMisconfigured) {
    attention.push({ title: 'Late fee amount not set', sub: 'Finance · late fees are on but have no amount', route: '/owner/more/configuration/finance/late-fees' });
  }

  // The real workspace name, from the hostel the owner actually owns — this
  // header previously rendered `mockOwnerProfile` from @shared/mocks.
  const workspaceName = hostel?.name ? `${hostel.name} workspace` : 'Your workspace';
  const workspaceInitials = (hostel?.name ?? 'Stayo')
    .split(/\s+/)
    .slice(0, 2)
    .map((word: string) => word[0]?.toUpperCase() ?? '')
    .join('');

  // `modules`, `doneCount`, `percentComplete` and `totalCount` are gone. They
  // fed the hub's progress ring and module cards, and were one of the two
  // independently computed completeness scores the configuration audit found
  // (the other lived in `useWorkspaceConfig`, since deleted with its screen).
  // `attention` is derived from real gaps and does not depend on any of them.
  return {
    attention,
    isLoading,
    workspaceName,
    workspaceInitials,
  };
}
