import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OwnerHomeDashboard } from '@features/owner-dashboard/components/OwnerHomeDashboard';
import { HostelOptionsSheet } from '@features/owner-dashboard/components/HostelOptionsSheet';
import { AddHostelModal } from '@features/owner-dashboard/components/AddHostelModal';
import { useOwnerDashboard } from '@features/owner-dashboard/hooks/useOwnerDashboard';
import { useHostelOrder } from '@features/owner-dashboard/property-order/useHostelOrder';
import { moveItem } from '@features/owner-dashboard/property-order/hostelSort';
import { UniversalSearchOverlay } from '@features/owner-search/UniversalSearchOverlay';
import { getInitials } from '@features/tenants/utils/normalize';
import { useHomeQuickActions } from '@features/owner-dashboard/quick-actions/useHomeQuickActions';
import { QuickActionsSheet } from '@features/owner-dashboard/quick-actions/QuickActionsSheet';
import { AllActionsSheet } from '@features/owner-dashboard/quick-actions/AllActionsSheet';
import { QuickCollectModal } from '@features/owner-tenants/quick-collect/QuickCollectModal';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { pendingVerificationsRoute } from '@features/owner-tenants/documents/kycDocuments';
import { PENDING_ACTIVATIONS_PATH } from '@features/owner-tenants/activation/activationProgress';

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
  const reorder = useHostelOrder();
  const [hostelMenuFor, setHostelMenuFor] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addHostelOpen, setAddHostelOpen] = useState(false);

  if (dash.isLoading) return <DashboardLoadingSkeleton />;

  const menuHostel = dash.properties.find((p) => p.id === hostelMenuFor);

  /**
   * Keyboard/screen-reader path for reordering — dragging is pointer-only, so
   * without this the feature would be unusable without a mouse or touch.
   * Operates on the server's canonical order, not the currently displayed
   * sort, so "Move up" means the same thing regardless of view. See ADR-042.
   */
  const moveHostel = (hostelId: string, direction: -1 | 1) => {
    const ids = [...dash.properties]
      .sort((a, b) => (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity))
      .map((p) => p.id);
    const from = ids.indexOf(hostelId);
    if (from === -1) return;
    const next = moveItem(ids, from, from + direction);
    if (next !== ids) reorder.mutate(next);
    setHostelMenuFor(null);
  };

  const menuIndex = menuHostel
    ? [...dash.properties]
        .sort((a, b) => (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity))
        .findIndex((p) => p.id === menuHostel.id)
    : -1;

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
        onPropertyMenu={(hostelId) => setHostelMenuFor(hostelId)}
        onAddHostel={() => setAddHostelOpen(true)}
        onReorderProperties={(orderedIds) => reorder.mutate(orderedIds)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenCollectionQueue={() => navigate('/owner/money/collect')}
        onOpenAgreements={() => navigate('/owner/agreements/review')}
        onOpenActivations={() => navigate(PENDING_ACTIVATIONS_PATH)}
        onOpenVacancies={() => navigate('/owner/rooms/vacant')}
      />

      <UniversalSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        // "Collect" on a search result drops straight into the existing
        // QuickCollect flow with the tenant preselected — find and act in two
        // taps, without a detour through the profile.
        onCollect={(result) =>
          qa.collectPaymentFor({
            id: result.id,
            name: result.title,
            initials: getInitials(result.title),
            phone: String(result.data?.phone ?? ''),
            hostelId: String(result.data?.hostelId ?? ''),
            hostelName: '',
            room: String(result.data?.room ?? '') || 'N/A',
            outstanding: Number(result.data?.outstanding ?? 0),
            deposit: 0,
          })
        }
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
        onCollectRent={() => {
          qa.closeAllActions();
          navigate('/owner/money/collect');
        }}
        onActivateTenants={() => {
          qa.closeAllActions();
          navigate(PENDING_ACTIVATIONS_PATH);
        }}
        onVerifyKyc={() => {
          qa.closeAllActions();
          navigate(pendingVerificationsRoute());
        }}
        onInviteTenant={qa.inviteTenant}
        actionCenter={dash.actionCenter}
      />
      <QuickCollectModal open={qa.collectOpen} onClose={qa.closeCollect} initialTenant={qa.collectTenant} />
      <InviteTenantWizard open={qa.inviteOpen} onClose={qa.closeInvite} />
      <AddHostelModal open={addHostelOpen} onClose={() => setAddHostelOpen(false)} />
      <HostelOptionsSheet
        open={Boolean(hostelMenuFor)}
        onClose={() => setHostelMenuFor(null)}
        hostelId={hostelMenuFor}
        hostelName={menuHostel?.name ?? 'Hostel'}
        index={menuIndex}
        total={dash.properties.length}
        onMove={moveHostel}
      />
    </>
  );
}
