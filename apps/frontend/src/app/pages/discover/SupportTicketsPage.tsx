import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, MessageSquareWarning } from 'lucide-react';

import { profileService, type SupportTicketCategory } from '@features/profile/api';
import { stayoToast } from '@shared/ui-patterns/Toast';

import { C, FONT } from './discoverTheme';

const CATEGORY_LABEL: Record<SupportTicketCategory, string> = {
  APP_BUG: 'App or website bug',
  ACCOUNT_ISSUE: 'Account issue',
  PAYMENT_ISSUE: 'Payment issue',
  OTHER: 'Something else',
};

const CATEGORIES = Object.keys(CATEGORY_LABEL) as SupportTicketCategory[];

const dateLabel = (v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Profile → "Raise a Ticket" (ADR-079) — reports a problem with the Stayo
 * app/website to Stayo Admin. Deliberately separate from `/tenant/complaints`
 * (tenant → owner/hostel), which this page never touches or links to.
 */
export function SupportTicketsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<SupportTicketCategory>('APP_BUG');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    document.title = 'Raise a ticket — Stayo';
  }, []);

  const ticketsQuery = useQuery({
    queryKey: ['profile', 'support-tickets'],
    queryFn: () => profileService.listSupportTickets(),
  });

  const createMutation = useMutation({
    mutationFn: () => profileService.createSupportTicket({ category, subject: subject.trim(), description: description.trim() }),
    onSuccess: () => {
      stayoToast.success('Ticket submitted — Stayo support will follow up');
      setSubject('');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['profile', 'support-tickets'] });
    },
    onError: (err: any) => stayoToast.error(err?.response?.data?.error?.message || 'Could not submit — please try again'),
  });

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0 && !createMutation.isPending;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/profile')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Raise a ticket
        </h1>
      </header>

      <main className="flex-1 space-y-6 px-5 py-5">
        <p className="text-[12.5px] leading-[1.5]" style={{ color: C.textMuted }}>
          Report a problem with the Stayo app or website — this goes to Stayo support, not your hostel.
        </p>

        <section className="rounded-2xl border bg-white p-4" style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
                style={
                  category === c
                    ? { background: C.ink, color: '#fff' }
                    : { background: '#F4EEE7', color: C.textMuted }
                }
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            maxLength={140}
            className="mt-3 w-full rounded-xl border px-3.5 py-2.5 text-[13.5px] outline-none"
            style={{ borderColor: C.lineInput, background: C.paper, color: C.text }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What went wrong? Include steps to reproduce if it's a bug."
            rows={4}
            maxLength={4000}
            className="mt-2.5 w-full resize-none rounded-xl border px-3.5 py-2.5 text-[13.5px] outline-none"
            style={{ borderColor: C.lineInput, background: C.paper, color: C.text }}
          />

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
            className="mt-3 w-full rounded-[11px] py-3 text-[13px] font-extrabold disabled:opacity-50"
            style={{ fontFamily: FONT.display, background: C.clay, color: '#fff' }}
          >
            {createMutation.isPending ? 'Submitting…' : 'Submit ticket'}
          </button>
        </section>

        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Your tickets
          </h2>
          <div className="overflow-hidden rounded-2xl border bg-white divide-y" style={{ borderColor: C.line }}>
            {ticketsQuery.isLoading && (
              <div className="p-4 text-[12.5px]" style={{ color: C.textMuted }}>Loading…</div>
            )}
            {!ticketsQuery.isLoading && (ticketsQuery.data ?? []).length === 0 && (
              <div className="flex flex-col items-center gap-2 p-8 text-center">
                <MessageSquareWarning className="h-6 w-6" style={{ color: '#C9BFB4' }} />
                <p className="text-[12.5px]" style={{ color: C.textMuted }}>No tickets yet.</p>
              </div>
            )}
            {(ticketsQuery.data ?? []).map((t) => (
              <div key={t.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{t.subject}</div>
                    <div className="mt-0.5 text-[11px]" style={{ color: C.textFaint }}>
                      {CATEGORY_LABEL[t.category]} · {dateLabel(t.created_at)}
                    </div>
                  </div>
                  <span
                    className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                    style={
                      t.status === 'RESOLVED'
                        ? { background: C.greenPale, color: C.green }
                        : { background: C.amberPale, color: C.amber }
                    }
                  >
                    {t.status === 'RESOLVED' ? 'Resolved' : 'Open'}
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-[1.5]" style={{ color: C.textBody }}>{t.description}</p>
                {t.admin_note && (
                  <p className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: '#F7F3EF', color: '#6B5B52' }}>
                    <span className="font-bold">Stayo support:</span> {t.admin_note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
