import { useState, type FormEvent } from 'react';
import { HousePlus, MapPin } from 'lucide-react';

import { useSubmitCoverageRequest } from '@features/coverage/hooks/useSubmitCoverageRequest';

import { validateCoverage, validateHostelReferral } from './coverageRequest';
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

/** A student naming the hostel they already live in is an owner lead. */
function ReferHostelForm({ source }: { source: string }) {
  const [hostelName, setHostelName] = useState('');
  const [ownerContact, setOwnerContact] = useState('');
  const [errors, setErrors] = useState<{ hostelName?: string; ownerContact?: string }>({});
  const submit = useSubmitCoverageRequest();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateHostelReferral({ hostelName, ownerContact }, source);
    setErrors(result.errors);
    if (result.valid && result.payload) submit.mutate(result.payload);
  };

  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.055] p-6">
      <HousePlus className="h-6 w-6 text-primary" strokeWidth={1.9} aria-hidden="true" />
      <h3 className="mt-3 font-display text-[19px] font-extrabold text-background">Get your hostel on Stayo</h3>
      <p className="mt-2 text-sm leading-relaxed text-background/70">
        Name the hostel and we'll approach the owner ourselves. Your hostel gets a real page — and you get rent receipts
        and complaints that don't get lost.
      </p>

      {submit.isSuccess ? (
        <p className="mt-5 text-[15px] font-semibold text-background" role="status" aria-live="polite">
          Got it — we'll reach out to them. Thank you.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
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

          <label htmlFor="refer-owner" className={LABEL}>
            Owner's number <span className="font-semibold normal-case tracking-normal text-background/60">— optional</span>
          </label>
          <input
            id="refer-owner"
            type="tel"
            value={ownerContact}
            onChange={(event) => setOwnerContact(event.target.value)}
            placeholder="So we can call them"
            aria-invalid={Boolean(errors.ownerContact)}
            aria-describedby={errors.ownerContact ? 'refer-owner-error' : undefined}
            className={FIELD}
          />
          {errors.ownerContact && (
            <p id="refer-owner-error" className={ERROR}>
              {errors.ownerContact}
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
      <p className="mt-2 text-sm leading-relaxed text-background/70">
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
