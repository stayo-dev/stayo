import { useState } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { FormConfig } from './types';
import { SuccessPanel } from './SuccessPanel';

function randomRef(prefix: string) {
  return `${prefix}-${200 + Math.floor(Math.random() * 799)}`;
}

interface FormPanelProps {
  config: FormConfig;
  onBack: () => void;
  onClose: () => void;
}

/** Full-screen, config-driven single-decision request form — Room services, "Raise a ticket"/"Report a bug", maintenance. One renderer for all 8 request flows, matching Stayo Tenant.dc.html's own FORM-map architecture. Shows a SuccessPanel in place once submitted. */
export function FormPanel({ config, onBack, onClose }: FormPanelProps) {
  const [optionId, setOptionId] = useState<string | undefined>(undefined);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  if (reference) {
    return (
      <SuccessPanel
        title={config.successTitle}
        sub={config.successSub}
        reference={`#${reference}`}
        onTrackStatus={onBack}
        onDone={onClose}
      />
    );
  }

  const missingOption = Boolean(config.needsOption && !optionId);
  const missingName = Boolean(config.needsName && !(inputs.name ?? '').trim());

  const handleSubmit = async () => {
    if (missingOption) {
      stayoToast.info('Please pick an option');
      return;
    }
    if (missingName) {
      stayoToast.info('Enter visitor name');
      return;
    }
    setSubmitting(true);
    try {
      await config.onSubmit({ optionId, inputs, note });
      setReference(randomRef(config.refPrefix));
    } catch {
      stayoToast.error('Could not submit — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stayo-panel-slide-in fixed inset-0 z-[46] flex flex-col bg-background">
      <div className="flex flex-none items-center gap-3 border-b border-[#EEE4D8] px-[18px] pb-3 pt-14">
        <button type="button" onClick={onBack} className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-[#EFE6DA] bg-card">
          <ChevronLeft className="h-[18px] w-[18px] text-[#4A433C]" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-foreground">{config.title}</div>
          <div className="text-[11.5px] font-medium text-[#8A7F75]">{config.sub}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-[18px] pb-5 pt-[18px]">
        <div className="flex flex-col gap-[18px]">
          <div className="font-display text-[16px] font-bold tracking-[-0.01em] text-foreground">{config.prompt}</div>

          {config.options && (
            <div className="flex flex-col gap-2.5">
              {config.options.map((o) => {
                const active = optionId === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOptionId(o.id)}
                    className={`flex items-center gap-3 rounded-2xl p-[14px_15px] text-left ${active ? 'border-[1.5px] border-primary bg-[#FBF3EF]' : 'border border-[#EAE1D8] bg-card'}`}
                  >
                    {o.icon && (
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">{o.icon}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-foreground">{o.label}</span>
                      {o.sub && <span className="mt-0.5 block text-[11.5px] font-medium text-[#9A8F84]">{o.sub}</span>}
                    </span>
                    <span
                      className={`flex h-5 w-5 flex-none items-center justify-center rounded-full ${active ? '' : 'border-2 border-[#DCD1C4]'}`}
                      style={active ? { background: '#A45D44' } : undefined}
                    >
                      {active && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {config.inputs && (
            <div className="flex flex-col gap-[13px]">
              {config.inputs.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-[#8A7F75]">{f.label}</span>
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    value={inputs[f.key] ?? ''}
                    onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3.5 text-sm font-medium text-foreground outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
          )}

          {config.banner && (
            <div className="flex gap-2.5 rounded-2xl border border-[#F1E2C4] bg-warning-bg p-[14px_15px]">
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-warning font-display text-[13px] font-extrabold text-white">i</span>
              <p className="flex-1 text-[12.5px] leading-relaxed text-[#7A5A24]">{config.banner}</p>
            </div>
          )}

          {config.note && (
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] font-semibold text-[#8A7F75]">{config.note.label}</span>
              <textarea
                placeholder={config.note.placeholder}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[84px] w-full resize-none rounded-xl border border-[#E4DACE] bg-card px-3.5 py-3.5 text-[13.5px] font-medium text-foreground outline-none focus:border-primary"
              />
            </label>
          )}

          {config.photos && (
            <button
              type="button"
              onClick={() => stayoToast.info('Photo added')}
              className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-[#D9CFC3] text-[#A2978B]"
              style={{ aspectRatio: '2/1' }}
            >
              <Plus className="h-[22px] w-[22px]" strokeWidth={1.7} />
              <span className="text-[11px] font-semibold">Add photo</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-none border-t border-[#EEE4D8] bg-background px-[18px] pb-[26px] pt-3.5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-2xl bg-[#A45D44] py-4 text-center font-display text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(164,93,68,0.25)] disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : config.submitLabel}
        </button>
      </div>
    </div>
  );
}
