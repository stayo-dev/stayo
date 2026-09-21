import { useState } from 'react';
import type { MockExpense } from '@shared/mocks/expenses';
import type { QuickCollectTenant } from '@features/owner-tenants/types';
import type { AddExpenseData, MoneyModal, MoneyTab } from '../types';
import type { MoneyExportId } from '../export/exportRequest';

interface AddExpenseDraft {
  seed?: Partial<AddExpenseData>;
  editingId?: string;
}

/** Active sub-tab (Pulse/Collections/Expenses) + which of the 4 supporting modals is open, for `MoneyPage`. */
export function useMoneyPage() {
  const [tab, setTab] = useState<MoneyTab>('pulse');
  const [modal, setModal] = useState<MoneyModal>(null);
  const [expenseDetail, setExpenseDetail] = useState<MockExpense | null>(null);
  const [collectTenant, setCollectTenant] = useState<QuickCollectTenant | null>(null);
  const [addExpenseDraft, setAddExpenseDraft] = useState<AddExpenseDraft>({});
  // Which export the sheet is showing. Set by where the owner tapped, so the
  // sheet never has to ask what the file is for (ADR-197).
  const [exportTarget, setExportTarget] = useState<MoneyExportId>('expenses');

  return {
    tab,
    setTab,
    modal,
    openModal: (m: MoneyModal) => setModal(m),
    closeModal: () => {
      setModal(null);
      setAddExpenseDraft({});
    },
    addExpenseDraft,
    // Opens the Add Expense wizard pre-filled (Duplicate) or in edit mode
    // (Edit, targeting the same expense id) — plain `openModal('add-expense')`
    // still works unseeded for the "+ Add expense" entry point.
    openAddExpense: (draft: AddExpenseDraft = {}) => {
      setAddExpenseDraft(draft);
      setModal('add-expense');
    },
    exportTarget,
    openExport: (target: MoneyExportId) => {
      setExportTarget(target);
      setModal('export');
    },
    expenseDetail,
    openExpenseDetail: (e: MockExpense) => setExpenseDetail(e),
    closeExpenseDetail: () => setExpenseDetail(null),
    collectTenant,
    openCollect: (tenant: QuickCollectTenant) => setCollectTenant(tenant),
    closeCollect: () => setCollectTenant(null),
  };
}
