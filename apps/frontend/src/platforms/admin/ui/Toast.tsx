import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

export type ToastKind = 'ok' | 'no';
export type ToastState = { message: string; kind: ToastKind } | null;

/**
 * The design's single transient-feedback channel. Every destructive or
 * irreversible admin action (approve, reject, publish) confirms through here,
 * so an admin always gets an acknowledgement that the action landed.
 */
export function useAdminToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((message: string, kind: ToastKind = 'ok') => {
    setToast({ message, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { toast, fire };
}

export function AdminToast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  const Icon = toast.kind === 'ok' ? Check : X;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center">
      <div className="flex animate-[adToast_2.6s_ease_forwards] items-center gap-2.5 rounded-full bg-[#221E1A] px-5 py-3 text-white shadow-[0_12px_30px_rgba(34,30,26,.32)]">
        <span
          className={`flex h-5 w-5 flex-none items-center justify-center rounded-full ${
            toast.kind === 'ok' ? 'bg-[#1F7A52]' : 'bg-[#B3402F]'
          }`}
        >
          <Icon className="h-3 w-3" strokeWidth={3} />
        </span>
        <span className="text-[13px] font-semibold">{toast.message}</span>
      </div>
    </div>
  );
}
