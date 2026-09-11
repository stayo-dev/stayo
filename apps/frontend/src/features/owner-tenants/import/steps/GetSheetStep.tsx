import { Download, FileSpreadsheet } from 'lucide-react';

interface GetSheetStepProps {
  onDownload: () => void;
  busy: boolean;
}

/**
 * The sheet is built for this hostel — that is the whole point, so say it.
 * An owner who thinks this is a generic template will not understand why the
 * room dropdown matters.
 */
export function GetSheetStep({ onDownload, busy }: GetSheetStepProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <FileSpreadsheet className="h-6 w-6 text-primary" />
        <p className="mt-2.5 font-display text-sm font-bold text-foreground">
          Your sheet already knows this hostel
        </p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] font-medium text-muted-foreground">
          <li>· Your rooms are already filled in — add any that are missing.</li>
          <li>· The Room column is a dropdown, so it can&apos;t be mistyped.</li>
          <li>· Already living here? Put their real joining date and what they&apos;ve paid.</li>
        </ul>
      </div>

      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {busy ? 'Building your sheet…' : 'Download the sheet'}
      </button>
      <p className="text-center text-[12px] font-medium text-muted-foreground">
        Fill it in, then come back here and upload it. Nothing changes until you do.
      </p>
    </div>
  );
}
