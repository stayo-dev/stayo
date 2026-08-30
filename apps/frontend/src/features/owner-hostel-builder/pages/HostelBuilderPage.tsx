import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelBuilder, type BuilderStage } from '../useHostelBuilder';
import { builderJourney, continueBlocker } from '../builderJourney';
import { primaryFloorAction, primaryFloorLabel } from '../floorStrip';
import { defaultFloorName } from '../hostelBuilder';
import { isAgreementSettled, type AgreementChoice } from '../agreementSetup';
import { useAgreementSetupState, useSaveAgreementDecision } from '../useAgreementSetup';
import { NameStep } from '../steps/NameStep';
import { FloorsStep } from '../steps/FloorsStep';
import { FillFloorStep } from '../steps/FillFloorStep';
import { ReviewStep } from '../steps/ReviewStep';
import { AgreementDecisionStep } from '../steps/AgreementDecisionStep';
import { APP_GRID } from '@shared/ui/surface';

/** The form every step renders into, so the sticky footer button can submit it. */
const STEP_FORM_ID = 'hostel-builder-step';

function errorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || (error as Error)?.message || fallback;
}

/**
 * Add Hostel — the owner builds their property.
 *
 * Replaces the floors/rooms/beds steps that used to sit inside signup.
 *
 * Sits on the standard owner graph-paper background. It used to carry an
 * animated building that grew a storey per floor added — see the note at the
 * render root for why that went.
 *
 * Nothing is held hostage — the hostel exists from the moment it is named,
 * every floor is saved as it is finished, and leaving mid-build is a normal
 * exit that the home screen offers to resume.
 */
