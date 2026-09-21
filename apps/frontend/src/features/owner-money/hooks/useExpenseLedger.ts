import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { expenseService } from '@features/expenses/api';
import { queryKeys } from '@lib/queryKeys';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { toMockExpense } from './useRealMoney';
import type { MockExpense } from '@shared/mocks/expenses';

/**
 * The Expenses list, filtered by the server.
 *
 * Separate from `useRealMoney`'s expenses query on purpose. That one is
 * portfolio-wide and fixed to this month, and it feeds the Overview tile, the
 * category/vendor breakdowns and the monthly trend — none of which should move
 * when the owner types in the search box. This one is only the list.
 *
 * It exists because the list used to fetch 100 rows of the current month and
 * narrow them in the browser, so "All time" showed one month and a search only
 * searched what happened to be loaded. The export resolves the same filters
 * server-side, so leaving the list as it was would mean the file and the screen
 * it came from described different rows.
 */

/**
 * Enough rows that no real owner hits it, low enough that the phone can render
 * it. When the server returns exactly this many there may be more, which is
 * what `hasMore` says — the export sheet uses it to tell the owner the file is
 * bigger than the screen.
 */
export const LEDGER_PAGE_SIZE = 500;

interface LedgerResponse {
  expenses: Array<Record<string, unknown>>;
}

export function useExpenseLedger(params: Record<string, string> | null, enabled: boolean) {
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: queryKeys.owner.expenses(params ?? { disabled: 'true' }),
    queryFn: () => expenseService.getAll(undefined, params) as Promise<LedgerResponse>,
    enabled: enabled && session.isAuthenticated && params !== null,
    staleTime: 30_000,
    // Keep the previous page on screen while a new filter loads, so changing a
    // chip does not blank the list and bounce the scroll position.
    placeholderData: keepPreviousData,
  });

  const raw = query.data?.expenses ?? [];
  const rows = raw.map((e) => toMockExpense(e as any)) as MockExpense[];
  return {
    rows,
    isLoading: query.isLoading,
    /** The server had at least a full page — the list is not the whole story. */
    hasMore: raw.length >= LEDGER_PAGE_SIZE,
  };
}
