import { useState, type FormEvent } from 'react';
import { HousePlus, MapPin } from 'lucide-react';

import { useSubmitCoverageRequest } from '@features/coverage/hooks/useSubmitCoverageRequest';
import { useAttachCoverageDetails } from '@features/coverage/hooks/useAttachCoverageDetails';

import { validateCoverage, validateHostelReferral } from './coverageRequest';
import { validateFollowUp, type FollowUpMode } from './referralFollowUp';
import { GROUND_DARK } from './ground';

interface SupplyRequestSectionProps {
  /** 'HOME' from the normal page, 'HOME_EMPTY' when there are no listings. */
  source: string;
}

const FIELD =
  'mt-2 h-[50px] w-full rounded-[13px] border border-white/15 bg-white/[0.06] px-4 text-[15px] text-background placeholder:text-background/45';
const LABEL = 'mt-3.5 block font-display text-[11px] font-bold uppercase tracking-wider text-primary';
const SUBMIT =
  'mt-4 h-[50px] w-full rounded-[13px] bg-primary font-display text-[15px] font-extrabold text-primary-foreground disabled:opacity-60';
const ERROR = 'mt-1.5 text-[13px] font-semibold text-primary';
/** Keeps the first field on the same baseline in both cards. */
const INTRO = 'mt-2 text-sm leading-relaxed text-background/70 sm:min-h-[66px]';

/**
 * A student naming the hostel they already live in is an owner lead.
 *
 * Two steps on purpose. The name alone is saved first, and only then are we
 * asking for the owner's number — the field that turns a name into a phone
 * call. Asked up front it is a second hurdle before any commitment, and
 * hesitating over it loses the referral entirely; asked after, the referral is
 * already banked and a skip costs nothing.
 *
 * The number is optional and says so, but the label leads with what it buys
 * rather than with permission to skip. The line about anonymity is there
 * because the real hesitation is never effort — it is "am I allowed to give
 * out my landlord's number?", and leaving that unanswered is what makes the
 * safe move a blank field.
 */
