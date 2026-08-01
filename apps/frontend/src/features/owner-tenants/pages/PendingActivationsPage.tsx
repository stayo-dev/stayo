import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { usePendingActivations } from '../hooks/usePendingActivations';
import { kycBadge } from '../activation/activationProgress';

const card =
  'flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/**
 * Pending Activations — every invited tenant and the step they are stuck on.
 *
 * Home's "Activate Tenants" card used to open the *Invite* wizard: it said
 * "N awaiting activation" and then asked the owner to invite somebody else.
 * This is where it goes now.
 *
 * Steps come from the backend's activation state machine; KYC is shown as a
 * separate badge and never affects the step.
 */
export function PendingActivationsPage() {
  const navigate = useNavigate();
  const { rows, count, isLoading, isError, refetch } = usePendingActivations();

  return (
    <ThemeProvider theme="product">
      <div className="min-h-screen bg-background [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px] sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border">
        <div className="flex items-center gap-2.5 px-4 pb-1.5 pt-6 sm:px-6">
          <button
            type="button"
            onClick={() => navigate('/owner/home')}
            aria-label="Back"
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          </button>
          <span className="text-[13px] font-medium text-muted-foreground">Home</span>
        </div>

        <div className="px-4 pb-3 pt-1 sm:px-6">
          <h1 className="font-display text-[21px] font-extrabold tracking-tight text-foreground">Pending activations</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {isLoading ? 'Loading…' : count === 0 ? 'Everyone is activated' : `${count} tenant${count === 1 ? '' : 's'} still onboarding`}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-4 pb-10 sm:px-6">
          {isLoading && (
            <>
              <div className="h-28 animate-pulse rounded-[18px] bg-muted" />
              <div className="h-28 animate-pulse rounded-[18px] bg-muted" />
            </>
          )}

          {isError && !isLoading && (
            <EmptyState
              icon={<X className="h-5 w-5" />}
              title="Couldn't load pending activations"
              action={
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
                >
                  Try again
                </button>
              }
            />
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5 text-success" />}
              title="All caught up"
              description="Every invited tenant has finished activating. New invitations will appear here."
              action={
                <button
                  type="button"
                  onClick={() => navigate('/owner/tenants')}
                  className="rounded-xl border border-border bg-card px-5 py-2.5 font-display text-sm font-bold text-foreground"
                >
                  View tenants
                </button>
              }
            />
          )}

          {rows.map((row) => {
            const kyc = kycBadge(row.documentVerified);
            return (
              <button
                key={row.tenantId}
                type="button"
                onClick={() => navigate(`/owner/tenants/${row.tenantId}`)}
                className={`${card} text-left`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14.5px] font-bold text-foreground">{row.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      Room {row.room}
                      {row.hostelName ? ` · ${row.hostelName}` : ''}
                    </div>
                  </div>
                  {row.waitingLabel && (
                    <span className="flex-none rounded-full bg-warning/10 px-2.5 py-1 font-display text-[11px] font-bold text-warning">
                      {row.waitingLabel}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 border-t border-border/60 pt-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Current step</div>
                    <div className="mt-0.5 text-[12.5px] font-semibold text-foreground">{row.currentLabel}</div>
                  </div>
                  <StatusPill tone={kyc.tone} variant="filter">
                    {kyc.label}
                  </StatusPill>
                  <ArrowRight className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={2} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </ThemeProvider>
  );
}
