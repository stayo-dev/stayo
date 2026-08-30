import { useConfiguredHostelId } from './useConfiguredHostel';
import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { portfolioService } from '@features/dashboard/api';
import { queryKeys } from '@lib/queryKeys';
import { useHostelBedSummary } from './useHostelBedSummary';
import { tallyConfigRows } from '../config/configRows';
import {
  deriveFinanceSections,
  deriveHostelSections,
  type ConfigSection,
  type ConfigSource,
} from '../config/deriveConfigSections';

interface PortfolioSummary {
  hostels?: Array<{ rooms_count?: number }>;
}

/**
 * Gathers the live data the Hostel and Finance configuration screens need, then
 * hands it to the pure `derive*Sections` functions. Deliberately thin: no
 * "is this configured?" judgement happens here, so all of it stays testable in
 * a node environment (see config/deriveConfigSections.test.ts).
 */
export function useConfigModule(module: 'hostel' | 'finance'): {
  sections: ConfigSection[];
  configured: number;
  attention: number;
  isLoading: boolean;
} {
  const session = useOwnerSession();
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const { bedsTotal, roomsTotal, floorsTotal, isLoading: bedsLoading } = useHostelBedSummary(hostelId);
  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary() as Promise<PortfolioSummary>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const isLoading = policyQuery.isLoading || bedsLoading || portfolioQuery.isLoading;

  const source: ConfigSource = {
    hostel: policyQuery.data?.hostel ?? null,
    policy: policyQuery.data?.policy ?? null,
    counts: {
      properties: portfolioQuery.data?.hostels?.length ?? 0,
      floors: floorsTotal,
      rooms: roomsTotal,
      beds: bedsTotal,
    },
  };

  const sections = module === 'hostel' ? deriveHostelSections(source) : deriveFinanceSections(source);
  const { configured, attention } = tallyConfigRows(sections.flatMap((s) => s.rows));

  return { sections, configured, attention, isLoading };
}
