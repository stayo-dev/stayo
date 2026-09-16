import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The design's dialog treatment (lifted from `StayoListedPanel`'s local
 * `Modal`/`Field`/`INPUT` so every admin action — not just listings — can use
 * an in-app dialog instead of a native `window.prompt`/`confirm`, which can't
 * be styled, doesn't fit the console's visual language, and (on phones)
 * renders as a browser-chrome alert rather than part of the app.
 */
export function Modal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-[adFade_.2s_ease] bg-[rgba(28,22,18,.44)]"
      />
      <div className="relative max-h-[90vh] w-full max-w-[520px] animate-[adUp_.24s_ease] overflow-y-auto rounded-[20px] bg-white shadow-[0_24px_60px_rgba(30,20,12,.3)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#F2ECE5] px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="font-admin text-[15px] font-extrabold tracking-[-0.01em] text-[#221E1A] sm:text-[16px]">{title}</div>
            {subtitle && <div className="mt-0.5 text-[12px] text-[#8A7F75]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-[#F2ECE5]"
          >
            <X className="h-3.5 w-3.5 text-[#7A6F63]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold text-[#5A5147]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-[#A2978B]">{hint}</span>}
    </label>
  );
}

export const MODAL_INPUT =
  'w-full rounded-[11px] border border-[#E7DDD1] bg-[#FCFAF7] px-3.5 py-2.5 text-[13px] text-[#2A2521] outline-none focus:border-[#B46A55] focus:bg-white';

/** Cancel/confirm footer shared by every action modal. */
export function ModalFooter({
  onCancel, onConfirm, confirmLabel, confirmTone = 'accent', disabled, pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmTone?: 'accent' | 'dark' | 'red' | 'green';
  disabled?: boolean;
  pending?: boolean;
}) {
  const tone: Record<string, string> = {
    accent: 'bg-[#B46A55]',
    dark: 'bg-[#221E1A]',
    red: 'bg-[#B3402F]',
    green: 'bg-[#1F7A52]',
  };
  return (
    <div className="flex gap-3 border-t border-[#F2ECE5] px-5 py-4 sm:px-6">
      <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-[#E9DFD3] bg-white py-3 font-admin text-[13px] font-bold text-[#5A5147]">
        Cancel
      </button>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={onConfirm}
        className={`flex-[1.4] rounded-xl py-3 font-admin text-[13px] font-bold text-white disabled:opacity-40 ${tone[confirmTone]}`}
      >
        {pending ? 'Working…' : confirmLabel}
      </button>
    </div>
  );
}
