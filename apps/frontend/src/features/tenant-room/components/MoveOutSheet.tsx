import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, LogOut, X } from 'lucide-react';
import api from '@lib/api-client';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { MOVE_OUT_REASONS, moveOutConsequences, todayISO, validateMoveOut } from '../moveOut';

/**
 * "Request to move out".
 *
 * Reached from two places — the Room tab and the profile's stay card — as one
 * component, so the two cannot ask different questions or send different
 * payloads.
 *
 * It states what follows before it asks for confirmation. Moving out settles a
 * deposit, frees a bed and puts a request in front of an owner; a tenant is
 * entitled to know that before tapping rather than after.
 */
export function MoveOutSheet({
  open,
  onClose,
  roomNo,
}: {
  open: boolean;
  onClose: () => void;
  roomNo?: string | null;
}) {
  const today = useMemo(() => todayISO(new Date()), []);
  const [reason, setReason] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [plannedExitDate, setPlannedExitDate] = useState('');
  const [sent, setSent] = useState(false);

  const check = validateMoveOut({ reason, reasonText, plannedExitDate, today });

  const submit = useMutation({
    mutationFn: async () => {
      // The server reads the tenancy from the session and sets
      // initiatedByRole itself — the client does not get to claim who it is.
      const response = await api.post('/move-out/requests', {
        reason,
        reasonText: reasonText.trim() || null,
        plannedExitDate,
      });
      return response.data;
    },
    onSuccess: () => setSent(true),
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not send that — please try again'),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(20,16,13,.5)' }}
      role="presentation"
      onClick={() => (submit.isPending ? undefined : onClose())}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Request to move out"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[480px] rounded-t-[22px] bg-white sm:rounded-[22px]"
        style={{ padding: '18px 18px calc(18px + env(safe-area-inset-bottom))' }}
      >
        {sent ? (
          <div className="py-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success-bg">
              <Check className="h-7 w-7 text-success" strokeWidth={2.4} />
            </div>
            <div className="font-display text-[18px] font-extrabold text-[#221E1A]">Request sent</div>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] leading-relaxed text-[#7A6F63]">
              Your hostel has it and will confirm the date with you. You can keep using everything here until you
              actually leave.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-bold text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-[18px] font-extrabold tracking-tight text-[#221E1A]">
                  Request to move out
                </h2>
                {roomNo && <p className="mt-0.5 text-[12px] text-[#9A8F84]">Room {roomNo}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-[#5A5147] hover:bg-black/[.05]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Said before the ask, not after. */}
            <ul className="mt-3 flex flex-col gap-1.5 rounded-xl bg-[#F7F3EF] px-3.5 py-3">
              {moveOutConsequences().map((line) => (
                <li key={line} className="text-[12px] leading-snug text-[#5A5147]">
                  {line}
                </li>
              ))}
            </ul>

            <label className="mt-3.5 block text-[11.5px] font-bold uppercase tracking-[.06em] text-[#8A7F75]">
              Why are you leaving?
            </label>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13.5px] text-[#2A2521]"
            >
              <option value="">Choose a reason</option>
              {MOVE_OUT_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-[11.5px] font-bold uppercase tracking-[.06em] text-[#8A7F75]">
              Planned last day
            </label>
            <input
              type="date"
              min={today}
              value={plannedExitDate}
              onChange={(event) => setPlannedExitDate(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13.5px] text-[#2A2521]"
            />

            <label className="mt-3 block text-[11.5px] font-bold uppercase tracking-[.06em] text-[#8A7F75]">
              Anything to add {reason === 'OTHER' ? '' : '(optional)'}
            </label>
            <textarea
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="The hostel reads this."
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-[13.5px] text-[#2A2521]"
            />

            {!check.ok && (reason || plannedExitDate || reasonText) && (
              <p className="mt-2 text-[11.5px] font-medium text-[#D0473A]">{check.message}</p>
            )}

            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submit.isPending}
                className="rounded-xl border border-border px-4 py-3 text-sm font-bold text-[#221E1A] disabled:opacity-50"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => submit.mutate()}
                disabled={!check.ok || submit.isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {submit.isPending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
