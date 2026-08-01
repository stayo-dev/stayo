import { useNavigate } from 'react-router-dom';
import { OwnerHomeDashboard } from '@features/owner-dashboard/components/OwnerHomeDashboard';
import { useOwnerDashboard } from '@features/owner-dashboard/hooks/useOwnerDashboard';
import { useHomeQuickActions } from '@features/owner-dashboard/quick-actions/useHomeQuickActions';
import { QuickActionsSheet } from '@features/owner-dashboard/quick-actions/QuickActionsSheet';
import { AllActionsSheet } from '@features/owner-dashboard/quick-actions/AllActionsSheet';
import { QuickCollectModal } from '@features/owner-tenants/quick-collect/QuickCollectModal';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { pendingVerificationsRoute } from '@features/owner-tenants/documents/kycDocuments';
import { PENDING_ACTIVATIONS_PATH } from '@features/owner-tenants/activation/activationProgress';
import { stayoToast } from '@shared/ui-patterns/Toast';

function DashboardLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/**
 * Home tab for the real owner app, mounted at `/owner/home` inside
 * `OwnerAppShell`. Owns the FAB/View-all/bell wiring here (not inside
 * `OwnerHomeDashboard` itself) so that component stays a pure presentational
 * piece. Real data via `useOwnerDashboard()` — see that hook for exactly
 * which fields are genuinely real vs. honestly-labeled approximations for
 * fields the backend doesn't track yet.
 */
export function OwnerDashboardPreviewPage() {
  const navigate = useNavigate();
  const qa = useHomeQuickActions();
  const dash = useOwnerDashboard();

  if (dash.isLoading) return <DashboardLoadingSkeleton />;

  return (
    <>
      <OwnerHomeDashboard
        ownerName={dash.ownerName}
        properties={dash.properties}
        alertCount={dash.alertCount}
        actionCenter={dash.actionCenter}
        snapshot={dash.snapshot}
        collection={dash.collection}
        onSelectProperty={(hostelId) => navigate(`/owner/hostels/${hostelId}/overview`)}
        onOpenAlerts={() => navigate('/owner/alerts')}
        onOpenQuickActions={qa.openSheet}
        onViewAllActions={qa.openAllActions}
        onPropertyMenu={() => stayoToast.info('Coming soon')}
        onAddHostel={() => stayoToast.info('Coming soon')}
      />

      <QuickActionsSheet
        open={qa.sheetOpen}
        onClose={qa.closeSheet}
        onCollectPayment={qa.collectPayment}
        onInviteTenant={qa.inviteTenant}
        onAddExpense={qa.addExpense}
        onCreateFoodPoll={qa.createFoodPoll}
      />
      <AllActionsSheet
        open={qa.allActionsOpen}
        onClose={qa.closeAllActions}
        onCollectRent={qa.collectPayment}
        onActivateTenants={() => {
          qa.closeAllActions();
          navigate(PENDING_ACTIVATIONS_PATH);
        }}
        onVerifyKyc={() => {
          qa.closeAllActions();
          navigate(pendingVerificationsRoute());
        }}
        actionCenter={dash.actionCenter}
      />
      <QuickCollectModal open={qa.collectOpen} onClose={qa.closeCollect} />
      <InviteTenantWizard open={qa.inviteOpen} onClose={qa.closeInvite} />
    </>
  );
}
