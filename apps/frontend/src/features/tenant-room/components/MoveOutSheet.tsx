import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Check, Heart, Star, X } from 'lucide-react';
import api from '@lib/api-client';
import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  MOVE_OUT_REASONS,
  hasFeedback,
  isAddressable,
  moveOutConsequences,
  raiseTarget,
  retentionOffer,
  todayISO,
  validateMoveOut,
  type MoveOutFeedback,
} from '../moveOut';

/**
 * Asking to move out — as a conversation, not a form.
 *
 * The first version put the reason, the date and a notes box on one screen
 * under three lines about deposits being settled. It was accurate and it read
 * like an exit interview conducted by a filing cabinet.
 *
 * The order is the point. **Why** comes first, alone, because the answer
 * changes what should happen next:
 *
 * - A broken geyser, the food, a roommate, the rent — things the hostel could
 *   fix and usually has not been told about, because leaving is easier than
 *   complaining. Those get **one** offer to raise it instead, specific to the
 *   reason, with moving out still one tap away.
 * - A finished course or a job in another city — nothing to fix, and pretending
 *   otherwise would be insulting. Those go straight through, warmly.
 *
 * Then the practicalities, then a last question nobody else will ever ask them:
 * what would have made them stay. Both halves optional, because a move-out
 * blocked on a survey is a survey nobody finishes.
 *
 * Retention that makes leaving *harder* is a dark pattern. Retention that makes
 * being *heard* easier is a service, and only the second one is here.
 */
type Step = 'reason' | 'offer' | 'raise' | 'raised' | 'details' | 'feedback' | 'done';

