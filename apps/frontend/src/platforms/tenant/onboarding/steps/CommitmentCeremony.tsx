import { useState } from 'react';
import { Check, Handshake, ShieldCheck } from 'lucide-react';
import {
  canGiveWord,
  commitmentStatement,
  formatDuration,
  formatWindow,
  promises,
  type AgreementTerm,
  type CommitmentChecks,
} from './commitmentTerm';

/**
 * The commitment ceremony: the moment the term stops being fine print and
 * becomes something the tenant says out loud.
 *
 * Signing used to be a signature pad and nothing else — the screen never stated
 * how long the stay was for, so a tenant could commit to eleven months without
 * the number appearing anywhere, and the owner received a signature that
 * carried no evidence the person had understood the length.
 *
 * Two rules shape the copy here, and both matter more than they look:
 *
 * 1. **It is mutual.** Listing only what the tenant owes reads as extraction.
 *    Showing what the hostel owes in return — a held room, a rent that does not
 *    move, a deposit that comes back — is what turns an obligation into a word
 *    between two parties. Every line is derived from contract terms already
 *    stored on the agreement, so none of it is a marketing promise.
 * 2. **It never threatens.** `notice_period_days` is NULL on every live
 *    template, so `move-out-service` records no notice violation: a tenant can
 *    raise a move-out at any time. Copy implying a penalty or a lock-in would
 *    be false, and a commitment screen caught bluffing destroys exactly the
 *    trust it exists to build. The promise is real; the exit path is stated
 *    honestly beside it.
 */

const INK = '#2A2521';
const MUTED = '#8A7F75';
const ACCENT = '#B46A55';
const DEEP = '#A45D44';
const SURFACE = '#FBF7F1';

