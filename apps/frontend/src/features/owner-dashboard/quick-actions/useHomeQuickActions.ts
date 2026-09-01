import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { QuickCollectTenant } from '@features/owner-tenants/types';

/**
 * Home-tab quick-action state: the Quick Actions sheet itself, plus the two
 * flows mounted directly here (Collect Payment -> QuickCollectModal, Invite
 * Tenant -> InviteTenantWizard — both reused as-is, same "another mount
 * point" precedent MoneyPage already set for QuickCollectModal). Add Expense
 * navigates to its own tab with router state, since that modal's own page
 * already owns that flow.
 */
export function useHomeQuickActions() {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [allActionsOpen, setAllActionsOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [collectTenant, setCollectTenant] = useState<QuickCollectTenant | undefined>(undefined);

  const openSheet = () => setSheetOpen(true);
  const closeSheet = () => setSheetOpen(false);
  const openAllActions = () => setAllActionsOpen(true);
  const closeAllActions = () => setAllActionsOpen(false);

  const collectPayment = () => {
    closeSheet();
    closeAllActions();
    setCollectTenant(undefined);
    setCollectOpen(true);
  };

  /**
   * Collect for a specific tenant — used by Universal Search so "Collect" on a
   * result opens the flow with that tenant already chosen, skipping the
   * search-for-them-again step the modal would otherwise start on (ADR-044).
   */
  const collectPaymentFor = (tenant: QuickCollectTenant) => {
    closeSheet();
    closeAllActions();
    setCollectTenant(tenant);
    setCollectOpen(true);
  };
  const inviteTenant = () => {
    closeSheet();
    closeAllActions();
    setInviteOpen(true);
  };
  const addExpense = () => {
    closeSheet();
    navigate('/owner/money', { state: { openAddExpense: true } });
  };

  return {
    sheetOpen,
    openSheet,
    closeSheet,
    allActionsOpen,
    openAllActions,
    closeAllActions,
    collectOpen,
    collectTenant,
    closeCollect: () => {
      setCollectOpen(false);
      setCollectTenant(undefined);
    },
    inviteOpen,
    closeInvite: () => setInviteOpen(false),
    collectPayment,
    collectPaymentFor,
    inviteTenant,
    addExpense,
  };
}
