import { useRef } from 'react';
import { Upload } from 'lucide-react';

interface UploadStepProps {
  onFile: (file: File) => void;
  onDownloadAgain: () => void;
  busy: boolean;
}

export function UploadStep({ onFile, onDownloadAgain, busy }: UploadStepProps) {
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-8 disabled:opacity-50"
      >
        <Upload className="h-6 w-6 text-primary" />
        <span className="font-display text-sm font-bold text-foreground">
          {busy ? 'Checking your sheet…' : 'Choose your filled-in sheet'}
        </span>
        <span className="text-[12px] font-medium text-muted-foreground">Excel or CSV, up to 150 tenants</span>
      </button>

      <p className="text-center text-[12px] font-medium text-muted-foreground">
        We&apos;ll check every row and show you anything that needs fixing. Nothing is created yet.
      </p>

      <button
        type="button"
        onClick={onDownloadAgain}
        className="w-full text-center text-[12.5px] font-semibold text-muted-foreground underline"
      >
        Download the sheet again
      </button>
    </div>
  );
}
