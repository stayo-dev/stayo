import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { LoginModal } from '@shared/ui-patterns/LoginModal';
import { useMyStay } from '@features/stay/hooks/useMyStay';
import { StayActionPanel } from '@features/stay/components/StayActionPanel';
import { SCAN_MESSAGE, scanViewFor, shouldConfirmPresence } from '@features/stay/stayState';

/**
 * `/stay/:hostelId` — what the hostel's laminated QR opens. Scan, one tap,
 * done (ADR-193). Present: "You're in ✓", no button. Away: one big I'm back.
 * Everything else is behind More. Signs a first-time visitor in right here
 * and stays on this URL — see TenantRoutes for why it is outside the tenant
 * gate.
 */
export function StayScanPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const isTenant = String(user?.role ?? '').toLowerCase() === 'tenant';
  const { mine, isLoading, isError, record, isRecording } = useMyStay(isTenant);
  const [loginOpen, setLoginOpen] = useState(true);
  const confirmed = useRef(false);

  const view = scanViewFor({ signedIn: Boolean(user), role: user?.role, mine, hostelId });

  useEffect(() => {
    if (confirmed.current || !shouldConfirmPresence(view, mine?.stay)) return;
    confirmed.current = true;
    // The screen already says "You're in"; this only records that they scanned.
    record({ type: 'PRESENCE_CONFIRMED', source: 'QR', idempotencyKey: crypto.randomUUID() }).catch(() => {});
  }, [view, mine?.stay, record]);

  if (loading || (isTenant && isLoading)) return <StayoLoadingScreen />;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-between bg-background px-6 pb-10 pt-14 text-foreground">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {view === 'READY' && mine?.hostel ? mine.hostel.name : 'Stayo'}
      </p>

      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center">
        {view === 'SIGNED_OUT' && (
          <div className="flex w-full flex-col items-center gap-4 text-center">
            <p className="font-display text-3xl font-extrabold">Sign in once</p>
            <p className="text-muted-foreground">After this, scanning is one tap.</p>
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground"
            >
              Sign in
            </button>
            <LoginModal open={loginOpen} mode="tenant" onClose={() => setLoginOpen(false)} onSuccess={() => setLoginOpen(false)} />
          </div>
        )}

        {isTenant && isError && <p className="text-center text-lg font-semibold">Couldn't load your stay. Try scanning again.</p>}

        {view === 'READY' && mine?.stay && mine.hostel && (
          <StayActionPanel stay={mine.stay} hostelName={mine.hostel.name} source="QR" variant="full" onRecord={record} busy={isRecording} />
        )}

        {!isError && (view === 'NOT_TENANT' || view === 'NOT_RESIDENT' || view === 'OTHER_HOSTEL') && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-semibold">{SCAN_MESSAGE[view]}</p>
            {view !== 'NOT_TENANT' && (
              <button type="button" onClick={() => navigate('/tenant/home')} className="text-sm font-semibold text-primary">
                Open my dashboard
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">Stayo</p>
    </main>
  );
}