export function HostelBuilderPage() {
  const navigate = useNavigate();
  const { hostelId: existingHostelId } = useParams<{ hostelId: string }>();
  const builder = useHostelBuilder(existingHostelId);

  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [floorCount, setFloorCount] = useState(3);
  const [floorNames, setFloorNames] = useState<string[]>(() =>
    Array.from({ length: 3 }, (_, i) => defaultFloorName(i)),
  );
  const [agreementChoice, setAgreementChoice] = useState<AgreementChoice>(null);
  const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null);

  const agreementState = useAgreementSetupState(builder.hostelId || null);
  const saveAgreement = useSaveAgreementDecision(builder.hostelId);
  const agreementSettled = isAgreementSettled({
    agreementRequired: agreementState.agreementRequired,
    signatureConfigured: agreementState.signatureConfigured,
  });
  const hasSignature = Boolean(signatureBlob) || agreementState.signatureConfigured;

  const {
    stage,
    setStage,
    hostelName,
    setHostelName,
    floors,
    activeIndex,
    setActiveIndex,
    activeFloor,
    pattern,
    setPattern,
    progress,
    blocker,
    createHostel,
    createFloors,
    saveFloor,
    setRoomCount,
    setFloorDefaults,
    updateRoom,
    removeRoom,
    renameFloor,
    cloneToNext,
    advance,
    goToFloor,
    isRestoring,
  } = builder;

  const setCount = (count: number) => {
    setFloorCount(count);
    setFloorNames((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? defaultFloorName(i)),
    );
  };

  const handlePrimary = async () => {
    try {
      if (stage === 'name') {
        if (!hostelName.trim()) {
          stayoToast.error('Give your hostel a name to continue.');
          return;
        }
        // Stepping back to this screen and continuing used to POST a *second*
        // hostel and abandon the first, half-built, in the owner's account.
        // Once the row exists this screen is a review of it, not a create.
        if (builder.hostelId) {
          setStage('floors');
          return;
        }
        await createHostel.mutateAsync({ name: hostelName, city, password: password || undefined });
        return;
      }
      if (stage === 'floors') {
        await createFloors.mutateAsync(floorNames.map((name, i) => name.trim() || defaultFloorName(i)));
        return;
      }
      if (stage === 'fill') {
        await advance();
        return;
      }
      if (stage === 'review') {
        // The agreement decision is one-time, hostel-wide — so a build that
        // already settled it (resumed, or the owner already said "No") skips
        // straight to Rooms instead of re-asking.
        if (!agreementSettled) {
          setStage('agreement');
          return;
        }
        navigate(`/owner/hostels/${builder.hostelId}/rooms`);
        return;
      }
      if (stage === 'agreement') {
        if (agreementChoice === 'no') {
          await saveAgreement.mutateAsync({ choice: 'no' });
        } else if (agreementChoice === 'yes' && signatureBlob) {
          const file = new File([signatureBlob], 'owner_signature.png', { type: 'image/png' });
          await saveAgreement.mutateAsync({
            choice: 'yes',
            signatureFile: file,
            hasActiveTemplate: agreementState.hasActiveTemplate,
          });
        } else {
          return;
        }
        navigate(`/owner/hostels/${builder.hostelId}/rooms`);
      }
    } catch (error) {
      stayoToast.error(errorMessage(error, 'Something went wrong. Please try again.'));
    }
  };

  const handleBack = () => {
    if (stage === 'agreement') return setStage('review');
    if (stage === 'fill' && activeIndex > 0) return setActiveIndex(activeIndex - 1);
    if (stage === 'fill') {
      // Re-seed the count and names from the floors that were actually
      // created, so the step never shows a shape the hostel does not have.
      if (floors.length > 0) {
        setFloorCount(floors.length);
        setFloorNames(floors.map((floor, i) => floor.name || defaultFloorName(i)));
      }
      return setStage('floors');
    }
    if (stage === 'floors') return setStage('name');
    if (stage === 'review') return setStage('fill');
    navigate('/owner');
  };

  const busy = createHostel.isPending || createFloors.isPending || saveFloor.isPending || saveAgreement.isPending;

  const primaryLabel =
    stage === 'name'
      ? builder.hostelId
        ? 'Continue'
        : 'Create hostel'
      : stage === 'floors'
        ? floors.length > 0
          ? 'Continue'
          : 'Raise the floors'
        : stage === 'fill'
          // Follows what the button will actually do — it continues to the
          // next floor still needing rooms, not simply the next index, so the
          // label has to be derived from the same rule. See `floorStrip.ts`.
          ? primaryFloorLabel(primaryFloorAction(floors, activeIndex))
          : stage === 'review'
            ? agreementSettled
              ? 'Open my hostel'
              : 'Continue'
            : 'Finish setup';

  // True on whichever stage is actually the last tap of the build — Review
  // itself only when there is nothing left to settle after it.
  const isFinalStep = stage === 'agreement' || (stage === 'review' && agreementSettled);

  const whyBlocked = continueBlocker(stage, {
    hostelName,
    needsPassword: builder.needsPassword,
    password,
    floorBlocker: blocker,
    agreementChoice,
    hasSignature,
  });
  const canContinue = whyBlocked === null;

  const journey = builderJourney(stage, {
    activeIndex,
    floorCount: floors.length,
  });

  return (
    // Mounted as a sibling of OwnerAppShell (a full-screen takeover, not a
    // bottom-nav tab), so it never inherits the shell's ThemeProvider and has
    // to scope the StayO tokens itself. Without this the page falls through to
    // theme.css's unscoped `:root` — the legacy pre-rebrand palette — and
    // renders in navy and a serif face. Same fix its sibling routes
    // (PendingActivationsPage, PendingVerificationsPage, TenantDetailPage)
    // already carry; see [[Bugs]] "Activate Tenants queue rendered in the
    // legacy pre-StayO theme".
    <ThemeProvider theme="product">
    {/* The animated `HostelScene` illustration used to sit behind this form,
        under a gradient scrim. Removed 2026-08-15: the graph-paper grid is
        what every other owner surface uses (OwnerAppShell, TenantDetailPage,
        HostelDrilldownLayout — `Stayo App.dc.html`'s root treatment), and a
        moving building competing with the form made this one screen the
        outlier.

        `HostelScene` itself is untouched and still live — the onboarding
        wizard renders it. `builderScene.ts`, which mapped this page's
        stage/floor state onto that scene, had no other consumer and was
        deleted with its test file. Restoring the illustration here means
        writing that mapping again; it is in git history, not on disk. */}
    <div className={`relative min-h-screen overflow-x-hidden bg-background ${APP_GRID}`}>
      <div className="relative flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/72 backdrop-blur-md">
          <div className="mx-auto flex max-w-[680px] items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[10px] px-2 font-display text-[13px] font-bold text-foreground/80 active:scale-[0.97]"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Back
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => navigate('/owner')}
              className="rounded-[10px] border border-border bg-card px-3 py-2 font-display text-[12.5px] font-bold text-foreground/80"
            >
              Finish later
            </button>
          </div>

          {/* The bar tracks the real work — the Rooms phase advances floor by
              floor — rather than dividing a five-floor building into "step 3
              of 4". `aria-live` on the label because the phase changing is the
              only announcement a screen reader gets: the step swap is a
              re-render, not a navigation. */}
          <div className="mx-auto max-w-[680px] px-4 pb-3 sm:px-6">
            <div
              role="progressbar"
              aria-valuenow={journey.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Setup progress"
              className="h-1.5 w-full overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${journey.percent}%` }}
              />
            </div>
            <p aria-live="polite" className="mt-1.5 font-display text-[11.5px] font-bold tracking-wide text-muted-foreground">
              {journey.phase.toUpperCase()} · {journey.label}
            </p>
          </div>
        </header>

        {/* Centred and capped. The steps render a ~440px column, which inside
            a `max-w-6xl` page left two thirds of a desktop screen empty to the
            right of the form and made the whole thing read as unfinished. */}
        <main className="mx-auto w-full max-w-[680px] flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {/* One form around every step, rather than one per step. Enter now
              submits from any field on any screen — on a two-field first
              screen that was the obvious gesture and it did nothing — and the
              sticky footer button drives it via `form={STEP_FORM_ID}`, which
              works across the DOM distance between them. */}
          <form
            id={STEP_FORM_ID}
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !canContinue) return;
              void handlePrimary();
            }}
          >
          {isRestoring ? (
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              <StayoLoader size="sm" label={null} /> Picking up where you left off…
            </div>
          ) : stage === 'name' ? (
            <NameStep
              name={hostelName}
              onNameChange={setHostelName}
              city={city}
              onCityChange={setCity}
              isSubmitting={createHostel.isPending}
              error={
                // The first 403 is not a failure the owner caused — it is the
                // step-up prompt arriving. Show the raw message only once they
                // have actually typed a password and it still did not work.
                createHostel.isError && !(builder.needsPassword && !password)
                  ? errorMessage(createHostel.error, 'Could not create the hostel')
                  : null
              }
              needsPassword={builder.needsPassword}
              password={password}
              onPasswordChange={setPassword}
            />
          ) : stage === 'floors' ? (
            <FloorsStep count={floorCount} onCountChange={setCount} names={floorNames} onRename={(i, name) => {
              setFloorNames((prev) => prev.map((existing, index) => (index === i ? name : existing)));
            }} />
          ) : stage === 'fill' && activeFloor ? (
            <FillFloorStep
              floor={activeFloor}
              floorIndex={activeIndex}
              floorCount={floors.length}
              pattern={pattern}
              onPatternChange={setPattern}
              onRoomCountChange={setRoomCount}
              onDefaultsChange={setFloorDefaults}
              onRoomChange={updateRoom}
              onRoomRemove={removeRoom}
              onCloneToNext={cloneToNext}
              floors={floors}
              onSelectFloor={goToFloor}
            />
          ) : stage === 'review' ? (
            <ReviewStep
              hostelName={hostelName}
              floors={floors}
              onEditFloor={(index) => {
                setActiveIndex(index);
                setStage('fill');
              }}
            />
          ) : (
            <AgreementDecisionStep
              choice={agreementChoice}
              onChoiceChange={setAgreementChoice}
              hasSignature={hasSignature}
              existingSignatureUrl={agreementState.signatureUrl}
              onSignatureChange={setSignatureBlob}
            />
          )}
          </form>
        </main>

        <footer className="sticky bottom-0 border-t border-border/60 bg-background/80 px-4 py-3.5 backdrop-blur-md sm:px-7.5">
          <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3">
            {/* A dimmed button used to be the only signal, and the message
                written for it lived inside a click handler a disabled button
                never reaches. Now the reason sits beside it. */}
            <span
              aria-live="polite"
              className={`text-[12.5px] font-semibold ${whyBlocked ? 'text-warning' : 'text-muted-foreground'}`}
            >
              {whyBlocked ?? (stage === 'fill' || stage === 'review' ? progress.summary : '')}
            </span>
            <button
              type="submit"
              form={STEP_FORM_ID}
              disabled={busy || !canContinue}
              className="inline-flex min-h-[48px] flex-none items-center gap-2 rounded-xl bg-primary px-6 font-display text-[14px] font-bold text-primary-foreground shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <StayoLoader size="sm" label={null} /> Saving…
                </>
              ) : (
                <>
                  {primaryLabel}
                  {isFinalStep ? <Check className="h-4 w-4" strokeWidth={2.4} /> : <ArrowRight className="h-4 w-4" strokeWidth={2.4} />}
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
    </ThemeProvider>
  );
}