function ReferHostelForm({ source }: { source: string }) {
  const [hostelName, setHostelName] = useState('');
  const [errors, setErrors] = useState<{ hostelName?: string }>({});
  const [stage, setStage] = useState<'name' | 'details' | 'done'>('name');
  const [referralId, setReferralId] = useState<string | null>(null);
  const [mode, setMode] = useState<FollowUpMode>('number');
  const [followUp, setFollowUp] = useState('');
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  const submit = useSubmitCoverageRequest();
  const attach = useAttachCoverageDetails();

  const onSubmitName = (event: FormEvent) => {
    event.preventDefault();
    const result = validateHostelReferral({ hostelName, ownerContact: '' }, source);
    setErrors(result.errors);
    if (!result.valid || !result.payload) return;
    submit.mutate(result.payload, {
      onSuccess: (data) => {
        // No id means an older server that cannot take the second step; the
        // referral is still saved, so say thank you rather than stall.
        if (data.id) {
          setReferralId(data.id);
          setStage('details');
        } else {
          setStage('done');
        }
      },
    });
  };

  const onSubmitFollowUp = (event: FormEvent) => {
    event.preventDefault();
    const result = validateFollowUp({ mode, value: followUp });
    setFollowUpError(result.error ?? null);
    if (!result.valid || !result.payload || !referralId) return;
    // The referral is already saved, so a failure here is never fatal — but it
    // must not be silent either. Swallowing it would thank the student while
    // dropping the most valuable field on the page; they get to retry, or skip.
    attach.mutate({ id: referralId, payload: result.payload }, {
      onSuccess: () => setStage('done'),
      onError: () => setFollowUpError("That didn't send. Try again, or skip — your referral is already saved."),
    });
  };

  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.055] p-6">
      <HousePlus className="h-6 w-6 text-primary" strokeWidth={1.9} aria-hidden="true" />
      <h3 className="mt-3 font-display text-[19px] font-extrabold text-background">Get your hostel on Stayo</h3>
      <p className={INTRO}>
        Name the hostel and we'll approach the owner ourselves. Your hostel gets a real page — and you get rent receipts
        and complaints that don't get lost.
      </p>

      {stage === 'name' && (
        <form onSubmit={onSubmitName} noValidate>
          <label htmlFor="refer-name" className={LABEL}>
            Hostel name
          </label>
          <input
            id="refer-name"
            type="text"
            value={hostelName}
            onChange={(event) => setHostelName(event.target.value)}
            placeholder="e.g. Sri Sai Boys Hostel"
            aria-invalid={Boolean(errors.hostelName)}
            aria-describedby={errors.hostelName ? 'refer-name-error' : undefined}
            className={FIELD}
          />
          {errors.hostelName && (
            <p id="refer-name-error" className={ERROR}>
              {errors.hostelName}
            </p>
          )}

          <button type="submit" disabled={submit.isPending} className={SUBMIT}>
            {submit.isPending ? 'Sending…' : 'Refer this hostel'}
          </button>
          <p className="mt-2.5 text-[12.5px] font-medium text-background/60">We do the asking — you don't have to.</p>
          {submit.isError && (
            <p className={ERROR} role="alert">
              That didn't send. Try again in a moment.
            </p>
          )}
        </form>
      )}

      {stage === 'details' && (
        <form onSubmit={onSubmitFollowUp} noValidate>
          <p className="mt-4 text-[15px] font-semibold text-background" role="status" aria-live="polite">
            Saved — thank you.
          </p>

          <label htmlFor="refer-follow-up" className={LABEL}>
            {mode === 'number' ? "Owner's number" : 'Where is it?'}
          </label>
          <p className="mt-1 text-[12.5px] leading-relaxed text-background/60">
            {mode === 'number'
              ? "Optional — but it's the difference between us calling this week and hunting for them for weeks."
              : 'An area or a landmark is enough to find them.'}
          </p>
          <input
            id="refer-follow-up"
            key={mode}
            autoFocus
            type={mode === 'number' ? 'tel' : 'text'}
            inputMode={mode === 'number' ? 'numeric' : 'text'}
            value={followUp}
            onChange={(event) => setFollowUp(event.target.value)}
            placeholder={mode === 'number' ? '98765 43210' : 'e.g. Ameerpet, near the metro'}
            aria-invalid={Boolean(followUpError)}
            aria-describedby={followUpError ? 'refer-follow-up-error' : 'refer-follow-up-privacy'}
            className={FIELD}
          />
          {followUpError && (
            <p id="refer-follow-up-error" className={ERROR}>
              {followUpError}
            </p>
          )}

          <p id="refer-follow-up-privacy" className="mt-2.5 text-[12.5px] leading-relaxed text-background/60">
            We'll tell them a resident recommended the place — your name never comes up.
          </p>

          <button type="submit" disabled={attach.isPending} className={SUBMIT}>
            {attach.isPending ? 'Sending…' : 'Send it'}
          </button>

          <div className="mt-3 flex items-center justify-between gap-3">
            {mode === 'number' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('area');
                  setFollowUp('');
                  setFollowUpError(null);
                }}
                className="text-[12.5px] font-semibold text-background/70 underline underline-offset-2"
              >
                I don't know it
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode('number');
                  setFollowUp('');
                  setFollowUpError(null);
                }}
                className="text-[12.5px] font-semibold text-background/70 underline underline-offset-2"
              >
                I have the number
              </button>
            )}
            <button
              type="button"
              onClick={() => setStage('done')}
              className="text-[12.5px] font-medium text-background/45 underline underline-offset-2"
            >
              Skip
            </button>
          </div>
        </form>
      )}

      {stage === 'done' && (
        <p className="mt-5 text-[15px] font-semibold text-background" role="status" aria-live="polite">
          Thanks — we'll take it from here.
        </p>
      )}
    </div>
  );
}