function PromiseList({ title, items, tone }: { title: string; items: string[]; tone: 'you' | 'them' }) {
  return (
    <div
      className="min-w-0 flex-1 rounded-xl p-3"
      style={{
        background: tone === 'you' ? 'rgba(180,106,85,.07)' : 'rgba(31,157,87,.07)',
        border: `1px solid ${tone === 'you' ? 'rgba(180,106,85,.22)' : 'rgba(31,157,87,.22)'}`,
      }}
    >
      <div
        className="mb-2 text-[10px] font-bold uppercase tracking-[.1em]"
        style={{ color: tone === 'you' ? DEEP : '#1F7A52' }}
      >
        {title}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 text-[11.5px] leading-snug" style={{ color: INK }}>
            <Check
              className="mt-px h-3 w-3 flex-none"
              strokeWidth={3}
              style={{ color: tone === 'you' ? ACCENT : '#1F9D57' }}
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "The word" — shown above the agreement, before anything is signed, so the
 * term is read rather than discovered.
 */
export function TheWordCard({
  hostelName,
  roomNumber,
  term,
}: {
  hostelName: string;
  roomNumber?: string | null;
  term: AgreementTerm;
}) {
  const { tenant, hostel } = promises({ hostelName, roomNumber, term });
  const window = formatWindow(term);

  return (
    <div
      className="mb-3.5 rounded-2xl"
      style={{ background: SURFACE, border: '1px solid #E7DDCE', padding: '14px', boxShadow: '0 6px 18px rgba(20,16,13,.06)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: 'rgba(180,106,85,.12)' }}
        >
          <Handshake className="h-[18px] w-[18px]" style={{ color: ACCENT }} />
        </div>
        <div className="min-w-0">
          <div className="font-display text-[15px] font-extrabold tracking-tight" style={{ color: INK }}>
            Your word with {hostelName || 'the hostel'}
          </div>
          <div className="text-[11.5px]" style={{ color: MUTED }}>
            What each of you is agreeing to.
          </div>
        </div>
      </div>

      <div
        className="mt-3 flex items-baseline justify-between gap-2 rounded-xl px-3 py-2.5"
        style={{ background: 'rgba(42,37,33,.04)', border: '1px solid #EEE3D4' }}
      >
        <span className="font-display text-[19px] font-extrabold tracking-tight" style={{ color: DEEP }}>
          {formatDuration(term)}
        </span>
        {window ? (
          <span className="truncate text-[11.5px] font-semibold" style={{ color: MUTED }}>
            {window}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex gap-2">
        <PromiseList title="You commit to" items={tenant} tone="you" />
        <PromiseList title={`${hostelName || 'The hostel'} commits to`} items={hostel} tone="them" />
      </div>
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className="flex w-full items-start gap-2.5 rounded-xl p-3 text-left"
      style={{
        background: checked ? 'rgba(180,106,85,.08)' : '#F1EAE0',
        border: `1.5px solid ${checked ? ACCENT : '#E7DDCE'}`,
      }}
    >
      <span
        className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[6px]"
        style={{
          background: checked ? ACCENT : '#fff',
          border: `1.5px solid ${checked ? ACCENT : '#D9CDBC'}`,
        }}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3.2} />}
      </span>
      <span className="min-w-0 text-[12.5px] font-medium leading-snug" style={{ color: INK }}>
        {children}
      </span>
    </button>
  );
}

/**
 * The confirmation sheet. Opens on Confirm & Continue, and is the last thing
 * between the tenant and a signed agreement.
 */
export function CommitmentSheet({
  hostelName,
  term,
  busy,
  given,
  tenantName,
  ownerName,
  onCancel,
  onConfirm,
  onDone,
}: {
  hostelName: string;
  term: AgreementTerm;
  busy: boolean;
  /** True once the agreement came back signed — switches to the handshake. */
  given: boolean;
  tenantName: string;
  ownerName: string;
  onCancel: () => void;
  onConfirm: (checks: CommitmentChecks) => void;
  onDone: () => void;
}) {
  const [checks, setChecks] = useState<CommitmentChecks>({ readAgreement: false, acceptTerm: false });
  const ready = canGiveWord(checks);
  const duration = formatDuration(term);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(20,16,13,.5)' }}
      role="presentation"
      onClick={() => (busy || given ? undefined : onCancel())}
    >
      <div
        className="w-full max-w-[440px] rounded-t-[22px]"
        style={{ background: SURFACE, padding: '18px 16px calc(18px + env(safe-area-inset-bottom))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={given ? 'Your word is given' : 'Confirm your commitment'}
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full" style={{ background: '#E0D5C6' }} />

        {given ? (
          <div className="pb-1 text-center" style={{ animation: 'obFade .3s ease' }}>
            <div
              className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'rgba(31,157,87,.12)' }}
            >
              <ShieldCheck className="h-7 w-7" style={{ color: '#1F9D57' }} />
            </div>
            <div className="font-display text-[19px] font-extrabold tracking-tight" style={{ color: INK }}>
              Your word is given
            </div>
            <div className="mx-auto mt-1.5 max-w-[300px] text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
              {tenantName || 'You'} and {ownerName || hostelName || 'the hostel'} have agreed to {duration}
              {formatWindow(term) ? `, ${formatWindow(term)}` : ''}.
            </div>
            <button
              type="button"
              onClick={onDone}
              className="mt-4 w-full rounded-xl py-3 text-sm font-bold text-white"
              style={{ background: ACCENT, boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
            >
              Continue
            </button>
          </div>
        ) : (
          <>
            <div className="font-display text-[17px] font-extrabold tracking-tight" style={{ color: INK }}>
              One last thing
            </div>
            <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
              An agreement is a promise both ways. Please confirm you mean it.
            </div>

            <div
              className="mt-3 rounded-xl px-3.5 py-3"
              style={{ background: 'rgba(180,106,85,.08)', border: `1px solid rgba(180,106,85,.24)` }}
            >
              <div className="font-display text-[13.5px] font-bold leading-snug" style={{ color: DEEP }}>
                “{commitmentStatement(hostelName, term)}”
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <CheckRow
                checked={checks.readAgreement}
                onToggle={() => setChecks((prev) => ({ ...prev, readAgreement: !prev.readAgreement }))}
              >
                I have read the agreement and the hostel rules.
              </CheckRow>
              <CheckRow
                checked={checks.acceptTerm}
                onToggle={() => setChecks((prev) => ({ ...prev, acceptTerm: !prev.acceptTerm }))}
              >
                I am giving my word to stay for {duration}.
              </CheckRow>
            </div>

            {/*
              Stated plainly rather than buried: there is no lock-in in the
              product, and pretending otherwise would make the promise above
              worth less, not more.
            */}
            <div className="mt-2.5 text-[11px] leading-relaxed" style={{ color: MUTED }}>
              If your plans genuinely change, you can raise a move-out with the owner and settle up — this is a
              promise, not a trap.
            </div>

            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50"
                style={{ background: '#F1EAE0', border: '1px solid #E7DDCE', color: INK }}
              >
                Not yet
              </button>
              <button
                type="button"
                onClick={() => onConfirm(checks)}
                disabled={!ready || busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: ACCENT, boxShadow: ready ? '0 6px 16px rgba(180,106,85,.3)' : 'none' }}
              >
                <Handshake className="h-4 w-4" />
                {busy ? 'Sealing…' : 'I give my word'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
