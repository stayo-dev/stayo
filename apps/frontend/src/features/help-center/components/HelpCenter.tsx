import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  LifeBuoy,
  Search,
  Send,
  Building2,
} from 'lucide-react';
import { profileService, type SupportTicketCategory } from '@features/profile/api';
import { C, FONT } from '@/app/pages/discover/discoverTheme';
import { SCREEN_HEADER_CLASS, SCREEN_HEADER_STYLE, ScreenTitle, SectionHead } from '@features/stayo-ui/ListSection';
import {
  CATEGORY_LABEL,
  MIN_DESCRIPTION_LENGTH,
  REPORT_ACK,
  TICKET_CATEGORIES,
  canSubmitReport,
  classifyProblem,
  hostelChannel,
  searchGuides,
  suggestCategory,
  type HelpAudience,
} from '../helpCenter';

/**
 * One Help Centre, rendered for whoever opened it.
 *
 * Owner and tenant get the same screen because they have the same problem
 * shape — "something is wrong and I don't know who fixes it" — and building it
 * twice is how the two halves drift apart. Only the catalogue and the
 * hostel-channel link differ, and both come from `helpCenter.ts`.
 *
 * The order of the page is the argument it makes: search, then answers, then —
 * and only then — a form. The support table had zero rows while the owner's
 * "Report a Bug" button showed a "Coming soon" toast, which says the problem
 * was never a shortage of form fields.
 *
 * Colours are the Discover palette rather than theme tokens, because this
 * renders inside two different shells and should look like one place from
 * either.
 */