/** Demand for a place Stayo has no supply in. */
function AreaRequestForm({ source }: { source: string }) {
  const [area, setArea] = useState('');
  const [contact, setContact] = useState('');
  const [errors, setErrors] = useState<{ area?: string; contact?: string }>({});
  const submit = useSubmitCoverageRequest();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateCoverage({ area, contact }, source);
    setErrors(result.errors);
    if (result.valid && result.payload) submit.mutate(result.payload);
  };

  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.055] p-6">
      <MapPin className="h-6 w-6 text-primary" strokeWidth={1.9} aria-hidden="true" />
      <h3 className="mt-3 font-display text-[19px] font-extrabold text-background">Not in your area yet?</h3>
      <p className={INTRO}>
        Tell us the campus you're near. We'll go and find hostels there, and you'll be the first to know when one lists.
      </p>

      {submit.isSuccess ? (
        <p className="mt-5 text-[15px] font-semibold text-background" role="status" aria-live="polite">
          {submit.data?.will_notify
            ? "Noted — we'll message you when a hostel lists there."
            : "Noted — we've recorded the area."}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="area-query" className={LABEL}>
            Your college or area
          </label>
          <input
            id="area-query"
            type="text"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="e.g. Osmania University"
            aria-invalid={Boolean(errors.area)}
            aria-describedby={errors.area ? 'area-query-error' : undefined}
            className={FIELD}
          />
          {errors.area && (
            <p id="area-query-error" className={ERROR}>
              {errors.area}
            </p>
          )}

          <label htmlFor="area-contact" className={LABEL}>
            Your phone <span className="font-semibold normal-case tracking-normal text-background/60">— optional</span>
          </label>
          <input
            id="area-contact"
            type="text"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="So we can tell you"
            aria-invalid={Boolean(errors.contact)}
            aria-describedby={errors.contact ? 'area-contact-error' : undefined}
            className={FIELD}
          />
          {errors.contact && (
            <p id="area-contact-error" className={ERROR}>
              {errors.contact}
            </p>
          )}

          <button type="submit" disabled={submit.isPending} className={SUBMIT}>
            {submit.isPending ? 'Sending…' : 'Tell Stayo'}
          </button>
          <p className="mt-2.5 text-[12.5px] font-medium text-background/60">Just the area is enough — we record it either way.</p>
          {submit.isError && (
            <p className={ERROR} role="alert">
              That didn't send. Try again in a moment.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

type SupplyTab = 'HOSTEL' | 'AREA';

/**
 * The supply engine, and the reason this page earns its keep at two listings.
 *
 * A student who names an uncovered campus is demand data. A student who names
 * the hostel they already live in is an owner lead with a phone number attached
 * — the cheapest owner acquisition Stayo has, because the student does the
 * finding and Stayo only has to make the call.
 *
 * Both forms are always mounted, so neither loses its state when the other is
 * shown, but only one is ever visible on a phone: side by side they are four
 * fields and two buttons, which reads as a wall. The tab bar disappears from
 * `lg` up, where two columns read fine.
 */
export function SupplyRequestSection({ source }: SupplyRequestSectionProps) {
  const [tab, setTab] = useState<SupplyTab>('HOSTEL');

  const tabClass = (value: SupplyTab) =>
    `h-[42px] flex-1 rounded-[10px] font-display text-[13.5px] transition-colors ${
      tab === value ? 'bg-primary font-extrabold text-primary-foreground' : 'font-bold text-background/70'
    }`;

  return (
    <section className="bg-card px-4 pb-16 sm:px-6 sm:pb-20">
      <div className={`mx-auto max-w-6xl rounded-[28px] bg-foreground p-7 sm:p-12 ${GROUND_DARK}`}>
        <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-primary">Help Stayo grow</span>
        <h2 className="mt-3.5 font-display text-[clamp(26px,3.6vw,38px)] font-extrabold leading-[1.1] tracking-tight text-background">
          Can't find the hostel you want?
        </h2>
        <p className="mt-3 hidden max-w-[640px] text-base leading-relaxed text-background/70 lg:block">
          Two ways to fix that. Both take under a minute, and both make the list better for whoever looks next.
        </p>

        <div className="mt-4 flex gap-1 rounded-[13px] bg-white/[0.07] p-1 lg:hidden" role="tablist" aria-label="How you can help">
          <button type="button" role="tab" aria-selected={tab === 'HOSTEL'} onClick={() => setTab('HOSTEL')} className={tabClass('HOSTEL')}>
            Refer a hostel
          </button>
          <button type="button" role="tab" aria-selected={tab === 'AREA'} onClick={() => setTab('AREA')} className={tabClass('AREA')}>
            Request an area
          </button>
        </div>

        <div className="mt-4 grid gap-5 lg:mt-7 lg:grid-cols-2">
          <div className={tab === 'HOSTEL' ? 'block' : 'hidden lg:block'}>
            <ReferHostelForm source={source} />
          </div>
          <div className={tab === 'AREA' ? 'block' : 'hidden lg:block'}>
            <AreaRequestForm source={source} />
          </div>
        </div>
      </div>
    </section>
  );
}
