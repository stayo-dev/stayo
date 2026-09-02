import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OwnerHomeDashboard } from '@features/owner-dashboard/components/OwnerHomeDashboard';
import { findHostelInProgress } from '@features/owner-dashboard/hostelInProgress';
import { useOwnerDashboard } from '@features/owner-dashboard/hooks/useOwnerDashboard';
import { useProfileHeader } from '@features/owner-more/hooks/useProfileHeader';
import { UniversalSearchOverlay } from '@features/owner-search/UniversalSearchOverlay';
import { getInitials } from '@features/tenants/utils/normalize';
import { useHomeQuickActions } from '@features/owner-dashboard/quick-actions/useHomeQuickActions';
import { QuickActionsSheet } from '@features/owner-dashboard/quick-actions/QuickActionsSheet';
import { AllActionsSheet } from '@features/owner-dashboard/quick-actions/AllActionsSheet';
import { QuickCollectModal } from '@features/owner-tenants/quick-collect/QuickCollectModal';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { pendingVerificationsRoute } from '@features/owner-tenants/documents/kycDocuments';
import { PENDING_ACTIVATIONS_PATH } from '@features/owner-tenants/activation/activationProgress';
import { useGettingStarted } from '@features/owner-dashboard/getting-started/useGettingStarted';
import { deriveHomeSections } from '@features/owner-dashboard/homeSections';
import { Spotlight } from '@shared/ui-patterns/Spotlight';

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
  const profile = useProfileHeader();
  const [searchOpen, setSearchOpen] = useState(false);

  // Spotlight anchors. Refs rather than selectors so a refactor cannot leave
  // the tour dimming the screen and highlighting nothing.
  const gettingStartedRef = useRef<HTMLElement>(null);
  const actionCenterRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);

  // A hostel whose build was left unfinished — derived from the data itself
  // rather than a stored "onboarding step", which would drift the moment an
  // owner adds or deletes rooms from the Rooms tab.
  //
  // `findHostelInProgress` also requires the hostel to be ACTIVE, and that
  // half is load-bearing: this list is fetched with `include_archived: true`
  // so the ARCHIVED tab has rows, and an archived hostel reports no active
  // rooms — so it used to be indistinguishable from an unfinished build.
  // Owners were sent into the builder on an archived hostel and hit
  // "Cannot modify rooms/floors of an archived hostel" on saving a floor.
  const unfinished = findHostelInProgress(dash.properties);
  const hostelInProgress = unfinished
    ? { id: unfinished.id, name: unfinished.name, summary: 'No rooms added yet' }
    : null;

  const gettingStarted = useGettingStarted({
    ...dash.gettingStartedSignals,
    ownerId: dash.ownerId,
    hostelInProgress: hostelInProgress ? { name: hostelInProgress.name, summary: hostelInProgress.summary } : null,
    ready: !dash.isLoading,
  });

  // Home shows a card only once it has something true to put in it. See
  // `homeSections.ts` — a new owner used to meet a dashboard of zeros.
  const sections = deriveHomeSections(dash.homeSectionSignals);

  if (dash.isLoading) return <DashboardLoadingSkeleton />;

  return (
    <>
      <OwnerHomeDashboard
        ownerName={dash.ownerName}
        // Profile left the bottom nav for the Hostels tab; the avatar is how
        // an owner reaches it now.
        onOpenProfile={() => navigate('/owner/more')}
        // Same hook and cached query the Profile screen's own header uses, so
        // the avatar cannot disagree with itself across the two screens.
        ownerPhotoUrl={profile.photoUrl}
        ownerInitials={profile.initials}
        properties={dash.properties}
        alertCount={dash.alertCount}
        actionCenter={dash.actionCenter}
        collection={dash.collection}
        spendAnomaly={dash.spendAnomaly}
        sections={sections}
        onOpenAlerts={() => navigate('/owner/alerts')}
        onOpenQuickActions={qa.openSheet}
        onViewAllActions={qa.openAllActions}
        hostelInProgress={hostelInProgress}
        gettingStartedRef={gettingStartedRef}
        actionCenterRef={actionCenterRef}
        searchRef={searchRef}
        gettingStarted={
          gettingStarted.state.visible
            ? {
                state: gettingStarted.state,
                verification: gettingStarted.verification,
                onStep: (id) => {
                  if (id === 'hostel') {
                    navigate(hostelInProgress ? `/owner/hostels/${hostelInProgress.id}/build` : '/owner/hostels/new');
                  } else if (id === 'tenant') {
                    qa.inviteTenant();
                  } else {
                    navigate('/owner/money/collect');
                  }
                },
              }
            : null
        }
        onOpenSearch={() => setSearchOpen(true)}
        onOpenCollectionQueue={() => navigate('/owner/money/collect')}
        onOpenAgreements={() => navigate('/owner/agreements/review')}
        onOpenActivations={() => navigate(PENDING_ACTIVATIONS_PATH)}
        onOpenVacancies={() => navigate('/owner/rooms/vacant')}
        onOpenRevenue={() => navigate('/owner/money')}
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
        canOperate={dash.properties.length > 0}
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
      {/* Orientation, once, after the first hostel exists.
          It used to run on a completely empty account, where it dimmed the
          screen to point at an Action Center and a search bar that Home no
          longer renders that early — so stops were silently filtered out and
          the tour explained things that were not on screen. Waiting until
          there is a building to talk about also means every stop below has
          something real underneath it. `Spotlight` still drops any stop whose
          ref is empty, so the last two simply wait their turn until the first
          tenant brings those sections in. See ADR-139. */}
      <Spotlight
        open={gettingStarted.runSpotlight}
        onDone={gettingStarted.dismissSpotlight}
        stops={[
          {
            ref: gettingStartedRef,
            title: 'What to do next',
            body: 'Your remaining steps live here, and each one ticks itself off as you go. Nothing to remember.',
          },
          {
            ref: actionCenterRef,
            title: 'Your daily view',
            body: 'Rent to collect, tenants to activate and empty beds all show up here once people move in.',
          },
          {
            ref: searchRef,
            title: 'Find anyone, fast',
            body: 'Search a tenant, room number or phone number from anywhere on this screen.',
          },
        ]}
      />

      <QuickCollectModal open={qa.collectOpen} onClose={qa.closeCollect} initialTenant={qa.collectTenant} />
      <InviteTenantWizard open={qa.inviteOpen} onClose={qa.closeInvite} />
    </>
  );
}
