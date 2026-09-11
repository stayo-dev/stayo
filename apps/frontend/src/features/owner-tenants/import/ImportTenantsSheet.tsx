import { useEffect, useState } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useImportTenants } from './useImportTenants';
import { STAGES, STAGE_LABELS, canGoBack } from './importStages';
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
  const importer = useImportTenants(hostelId);

  useEffect(() => {
    if (open) {
      setHostelId(initialHostelId);
      importer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currentIndex = STAGES.indexOf(importer.stage);
  const showBack = currentIndex > 0 && canGoBack(importer.state);

  const goBack = () => {
    if (importer.stage === 'REVIEW') importer.reset();
    else if (importer.stage === 'UPLOAD' || importer.stage === 'DOWNLOAD') setHostelId(null);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex items-center gap-2">
          {showBack && (
            <button type="button" onClick={goBack} aria-label="Back" className="text-muted-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          Import tenants
        </span>
      }
    >
      {/* The stepper: compact on a phone — the current label, and dots for the
          rest — so six stages do not eat the screen. */}
      <ol className="mb-5 flex items-center gap-1.5" aria-label="Progress">
        {STAGES.map((s, i) => {
          const done = i < currentIndex;
          const here = i === currentIndex;
          return (
            <li key={s} className="flex flex-1 items-center gap-1.5 last:flex-none">
              <span
                aria-current={here ? 'step' : undefined}
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full font-display text-xs font-bold ${
                  done
                    ? 'bg-primary text-primary-foreground'
                    : here
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              {here && (
                <span className="whitespace-nowrap text-[13px] font-semibold text-foreground">
                  {STAGE_LABELS[s]}
                </span>
              )}
              {i < STAGES.length - 1 && (
                <span className={`h-0.5 flex-1 rounded-full ${done ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </li>
          );
        })}
      </ol>

      {importer.error && (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {importer.error}
        </p>
      )}

      {importer.stage === 'CHOOSE_HOSTEL' && <ChooseHostelStep onChoose={setHostelId} />}

      {importer.stage === 'DOWNLOAD' && (
        <GetSheetStep onDownload={importer.getTemplate} busy={importer.busy === 'template'} />
      )}

      {importer.stage === 'UPLOAD' && (
        <UploadStep
          onFile={importer.submitFile}
          busy={importer.busy === 'upload'}
          onDownloadAgain={importer.getTemplate}
        />
      )}

      {importer.stage === 'REVIEW' && importer.queue && (
        <ReviewStep
          queue={importer.queue}
          rooms={importer.upload?.rooms ?? null}
          onAcknowledgeGroup={importer.acknowledgeGroup}
          onImport={importer.runImport}
          busy={importer.busy === 'import'}
        />
      )}

      {importer.stage === 'IMPORT' && <ImportRunStep progress={importer.progress} onDone={onClose} />}

      {importer.stage === 'SEND' && (
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