export function MoveOutSheet({
  open,
  onClose,
  roomNo,
  hostelName,
}: {
  open: boolean;
  onClose: () => void;
  roomNo?: string | null;
  hostelName?: string | null;
}) {
  const today = useMemo(() => todayISO(new Date()), []);
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [plannedExitDate, setPlannedExitDate] = useState('');
  const [feedback, setFeedback] = useState<MoveOutFeedback>({ rating: 0, note: '' });

  const check = validateMoveOut({ reason, reasonText, plannedExitDate, today });
  const offer = retentionOffer(reason);
  const target = raiseTarget(reason);
  const [raiseText, setRaiseText] = useState('');
  const where = hostelName?.trim() || 'your hostel';

  const raise = useMutation({
    mutationFn: async () => {
      if (!target) return null;
      const response = await api.post('/tenants/me/service-requests', {
        type: target.type,
        category: target.category,
        description: raiseText.trim(),
      });
      return response.data;
    },
    onSuccess: () => setStep('raised'),
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not send that — please try again'),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const response = await api.post('/move-out/requests', {
        reason,
        reasonText: reasonText.trim() || null,
        plannedExitDate,
        // Sent with the request so the hostel and Stayo both see it. The rating
        // is a review; the note is operational and stays unpublished.
        exitFeedback: hasFeedback(feedback)
          ? { rating: feedback.rating || null, note: feedback.note.trim() || null }
          : null,
      });
      return response.data;
    },
    onSuccess: () => setStep('done'),
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not send that — please try again'),
  });

  if (!open) return null;

  const back = () => {
    if (step === 'raise') return setStep('offer');
    if (step === 'feedback') return setStep('details');
    if (step === 'details') return setStep(offer ? 'offer' : 'reason');
    if (step === 'offer') return setStep('reason');
    onClose();
  };

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
        aria-label="Move out"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-t-[22px] bg-white sm:rounded-[22px]"
        style={{ padding: '18px 18px calc(18px + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-[#E0D5C6] sm:hidden" />

        {step !== 'done' && (
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={back}
              aria-label="Back"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5A5147] hover:bg-black/[.05]"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5A5147] hover:bg-black/[.05]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {step === 'reason' && (
          <>
            <h2 className="font-display text-[19px] font-extrabold tracking-tight text-[#221E1A]">
              Thinking of leaving {where}?
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#7A6F63]">
              Before anything else — what&apos;s made you consider it? It stays between you, {where} and Stayo.
            </p>

            <div className="mt-3.5 flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
              {MOVE_OUT_REASONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setReason(option.value);
                    setStep(isAddressable(option.value) ? 'offer' : 'details');
                  }}
                  className="rounded-xl px-3.5 py-3 text-left text-[13px] font-semibold text-[#221E1A]"
                  style={{ background: '#F7F3EF' }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'offer' && offer && (
          <>
            <div
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-[14px]"
              style={{ background: 'rgba(180,106,85,.12)' }}
            >
              <Heart className="h-5 w-5" style={{ color: '#B46A55' }} />
            </div>
            <h2 className="font-display text-[19px] font-extrabold tracking-tight text-[#221E1A]">{offer.headline}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#7A6F63]">{offer.body}</p>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                // Opens the box here rather than telling them where to find
                // one. "Go to the Room tab and tap Report a problem" is an
                // instruction; a cursor already in a field is an invitation,
                // and this is the one moment they are willing to type.
                onClick={() => setStep('raise')}
                className="w-full rounded-xl py-3 text-[13.5px] font-bold text-white"
                style={{ background: '#B46A55', boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
              >
                {offer.action}
              </button>
              {/* Always one tap away. Anything else would be a dark pattern. */}
              <button
                type="button"
                onClick={() => setStep('details')}
                className="w-full rounded-xl border border-border py-3 text-[13px] font-semibold text-[#9A8F84]"
              >
                No thanks, continue moving out
              </button>
            </div>
          </>
        )}

        {step === 'raise' && target && (
          <>
            <h2 className="font-display text-[18px] font-extrabold tracking-tight text-[#221E1A]">
              {offer?.action ?? 'Tell them'}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#7A6F63]">{target.prompt}</p>

            <textarea
              value={raiseText}
              onChange={(event) => setRaiseText(event.target.value)}
              rows={5}
              maxLength={1000}
              autoFocus
              placeholder={`Type it here — ${where} gets it straight away.`}
              className="mt-3 w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-[13.5px] text-[#2A2521]"
            />

            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={() => setStep('details')}
                className="rounded-xl border border-border px-4 py-3 text-[13px] font-semibold text-[#9A8F84]"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => raise.mutate()}
                disabled={!raiseText.trim() || raise.isPending}
                className="flex-1 rounded-xl py-3 text-[13.5px] font-bold text-white disabled:opacity-50"
                style={{ background: '#B46A55' }}
              >
                {raise.isPending ? 'Sending…' : 'Send to hostel'}
              </button>
            </div>
          </>
        )}

        {step === 'raised' && (
          <div className="py-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success-bg">
              <Check className="h-7 w-7 text-success" strokeWidth={2.4} />
            </div>
            <div className="font-display text-[18px] font-extrabold text-[#221E1A]">Sent to {where}</div>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] leading-relaxed text-[#7A6F63]">
              You can follow it from the Room tab. Give them a few days — and if nothing changes, moving out is still
              right here.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl py-3 text-sm font-bold text-white"
                style={{ background: '#B46A55' }}
              >
                Done
              </button>
              {/* Never a trap: the way out stays visible even here. */}
              <button
                type="button"
                onClick={() => setStep('details')}
                className="w-full rounded-xl border border-border py-3 text-[13px] font-semibold text-[#9A8F84]"
              >
                Still want to move out
              </button>
            </div>
          </div>
        )}

        {step === 'details' && (
          <>
            <h2 className="font-display text-[18px] font-extrabold tracking-tight text-[#221E1A]">
              When are you planning to leave?
            </h2>
            {roomNo && <p className="mt-0.5 text-[12px] text-[#9A8F84]">Room {roomNo}</p>}

            <label className="mt-3.5 block text-[11.5px] font-bold uppercase tracking-[.06em] text-[#8A7F75]">
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
              rows={2}
              maxLength={1000}
              placeholder={`${where} reads this.`}
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-[13.5px] text-[#2A2521]"
            />

            <ul className="mt-3 flex flex-col gap-1.5 rounded-xl bg-[#F7F3EF] px-3.5 py-3">
              {moveOutConsequences().map((line) => (
                <li key={line} className="text-[12px] leading-snug text-[#5A5147]">
                  {line}
                </li>
              ))}
            </ul>

            {!check.ok && plannedExitDate && (
              <p className="mt-2 text-[11.5px] font-medium text-[#D0473A]">{check.message}</p>
            )}

            <button
              type="button"
              onClick={() => setStep('feedback')}
              disabled={!check.ok}
              className="mt-3.5 w-full rounded-xl py-3 text-[13.5px] font-bold text-white disabled:opacity-50"
              style={{ background: '#B46A55' }}
            >
              Continue
            </button>
          </>
        )}

        {step === 'feedback' && (
          <>
            <h2 className="font-display text-[18px] font-extrabold tracking-tight text-[#221E1A]">
              One last thing, and it matters
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#7A6F63]">
              You know this place better than anyone still choosing it. How was your stay?
            </p>

            <div className="mt-3 flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  onClick={() => setFeedback((f) => ({ ...f, rating: f.rating === value ? 0 : value }))}
                  className="p-1"
                >
                  <Star
                    className="h-8 w-8"
                    strokeWidth={1.6}
                    style={{
                      color: value <= feedback.rating ? '#E0A100' : '#D9CDBC',
                      fill: value <= feedback.rating ? '#E0A100' : 'transparent',
                    }}
                  />
                </button>
              ))}
            </div>

            <label className="mt-3 block text-[11.5px] font-bold uppercase tracking-[.06em] text-[#8A7F75]">
              What would have made you stay?
            </label>
            <textarea
              value={feedback.note}
              onChange={(event) => setFeedback((f) => ({ ...f, note: event.target.value }))}
              rows={3}
              maxLength={600}
              placeholder="Only the hostel and Stayo see this — it is not published."
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-white px-3 py-2.5 text-[13.5px] text-[#2A2521]"
            />

            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={() => submit.mutate()}
                disabled={submit.isPending}
                className="rounded-xl border border-border px-4 py-3 text-[13px] font-semibold text-[#9A8F84] disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => submit.mutate()}
                disabled={submit.isPending}
                className="flex-1 rounded-xl py-3 text-[13.5px] font-bold text-white disabled:opacity-50"
                style={{ background: '#B46A55' }}
              >
                {submit.isPending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="py-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success-bg">
              <Check className="h-7 w-7 text-success" strokeWidth={2.4} />
            </div>
            <div className="font-display text-[18px] font-extrabold text-[#221E1A]">Thank you for telling us</div>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] leading-relaxed text-[#7A6F63]">
              {where} has your request and will confirm the date with you. Everything here keeps working until you
              actually leave — and if you change your mind before then, just tell them.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl py-3 text-sm font-bold text-white"
              style={{ background: '#B46A55' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
