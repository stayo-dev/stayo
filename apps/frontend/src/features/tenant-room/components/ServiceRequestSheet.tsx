import { useState } from 'react';
import { Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { ServiceRequestType } from '@features/tenant-room/api';

export interface RequestTypeConfig {
  type: ServiceRequestType;
  title: string;
  categories?: string[];
  /** Structured text fields (e.g. Visitor Pass's name/phone/date/time) — composed into the single `description` string the API accepts, since there's no dedicated backend column per field. */
  inputs?: Array<{ key: string; label: string; type: string; placeholder: string; required?: boolean }>;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  feeNote?: string;
}

interface ServiceRequestSheetProps {
  config: RequestTypeConfig | null;
  onClose: () => void;
  onSubmit: (data: { type: ServiceRequestType; category?: string; description: string }) => Promise<unknown>;
}

/**
 * One generic form driving all 6 tenant service-request types (maintenance,
 * room change, cleaning, lost key, visitor pass, extra mattress) — matches
 * the design's own single config-driven form engine rather than 6 bespoke flows.
 */
export function ServiceRequestSheet({ config, onClose, onSubmit }: ServiceRequestSheetProps) {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCategory(undefined);
    setInputValues({});
    setDescription('');
    setSubmitting(false);
    setDone(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const missingRequiredInput = Boolean(
    config?.inputs?.some((f) => f.required && !(inputValues[f.key] ?? '').trim()),
  );

  const handleSubmit = async () => {
    if (!config) return;
    setSubmitting(true);
    try {
      const structuredLines = (config.inputs ?? [])
        .map((f) => [f.label, (inputValues[f.key] ?? '').trim()] as const)
        .filter(([, value]) => value.length > 0)
        .map(([label, value]) => `${label}: ${value}`);
      const composedDescription = [...structuredLines, description.trim()].filter(Boolean).join('\n');
      await onSubmit({ type: config.type, category, description: composedDescription });
      setDone(true);
    } catch {
      // caller is responsible for surfacing the error (e.g. a toast) — the
      // sheet just stays on the form so the tenant can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet open={Boolean(config)} onOpenChange={(open) => !open && handleClose()} title={config?.title ?? ''}>
      {config && !done && (
        <div className="flex flex-col gap-4 pb-2">
          {config.categories && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Category</span>
              <div className="flex flex-wrap gap-2">
                {config.categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${
                      category === c ? 'border-primary bg-secondary/50 text-foreground' : 'border-border bg-card text-muted-foreground'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          {config.inputs && (
            <div className="flex flex-col gap-[13px]">
              {config.inputs.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-[#8A7F75]">{f.label}</span>
                  <input
                    type={f.type}
                    value={inputValues[f.key] ?? ''}
                    onChange={(e) => setInputValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
          )}
          {config.descriptionLabel && (
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {config.descriptionLabel}
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={config.descriptionPlaceholder}
                className="min-h-[90px] w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
              />
            </label>
          )}
          {config.feeNote && (
            <div className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-[12px] font-semibold text-warning">{config.feeNote}</div>
          )}
          <button
            type="button"
            disabled={submitting || (Boolean(config.categories) && !category) || missingRequiredInput}
            onClick={handleSubmit}
            className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      )}

      {config && done && (
        <div className="flex flex-col items-center gap-3 py-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="h-7 w-7" strokeWidth={2.5} />
          </span>
          <div className="font-display text-base font-bold text-foreground">Request submitted</div>
          <p className="text-center text-[12.5px] text-muted-foreground">We'll notify you as it's actioned.</p>
          <button type="button" onClick={handleClose} className="mt-2 rounded-xl bg-primary px-6 py-2.5 font-display text-sm font-bold text-primary-foreground">
            Done
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
