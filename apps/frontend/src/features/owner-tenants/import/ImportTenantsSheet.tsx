import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useImportTenants } from './useImportTenants';
import { hostelChangeDiscardsBatch, navigationFor, STAGE_LABELS, type Stage } from './importStages';
import { LookingBackBar, StepBar } from './steps/StepBar';
import { ChooseHostelStep } from './steps/ChooseHostelStep';
import { GetSheetStep } from './steps/GetSheetStep';
import { UploadStep } from './steps/UploadStep';
import { ReviewStep } from './steps/ReviewStep';
import { ImportRunStep } from './steps/ImportRunStep';
import { SendInvitesStep } from './steps/SendInvitesStep';

interface ImportTenantsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selects the hostel when opened from inside one. */
  hostelId?: string | null;
}

/**
 * Import many tenants at once.
 *
 * Six steps, because the flow genuinely leaves the app in the middle: the
 * owner downloads a workbook, fills it in a spreadsheet, and comes back. The
 * stepper exists so they can always see where that put them.
 *
 * Everything this renders is decided in the pure modules beside it — the
 * frontend suite renders nothing, so any logic living in here would be
 * untested.
 */
export function ImportTenantsSheet({ open, onClose, hostelId: initialHostelId = null }: ImportTenantsSheetProps) {
  const [hostelId, setHostelId] = useState<string | null>(initialHostelId);
  // What the owner is *looking at*, which stops being their progress the
  // moment they step back. `null` means "wherever I have got to".
  const [viewing, setViewing] = useState<Stage | null>(null);
  const importer = useImportTenants(hostelId);

  useEffect(() => {
    if (open) {
      setHostelId(initialHostelId);
      setViewing(null);
      importer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nav = navigationFor(importer.state, viewing);

  const goTo = (stage: Stage) => setViewing(stage === nav.furthest ? null : stage);

  /**
   * An action that moves the flow on also gives up the owner's place in it.
   *
   * Without this, uploading a corrected sheet from the step they had stepped
   * back to would leave them staring at the upload box while the review they
   * asked for sat one step ahead, unmentioned.
   */
  const advance = <T extends unknown[]>(run: (...args: T) => void) => (...args: T) => {
    setViewing(null);
    run(...args);
  };

  /**
   * Picking a hostel from the step the owner stepped back to.
   *
   * Re-picking the same one must cost nothing, or Back is a trap. A different
   * one has to discard the batch: it was validated against the first hostel's
   * rooms, so importing it into another would put tenants in rooms that are
   * not theirs.
   */
  const chooseHostel = (id: string | null) => {
    if (hostelChangeDiscardsBatch(importer.state, id)) importer.reset();
    setHostelId(id);
    setViewing(null);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex items-center gap-1.5">
          {nav.back && (
            <button
              type="button"
              onClick={() => goTo(nav.back!)}
              aria-label={`Back to ${STAGE_LABELS[nav.back]}`}
              className="-ml-1.5 flex items-center gap-0.5 rounded-lg py-1 pl-1 pr-1.5 text-[13px] font-semibold text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          )}
          Import tenants
        </span>
      }
    >
      <StepBar nav={nav} onGo={goTo} />
      <LookingBackBar nav={nav} onGo={goTo} />

      {importer.error && (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {importer.error}
        </p>
      )}

      {nav.current === 'CHOOSE_HOSTEL' && <ChooseHostelStep onChoose={chooseHostel} />}

      {nav.current === 'DOWNLOAD' && (
        <GetSheetStep onDownload={advance(importer.getTemplate)} busy={importer.busy === 'template'} />
      )}

      {nav.current === 'UPLOAD' && (
        <UploadStep
          onFile={advance(importer.submitFile)}
          busy={importer.busy === 'upload'}
          onDownloadAgain={importer.getTemplate}
        />
      )}

      {nav.current === 'REVIEW' && importer.queue && (
        <ReviewStep
          queue={importer.queue}
          rooms={importer.upload?.rooms ?? null}
          edits={importer.edits}
          onEdit={importer.applyEdit}
          onRecheck={importer.recheck}
          onDownloadCorrected={importer.getCorrectedSheet}
          onAcknowledgeGroup={importer.acknowledgeGroup}
          onImport={advance(importer.runImport)}
          busy={importer.busy === 'import'}
          rechecking={importer.busy === 'recheck'}
          downloading={importer.busy === 'corrected'}
        />
      )}

      {nav.current === 'IMPORT' && <ImportRunStep progress={importer.progress} onDone={onClose} />}

      {nav.current === 'SEND' && (
        <SendInvitesStep
          progress={importer.progress}
          waiting={importer.state.queuedInvitations}
          sent={importer.sendResult?.sent ?? 0}
          busy={importer.busy === 'send'}
          onSendAll={() => importer.send()}
          onSendWave={() => importer.send(10)}
          onClose={onClose}
        />
      )}
    </BottomSheet>
  );
}
