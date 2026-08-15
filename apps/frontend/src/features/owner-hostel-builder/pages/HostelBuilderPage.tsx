import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelBuilder, type BuilderStage } from '../useHostelBuilder';
import { defaultFloorName } from '../hostelBuilder';
import { NameStep } from '../steps/NameStep';
import { FloorsStep } from '../steps/FloorsStep';
import { FillFloorStep } from '../steps/FillFloorStep';
import { ReviewStep } from '../steps/ReviewStep';

/** Matches onboarding's "Step 1 of 8 · Owner" journey label. */
const STAGE_ORDER: BuilderStage[] = ['name', 'floors', 'fill', 'review'];
const STAGE_LABELS: Record<BuilderStage, string> = {
  name: 'Name',
  floors: 'Floors',
  fill: 'Rooms',
  review: 'Done',
};

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
    renameFloor,
    cloneToNext,
    advance,
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
      navigate(`/owner/hostels/${builder.hostelId}/rooms`);
    } catch (error) {
      stayoToast.error(errorMessage(error, 'Something went wrong. Please try again.'));
    }
  };

  const handleBack = () => {
    if (stage === 'fill' && activeIndex > 0) return setActiveIndex(activeIndex - 1);
    if (stage === 'fill') return setStage('floors');
    if (stage === 'floors') return setStage('name');
    if (stage === 'review') return setStage('fill');
    navigate('/owner');
  };

  const busy = createHostel.isPending || createFloors.isPending || saveFloor.isPending;

  const primaryLabel =
    stage === 'name'
      ? 'Create hostel'
      : stage === 'floors'
        ? 'Raise the floors'
        : stage === 'fill'
          ? activeIndex + 1 < floors.length
            ? 'Save floor & continue'
            : 'Save floor & finish'
          : 'Open my hostel';

  const canContinue =
    stage === 'name'
      ? Boolean(hostelName.trim()) && (!builder.needsPassword || password.trim().length > 0)
      : stage === 'fill'
        ? blocker === null
        : true;

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
    <div className="relative min-h-screen overflow-x-hidden bg-background [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px]">
      <div className="relative flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/72 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-7.5">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[10px] px-2 font-display text-[13px] font-bold text-foreground/80 active:scale-[0.97]"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Back
            </button>
            <div className="flex-1" />
            <span className="font-display text-[12px] font-bold text-muted-foreground">
              Step {STAGE_ORDER.indexOf(stage) + 1} of {STAGE_ORDER.length} · {STAGE_LABELS[stage]}
              {stage === 'fill' && floors.length > 0 ? ` ${activeIndex + 1}/${floors.length}` : ''}
            </span>
            <button
              type="button"
              onClick={() => navigate('/owner')}
              className="rounded-[10px] border border-border bg-card px-3 py-2 font-display text-[12.5px] font-bold text-foreground/80"
            >
              Finish later
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-7.5">
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
              onCloneToNext={cloneToNext}
              blocker={blocker}
            />
          ) : (
            <ReviewStep
              hostelName={hostelName}
              floors={floors}
              onEditFloor={(index) => {
                setActiveIndex(index);
                setStage('fill');
              }}
            />
          )}
        </main>

        <footer className="sticky bottom-0 border-t border-border/60 bg-background/80 px-4 py-3.5 backdrop-blur-md sm:px-7.5">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-muted-foreground">
              {stage === 'fill' || stage === 'review' ? progress.summary : ''}
            </span>
            <button
              type="button"
              onClick={handlePrimary}
              disabled={busy || !canContinue}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-6 font-display text-[14px] font-bold text-primary-foreground shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <StayoLoader size="sm" label={null} /> Saving…
                </>
              ) : (
                <>
                  {primaryLabel}
                  {stage === 'review' ? <Check className="h-4 w-4" strokeWidth={2.4} /> : <ArrowRight className="h-4 w-4" strokeWidth={2.4} />}
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