const card = 'rounded-2xl border bg-white';
const cardStyle = { borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' };

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function HelpCenter({
  audience,
  backTo,
  backLabel,
  chrome = 'page',
}: {
  audience: HelpAudience;
  backTo: string;
  backLabel: string;
  /**
   * `page` draws its own header and fills the viewport — for Discover, which
   * has no shell. `embedded` leaves both to the host, for the owner app, whose
   * More section already supplies a header and a bottom nav.
   */
  chrome?: 'page' | 'embedded';
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [openGuide, setOpenGuide] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState<SupportTicketCategory | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [justFiled, setJustFiled] = useState(false);

  const matches = useMemo(() => searchGuides(query, audience), [query, audience]);
  const verdict = useMemo(() => classifyProblem(query), [query]);
  const channel = hostelChannel(audience);

  const ticketsQuery = useQuery({
    queryKey: ['profile', 'support-tickets'],
    queryFn: () => profileService.listSupportTickets(),
  });

  const chosenCategory: SupportTicketCategory = category ?? suggestCategory(`${subject} ${description}`);

  const createMutation = useMutation({
    mutationFn: () =>
      profileService.createSupportTicket({
        category: chosenCategory,
        subject: subject.trim(),
        description: description.trim(),
      }),
    onSuccess: () => {
      // An acknowledgement that stays on the page, not a toast that vanishes
      // before it has been read. Being heard means seeing where it went.
      setJustFiled(true);
      setReporting(false);
      setSubject('');
      setDescription('');
      setCategory(null);
      queryClient.invalidateQueries({ queryKey: ['profile', 'support-tickets'] });
    },
  });

  /** Opening the form carries across whatever they already typed upstairs. */
  const openReport = () => {
    if (!subject && query.trim()) setSubject(query.trim());
    setJustFiled(false);
    setReporting(true);
  };

  const tickets = ticketsQuery.data ?? [];
  const canSubmit = canSubmitReport(subject, description) && !createMutation.isPending;

  const embedded = chrome === 'embedded';

  return (
    <div
      className={embedded ? 'flex flex-col' : 'flex min-h-[100dvh] flex-col'}
      style={embedded ? undefined : { background: C.paper }}
    >
      {!embedded && (
      <header
        className={SCREEN_HEADER_CLASS}
        style={SCREEN_HEADER_STYLE}
      >
        <button
          type="button"
          aria-label={`Back to ${backLabel}`}
          onClick={() => navigate(backTo)}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <ScreenTitle>Help</ScreenTitle>
      </header>
      )}

      <main
        className={
          embedded
            ? 'w-full space-y-5 pb-8'
            : 'mx-auto w-full max-w-[640px] flex-1 space-y-5 px-5 py-5'
        }
      >
        {/* ---- Ask ------------------------------------------------------- */}
        <section>
          <h2
            className="text-[22px] font-extrabold leading-tight tracking-[-0.02em]"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            What&rsquo;s going wrong?
          </h2>
          <p className="mt-1 text-[12.5px] leading-[1.5]" style={{ color: C.textMuted }}>
            Describe it in your own words. Most things have an answer here already.
          </p>

          <div
            className="mt-3 flex items-center gap-2.5 rounded-2xl border bg-white px-3.5"
            style={{ borderColor: C.lineInput }}
          >
            <Search className="h-4 w-4 flex-none" style={{ color: C.textGhost }} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpenGuide(null);
              }}
              placeholder="Rent, login, food, payout&hellip;"
              className="w-full bg-transparent py-3 text-[14px] outline-none"
              style={{ color: C.text }}
              aria-label="Describe your problem"
            />
          </div>
        </section>

        {/* ---- The wall between the two inboxes -------------------------- */}
        {verdict === 'HOSTEL' && (
          <section className={`${card} flex items-start gap-3 p-4`} style={cardStyle}>
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px]"
              style={{ background: C.clayPaleBg, color: C.clay }}
            >
              <Building2 className="h-4.5 w-4.5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold" style={{ color: C.text }}>
                {audience === 'tenant' ? 'Your hostel handles this one' : 'This is a hostel matter'}
              </div>
              <p className="mt-1 text-[12px] leading-[1.55]" style={{ color: C.textBody }}>
                {audience === 'tenant'
                  ? 'Repairs, cleaning, food, roommates and rent amounts are your hostel’s to fix. They see it the moment you raise it there — and get to it faster than we could pass it on.'
                  : 'Repairs, cleaning, food and roommates are yours to resolve with your residents. Everything they raise is waiting for you in Service requests.'}
              </p>
              <button
                type="button"
                onClick={() => navigate(channel.to)}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12.5px] font-bold text-white"
                style={{ background: C.clay }}
              >
                {channel.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        )}

        {/* ---- Answers --------------------------------------------------- */}
        <section>
          <SectionHead title={query.trim() ? `${matches.length} ${matches.length === 1 ? 'answer' : 'answers'}` : 'Common questions'} />

          {matches.length === 0 ? (
            <div className={`${card} p-5 text-center`} style={cardStyle}>
              <p className="text-[13px] font-semibold" style={{ color: C.text }}>
                Nothing here matches that.
              </p>
              <p className="mt-1 text-[12px] leading-[1.5]" style={{ color: C.textMuted }}>
                That is worth telling us about — send it over and a person will read it.
              </p>
              <button
                type="button"
                onClick={openReport}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2.5 text-[12.5px] font-bold text-white"
                style={{ background: C.clay }}
              >
                Report it to Stayo
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className={`${card} divide-y overflow-hidden`} style={cardStyle}>
              {matches.map((guide) => {
                const open = openGuide === guide.id;
                return (
                  <div key={guide.id}>
                    <button
                      type="button"
                      onClick={() => setOpenGuide(open ? null : guide.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                    >
                      <span className="min-w-0 flex-1 text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>
                        {guide.question}
                      </span>
                      <ChevronDown
                        className="h-4 w-4 flex-none transition-transform"
                        style={{ color: C.textGhost, transform: open ? 'rotate(180deg)' : undefined }}
                      />
                    </button>
                    {open && (
                      <div className="px-4 pb-4">
                        <p className="text-[12.5px] leading-[1.6]" style={{ color: C.textBody }}>
                          {guide.answer}
                        </p>
                        {/*
                          The answer *is* the link. Telling someone which tab to
                          open, when the button could open it, is a worse answer.
                        */}
                        {guide.action && (
                          <button
                            type="button"
                            onClick={() => navigate(guide.action!.to)}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12.5px] font-bold"
                            style={{ background: C.chipBg, color: C.clayDeep }}
                          >
                            {guide.action.label}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- Escalate --------------------------------------------------- */}
        {justFiled && (
          <section
            className="flex items-start gap-3 rounded-2xl border p-4"
            style={{ borderColor: '#CFE6DA', background: C.greenPale }}
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
              style={{ background: C.green, color: '#fff' }}
            >
              <Check className="h-4.5 w-4.5" strokeWidth={2.6} />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold" style={{ color: '#14603E' }}>
                {REPORT_ACK.title}
              </div>
              <p className="mt-1 text-[12px] leading-[1.55]" style={{ color: '#2C6B4E' }}>
                {REPORT_ACK.body}
              </p>
            </div>
          </section>
        )}

        {!reporting && !justFiled && matches.length > 0 && (
          <button
            type="button"
            onClick={openReport}
            className={`${card} flex w-full items-center gap-3 p-4 text-left`}
            style={cardStyle}
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px]"
              style={{ background: C.chipBg, color: C.clay }}
            >
              <LifeBuoy className="h-4.5 w-4.5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold" style={{ color: C.text }}>
                None of these? Tell Stayo
              </div>
              <div className="mt-0.5 text-[11.5px] leading-snug" style={{ color: C.textMuted }}>
                Something broken in the app or your account — a person reads every one
              </div>
            </div>
            <ArrowRight className="h-4 w-4 flex-none" style={{ color: C.textGhost }} />
          </button>
        )}

        {reporting && (
          <section className={`${card} p-4`} style={cardStyle}>
            <h3 className="text-[14.5px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
              Report it to Stayo
            </h3>
            <p className="mt-1 text-[12px] leading-[1.5]" style={{ color: C.textMuted }}>
              For problems with the app, your account or a payment. This goes to the Stayo
              team, not your hostel.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {TICKET_CATEGORIES.map((option) => {
                const selected = chosenCategory === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCategory(option)}
                    aria-pressed={selected}
                    className="rounded-full px-3 py-1.5 text-[12px] font-semibold"
                    style={
                      selected
                        ? { background: C.ink, color: '#fff' }
                        : { background: '#F4EEE7', color: C.textMuted }
                    }
                  >
                    {CATEGORY_LABEL[option]}
                  </button>
                );
              })}
            </div>

            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="In one line, what happened?"
              maxLength={140}
              className="mt-3 w-full rounded-xl border px-3.5 py-2.5 text-[13.5px] outline-none"
              style={{ borderColor: C.lineInput, background: C.paper, color: C.text }}
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What were you doing when it went wrong? Anything you saw on screen helps us find it faster."
              rows={4}
              maxLength={4000}
              className="mt-2.5 w-full resize-none rounded-xl border px-3.5 py-2.5 text-[13.5px] outline-none"
              style={{ borderColor: C.lineInput, background: C.paper, color: C.text }}
            />

            {/*
              A nudge, never a block. The classifier is a good guess, not an
              authority, and someone certain their problem is ours must always
              be able to say so.
            */}
            {classifyProblem(`${subject} ${description}`) === 'HOSTEL' && (
              <p className="mt-2 rounded-lg px-3 py-2 text-[11.5px] leading-snug" style={{ background: C.amberPale, color: '#8A5A17' }}>
                This sounds like something your hostel fixes. You can still send it to us —
                but{' '}
                <button type="button" className="font-bold underline" onClick={() => navigate(channel.to)}>
                  {channel.label.toLowerCase()}
                </button>{' '}
                will almost certainly be quicker.
              </p>
            )}

            {createMutation.isError && (
              <p className="mt-2 text-[12px] font-semibold" style={{ color: '#B4453A' }}>
                That didn&rsquo;t send. Check your connection and try once more.
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setReporting(false)}
                className="rounded-[11px] border px-4 py-3 text-[13px] font-bold"
                style={{ borderColor: C.lineInput, color: C.text }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => createMutation.mutate()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[11px] py-3 text-[13px] font-extrabold text-white disabled:opacity-50"
                style={{ fontFamily: FONT.display, background: C.clay }}
              >
                {createMutation.isPending ? 'Sending…' : 'Send to Stayo'}
                {!createMutation.isPending && <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
            {!canSubmitReport(subject, description) && (subject || description) && (
              <p className="mt-2 text-[11.5px]" style={{ color: C.textGhost }}>
                A line about what happened and at least {MIN_DESCRIPTION_LENGTH} characters of
                detail — enough for someone to reproduce it.
              </p>
            )}
          </section>
        )}

        {/* ---- Proof it went somewhere ------------------------------------ */}
        {tickets.length > 0 && (
          <section>
            <SectionHead title="Your reports to Stayo" />
            <div className={`${card} divide-y overflow-hidden`} style={cardStyle}>
              {tickets.map((ticket) => (
                <div key={ticket.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>
                        {ticket.subject}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: C.textFaint }}>
                        {CATEGORY_LABEL[ticket.category]} · {dateLabel(ticket.created_at)}
                      </div>
                    </div>
                    <span
                      className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                      style={
                        ticket.status === 'RESOLVED'
                          ? { background: C.greenPale, color: C.green }
                          : { background: C.amberPale, color: C.amber }
                      }
                    >
                      {ticket.status === 'RESOLVED' ? 'Resolved' : 'With Stayo'}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-[1.5]" style={{ color: C.textBody }}>
                    {ticket.description}
                  </p>
                  {ticket.admin_note && (
                    <p
                      className="mt-2 rounded-lg px-3 py-2 text-[12px] leading-[1.5]"
                      style={{ background: '#F7F3EF', color: '#6B5B52' }}
                    >
                      <span className="font-bold">Stayo support:</span> {ticket.admin_note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
