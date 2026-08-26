import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Heart } from 'lucide-react';
import api from '@lib/api-client';
import { C, FONT } from '@/app/pages/discover/discoverTheme';
import {
  CLOSURE_REASONS,
  CONFIRM_PHRASE,
  RETAINED_NOTICE,
  canClose,
  closureBlocker,
  confirmPhraseMatches,
  retentionOffer,
  whatYouLose,
  type ClosureContext,
} from '../accountClosure';

/**
 * Leaving Stayo, one screen at a time.
 *
 * The brief asked for enough friction that someone thinks twice. **Every step
 * here is made of information, not obstruction** — what specifically they
 * lose, what we cannot delete and why, and the smaller fix where one honestly
 * exists. Someone who reads all of it and still means it gets out in three
 * taps; nothing is hidden and nothing is refused. See `accountClosure.ts`.
 *
 * The shape deliberately matches `MoveOutSheet` — leaving a hostel and leaving
 * Stayo should not feel designed by different people.
 */

type Step = 'blocked' | 'lose' | 'reason' | 'offer' | 'confirm' | 'done';

export function CloseAccountSheet({
  open,
  onClose,
  context,
  losses,
}: {
  open: boolean;
  onClose: () => void;
  context: ClosureContext;
  losses: Parameters<typeof whatYouLose>[0];
}) {
  const navigate = useNavigate();
  const blocker = closureBlocker(context);
  const [step, setStep] = useState<Step>(blocker ? 'blocked' : 'lose');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');

  const closeMutation = useMutation({
    mutationFn: () =>
      api.post('/profile/close-account', { confirm: CONFIRM_PHRASE, reason, note: note.trim() || undefined }),
    onSuccess: () => setStep('done'),
  });

  if (!open) return null;

  const items = whatYouLose(losses);
  const offer = retentionOffer(reason);

  const back = () => {
    if (step === 'reason') setStep('lose');
    else if (step === 'offer') setStep('reason');
    else if (step === 'confirm') setStep(offer ? 'offer' : 'reason');
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex flex-col" style={{ background: C.paper }}>
      <header
        className="flex flex-none items-center gap-3 border-b px-5 pb-3.5 pt-[max(2.5rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        {step !== 'done' && (
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
            style={{ background: '#F4EEE7' }}
          >
            <ArrowLeft className="h-[18px] w-[18px]" style={{ color: '#6B6259' }} />
          </button>
        )}
        <h1 className="text-[17px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
          {step === 'done' ? 'Account closed' : 'Close your account'}
        </h1>
      </header>

      <main className="flex-1 overflow-auto px-5 py-5">
        {/* ---- Something has to happen first ----------------------------- */}
        {step === 'blocked' && blocker && (
          <section>
            <span
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ background: '#FBF1DE', color: C.amber }}
            >
              <AlertTriangle className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <h2 className="mt-3 text-[19px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
              {blocker.title}
            </h2>
            <p className="mt-2 text-[13px] leading-[1.6]" style={{ color: C.textBody }}>
              {blocker.body}
            </p>
            {blocker.action && (
              <button
                type="button"
                onClick={() => { onClose(); navigate(blocker.action!.to); }}
                className="mt-4 inline-flex items-center gap-2 rounded-[11px] px-4 py-3 text-[13px] font-extrabold text-white"
                style={{ fontFamily: FONT.display, background: C.clay }}
              >
                {blocker.action.label}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </section>
        )}

        {/* ---- What actually goes ---------------------------------------- */}
        {step === 'lose' && (
          <section>
            <h2 className="text-[19px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
              Here&rsquo;s what you&rsquo;d be giving up
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-[1.55]" style={{ color: C.textMuted }}>
              Not a warning — just the things that don&rsquo;t come back.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {items.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border bg-white p-4"
                  style={{ borderColor: C.line }}
                >
                  <div className="text-[13.5px] font-bold" style={{ color: C.text }}>{item.label}</div>
                  <p className="mt-1 text-[12px] leading-[1.55]" style={{ color: C.textBody }}>{item.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-[11px] py-3.5 text-[13.5px] font-extrabold text-white"
                style={{ fontFamily: FONT.display, background: C.clay }}
              >
                Keep my account
              </button>
              <button
                type="button"
                onClick={() => setStep('reason')}
                className="rounded-[11px] border px-4 py-3.5 text-[13px] font-semibold"
                style={{ borderColor: C.lineInput, color: C.textMuted }}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {/* ---- Why ------------------------------------------------------- */}
        {step === 'reason' && (
          <section>
            <h2 className="text-[19px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
              What&rsquo;s making you go?
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-[1.55]" style={{ color: C.textMuted }}>
              This is the part we actually read. It is how Stayo gets better for whoever comes next.
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {CLOSURE_REASONS.map((option) => {
                const selected = reason === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setReason(option.id)}
                    aria-pressed={selected}
                    className="flex items-center gap-2.5 rounded-xl px-4 py-3 text-left"
                    style={{
                      background: selected ? 'rgba(180,106,85,.08)' : '#FFFFFF',
                      border: `1.5px solid ${selected ? C.clay : C.line}`,
                    }}
                  >
                    <span
                      className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full"
                      style={{
                        background: selected ? C.clay : '#FFFFFF',
                        border: `1.5px solid ${selected ? C.clay : '#D9CDBC'}`,
                      }}
                    >
                      {selected && <Check className="h-3 w-3 text-white" strokeWidth={3.2} />}
                    </span>
                    <span className="text-[13px] font-semibold" style={{ color: C.inkSoft }}>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anything else you want to tell us? (optional)"
              className="mt-3 w-full resize-none rounded-xl border px-3.5 py-3 text-[13px] outline-none"
              style={{ borderColor: C.lineInput, background: '#FFFFFF', color: C.text }}
            />

            <button
              type="button"
              disabled={!reason}
              onClick={() => setStep(retentionOffer(reason) ? 'offer' : 'confirm')}
              className="mt-4 w-full rounded-[11px] py-3.5 text-[13.5px] font-extrabold disabled:opacity-40"
              style={{ fontFamily: FONT.display, background: C.ink, color: '#fff' }}
            >
              Continue
            </button>
          </section>
        )}

        {/* ---- The smaller fix, offered once ----------------------------- */}
        {step === 'offer' && offer && (
          <section>
            <span
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ background: C.clayPaleBg, color: C.clay }}
            >
              <Heart className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <h2 className="mt-3 text-[19px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
              {offer.title}
            </h2>
            <p className="mt-2 text-[13px] leading-[1.6]" style={{ color: C.textBody }}>
              {offer.body}
            </p>
            {offer.action && (
              <button
                type="button"
                onClick={() => { onClose(); navigate(offer.action!.to); }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[11px] py-3.5 text-[13.5px] font-extrabold text-white"
                style={{ fontFamily: FONT.display, background: C.clay }}
              >
                {offer.action.label}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {/* Always available, never buried — the offer is a suggestion. */}
            <button
              type="button"
              onClick={() => setStep('confirm')}
              className="mt-2 w-full py-3 text-center text-[12.5px] font-semibold underline"
              style={{ color: C.textMuted }}
            >
              No thanks, close my account
            </button>
          </section>
        )}

        {/* ---- Confirm --------------------------------------------------- */}
        {step === 'confirm' && (
          <section>
            <h2 className="text-[19px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
              This can&rsquo;t be undone
            </h2>

            <div className="mt-3 rounded-2xl border p-4" style={{ borderColor: C.line, background: '#FFFFFF' }}>
              <div className="text-[13px] font-bold" style={{ color: C.text }}>{RETAINED_NOTICE.title}</div>
              <p className="mt-1 text-[12px] leading-[1.55]" style={{ color: C.textBody }}>{RETAINED_NOTICE.body}</p>
            </div>

            <label className="mt-4 block text-[12.5px] font-semibold" style={{ color: C.textBody }}>
              Type <span style={{ fontFamily: FONT.display, color: C.text }}>{CONFIRM_PHRASE}</span> to confirm
            </label>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder={CONFIRM_PHRASE}
              className="mt-1.5 w-full rounded-xl border px-3.5 py-3 text-[15px] font-bold tracking-[0.2em] outline-none"
              style={{
                borderColor: confirmPhraseMatches(typed) ? C.clay : C.lineInput,
                background: '#FFFFFF',
                color: C.text,
              }}
            />

            {closeMutation.isError && (
              <p className="mt-2 text-[12px] font-semibold" style={{ color: '#B4453A' }}>
                {(closeMutation.error as any)?.response?.data?.error?.message
                  ?? 'Could not close the account. Please try again.'}
              </p>
            )}

            <button
              type="button"
              disabled={!canClose({ reason, note }, typed) || closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
              className="mt-4 w-full rounded-[11px] py-3.5 text-[13.5px] font-extrabold text-white disabled:opacity-40"
              style={{ fontFamily: FONT.display, background: '#B3402F' }}
            >
              {closeMutation.isPending ? 'Closing…' : 'Close my account'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full py-3 text-center text-[13px] font-bold"
              style={{ fontFamily: FONT.display, color: C.clayDeep }}
            >
              Keep my account
            </button>
          </section>
        )}

        {/* ---- Gone ------------------------------------------------------ */}
        {step === 'done' && (
          <section className="pt-6 text-center">
            <span
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: C.greenPale, color: C.green }}
            >
              <Check className="h-6 w-6" strokeWidth={2.6} />
            </span>
            <h2 className="mt-4 text-[19px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
              That&rsquo;s done
            </h2>
            <p className="mx-auto mt-2 max-w-[300px] text-[13px] leading-[1.6]" style={{ color: C.textBody }}>
              Your details are gone and you have been signed out. Thank you for telling us
              why — it is read by a person, and it is the part that changes things.
            </p>
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="mt-5 w-full rounded-[11px] py-3.5 text-[13.5px] font-extrabold text-white"
              style={{ fontFamily: FONT.display, background: C.clay }}
            >
              Back to Stayo
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
