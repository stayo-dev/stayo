import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { portfolioService } from '@features/dashboard/api';
import { queryKeys } from '@lib/queryKeys';
import { useHostelBedSummary } from './useHostelBedSummary';
import { tallyConfigRows } from '../config/configRows';
import { deriveFinanceSections, deriveHostelSections, type ConfigSource } from '../config/deriveConfigSections';
import { countWorkflows, deriveAutomationSections } from '../config/deriveAutomationSections';
import { useAgreementTemplates } from './useAgreements';

export interface ConfigModule {
  key: 'hostel' | 'finance' | 'automation' | 'agreements';
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

/**
 * Configuration hub composition. Hostel, Finance and Automation are real;
 * Agreements, Notifications and Account are deferred to later slices (see
 * docs/superpowers/specs/2026-08-08-configuration-hub-redesign-design.md).
 *
 * Module cards derive their counts from the *same* pure functions the module
 * screens render, so a card can never disagree with the screen it opens.
 * Attention items come from genuine gaps only — a deliberately-off toggle is
 * never flagged, and placeholder rows never move a count.
 */
export function useConfigurationHub() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const { bedsTotal, roomsTotal, floorsTotal, isLoading: bedsLoading } = useHostelBedSummary(hostelId);
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

  // Module "areas" come from the same pure derivation the module screens
  // render, so a card can never disagree with the screen it opens — and
  // placeholder rows are excluded from both, per tallyConfigRows.
  const source: ConfigSource = {
    hostel,
    policy: policyQuery.data?.policy ?? null,
    counts: { properties: hostelsCount, floors: floorsTotal, rooms: roomsTotal, beds: bedsTotal },
  };
  const automationWorkflows = deriveAutomationSections({
    automation: policyQuery.data?.policy?.automation ?? null,
    channels: policyQuery.data?.policy?.reminders?.channels ?? null,
  }).flatMap((section) => section.rows);
  const automation = countWorkflows(automationWorkflows);
  const { templates: agreementList } = useAgreementTemplates();
  const agreementTemplates = agreementList.length;
  const agreementDrafts = agreementList.filter((t) => t.status !== 'PUBLISHED').length;
  const hostelTally = tallyConfigRows(deriveHostelSections(source).flatMap((s) => s.rows));
  const financeTally = tallyConfigRows(deriveFinanceSections(source).flatMap((s) => s.rows));

  const areaMeta = (tally: { configured: number; attention: number }) =>
    `${tally.configured + tally.attention} area${tally.configured + tally.attention === 1 ? '' : 's'}`;

  const modules: ConfigModule[] = [
    {
      key: 'hostel',
      glyph: 'H',
      title: 'Hostel',
      desc: 'Identity, rooms, amenities & policies',
      status: hostelTally.attention > 0 ? 'warn' : 'ok',
      statusLabel: hostelTally.attention > 0 ? `${hostelTally.attention} to finish` : 'Configured',
      meta: areaMeta(hostelTally),
      tint: '#F5E9E3',
      iconColor: '#B46A55',
      route: '/owner/more/configuration/hostel',
    },
    {
      key: 'finance',
      glyph: '₹',
      title: 'Finance',
      desc: 'Rent, deposits, penalties & payouts',
      status: financeTally.attention > 0 ? 'warn' : 'ok',
      statusLabel: financeTally.attention > 0 ? `${financeTally.attention} to finish` : 'Configured',
      meta: areaMeta(financeTally),
      tint: '#FBF1DE',
      iconColor: '#B8792B',
      route: '/owner/more/configuration/finance',
    },
    {
      key: 'agreements',
      glyph: '§',
      title: 'Agreements',
      desc: 'Templates, clauses & signing',
      status: agreementDrafts > 0 ? 'warn' : 'ok',
      statusLabel: agreementDrafts > 0 ? `${agreementDrafts} draft${agreementDrafts === 1 ? '' : 's'}` : 'Configured',
      meta: `${agreementTemplates} template${agreementTemplates === 1 ? '' : 's'}`,
      tint: '#F3E7DD',
      iconColor: '#A45D44',
      route: '/owner/more/configuration/agreements',
    },
    {
      key: 'automation',
      glyph: '↻',
      title: 'Automation',
      desc: 'Collection, reminders & workers',
      // A paused workflow is a deliberate choice, never a gap — so this card is
      // 'ok' whatever the mix, and reports how many are running instead.
      status: 'ok',
      statusLabel: automation.running > 0 ? 'Active' : 'All paused',
      meta: `${automation.running} of ${automation.total} workflows running`,
      tint: '#E4EFE7',
      iconColor: '#1F7A52',
      route: '/owner/more/configuration/automation',
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

  // The real workspace name, from the hostel the owner actually owns — this
  // header previously rendered `mockOwnerProfile` from @shared/mocks.
  const workspaceName = hostel?.name ? `${hostel.name} workspace` : 'Your workspace';
  const workspaceInitials = (hostel?.name ?? 'Stayo')
    .split(/\s+/)
    .slice(0, 2)
    .map((word: string) => word[0]?.toUpperCase() ?? '')
    .join('');

  return {
    modules,
    attention,
    percentComplete,
    doneCount,
    totalCount: modules.length,
    isLoading,
    workspaceName,
    workspaceInitials,
  };
}
