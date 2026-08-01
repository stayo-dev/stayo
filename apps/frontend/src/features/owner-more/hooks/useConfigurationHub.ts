import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { portfolioService } from '@features/dashboard/api';
import { queryKeys } from '@lib/queryKeys';
import { useHostelBedSummary } from './useHostelBedSummary';

export interface ConfigModule {
  key: 'hostel' | 'finance';
  glyph: string;
  title: string;
  desc: string;
  status: 'ok' | 'warn';
  statusLabel: string;
  meta: string;
  tint: string;
  iconColor: string;
  route: string;
}

export interface ConfigAttentionItem {
  title: string;
  sub: string;
  route: string;
}

interface PortfolioSummary {
  hostels?: unknown[];
}

const LATE_FEE_TYPE_LABEL: Record<string, string> = {
  PER_DAY: '/day',
  FLAT: 'one-time',
  PERCENTAGE: '% of rent',
};

/**
 * Phase 1 Configuration hub composition — only Hostel + Finance modules are
 * real; module status/attention items are computed from actual gaps, never
 * from a deliberately-off toggle. See the approved plan for the real/not-real
 * split this encodes.
 */
export function useConfigurationHub() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const { bedsTotal, isLoading: bedsLoading } = useHostelBedSummary(hostelId);
  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary() as Promise<PortfolioSummary>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const isLoading = policyQuery.isLoading || bedsLoading || portfolioQuery.isLoading;

  const hostel = policyQuery.data?.hostel;
  const billing = policyQuery.data?.policy?.billing;
  const hostelsCount = portfolioQuery.data?.hostels?.length ?? 0;

  const identityComplete = Boolean(hostel?.name && hostel?.phone && hostel?.address);

  const lateFee = billing?.late_fee;
  const lateFeeRule = lateFee?.rules?.[0];
  const lateFeeMisconfigured = Boolean(lateFee?.enabled && !lateFeeRule?.amount);

  const modules: ConfigModule[] = [
    {
      key: 'hostel',
      glyph: 'H',
      title: 'Hostel',
      desc: 'Identity, rooms & policies',
      status: identityComplete ? 'ok' : 'warn',
      statusLabel: identityComplete ? 'Configured' : 'Incomplete',
      meta: `${bedsTotal} bed${bedsTotal === 1 ? '' : 's'} across ${hostelsCount} hostel${hostelsCount === 1 ? '' : 's'}`,
      tint: '#F5E9E3',
      iconColor: '#B46A55',
      route: '/owner/more/configuration/hostel',
    },
    {
      key: 'finance',
      glyph: '₹',
      title: 'Finance',
      desc: 'Rent, deposits & penalties',
      status: lateFeeMisconfigured ? 'warn' : 'ok',
      statusLabel: lateFeeMisconfigured ? 'Needs attention' : 'Configured',
      meta:
        lateFee?.enabled && lateFeeRule?.amount
          ? `Late fee ₹${lateFeeRule.amount}${LATE_FEE_TYPE_LABEL[lateFeeRule.type] ?? ''}`
          : 'Late fees off',
      tint: '#FBF1DE',
      iconColor: '#B8792B',
      route: '/owner/more/configuration/finance',
    },
  ];

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

  const doneCount = modules.filter((m) => m.status === 'ok').length;
  const percentComplete = isLoading ? 0 : Math.round((doneCount / modules.length) * 100);

  return { modules, attention, percentComplete, doneCount, totalCount: modules.length, isLoading };
}
