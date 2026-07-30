import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Home-tab quick-action state: the Quick Actions sheet itself, plus the two
 * flows mounted directly here (Collect Payment -> QuickCollectModal, Invite
 * Tenant -> InviteTenantWizard — both reused as-is, same "another mount
 * point" precedent MoneyPage already set for QuickCollectModal). Add Expense
 * and Create Food Poll instead navigate to their own tab with router state,
 * since those modals' own pages already own that flow.
 */
export function useHomeQuickActions() {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [allActionsOpen, setAllActionsOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const openSheet = () => setSheetOpen(true);
  const closeSheet = () => setSheetOpen(false);
  const openAllActions = () => setAllActionsOpen(true);
  const closeAllActions = () => setAllActionsOpen(false);

  const collectPayment = () => {
    closeSheet();
    closeAllActions();
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
  const createFoodPoll = () => {
    closeSheet();
    navigate('/owner/food', { state: { openCreatePoll: true } });
  };

  return {
    sheetOpen,
    openSheet,
    closeSheet,
    allActionsOpen,
    openAllActions,
    closeAllActions,
    collectOpen,
    closeCollect: () => setCollectOpen(false),
    inviteOpen,
    closeInvite: () => setInviteOpen(false),
    collectPayment,
    inviteTenant,
    addExpense,
    createFoodPoll,
  };
}
