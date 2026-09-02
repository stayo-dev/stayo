import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, ShieldCheck } from 'lucide-react';
import { ownerService } from '@features/owners/api';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import {
  validatePayoutDraft,
  toPayoutPayload,
  payoutRowSummary,
  type PayoutDraft,
} from '../account/payoutAccount';

const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary';
const label = 'text-[12px] font-semibold text-muted-foreground';

const EMPTY: PayoutDraft = {
  holderName: '',
  accountNo: '',
  accountNoConfirm: '',
  ifsc: '',
  bankName: '',
};

/**
 * Profile → Payouts.
 *
 * The columns (`profiles.payout_*`, migration 070) and the API
 * (`GET/PUT /api/owner/payout-account`) have both existed and worked for some
 * time with **no screen calling them** — which is why the failed-payout alert
 * carried a "Check payout account" button pointing at a route nobody had
 * built. An owner could not see or set the account their rent is sent to.
 *
 * One account per owner, not per hostel: an owner is the bank holder, however
 * many properties they run.
 *
 * The number is asked for twice and never pre-filled. The server returns it
 * masked — it will not hand back a full account number to a page — so there is
 * nothing to pre-fill with, and re-typing it is the point anyway: a wrong
 * digit here sends rent to a stranger and nothing downstream catches it.
 *
 * **The form is not the screen.** It used to be: an owner who had already
 * saved an account opened this page and found five empty fields as its body,
 * which reads as *nothing is set up* — the opposite of the truth, on the one
 * screen where being wrong about that is frightening. With an account on file
 * the page now states it and offers to change it; the form appears on request.
 * With no account on file the form opens straight away, because there the
 * empty state *is* the message, and it keeps the warning that says so.
 */
export function MorePayoutAccountPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PayoutDraft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  const payoutQuery = useQuery({
    queryKey: ['owner', 'payout-account'],
    queryFn: () => ownerService.getPayoutAccount(),
    staleTime: 60_000,
  });
  const current = payoutQuery.data?.payout ?? null;

  const save = useMutation({
    mutationFn: () => ownerService.savePayoutAccount(toPayoutPayload(draft)),
    onSuccess: () => {
      setDraft(EMPTY);
      setEditing(false);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['owner', 'payout-account'] });
    },
    onError: (err: any) =>
      setError(err?.response?.data?.error?.message || 'Could not save. Please try again.'),
  });

  const set = (key: keyof PayoutDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
    setSaved(false);
  };

  const submit = () => {
    const check = validatePayoutDraft(draft);
    if (!check.ok) {
      setError(check.reason ?? 'Please check the details.');
      return;
    }
    setError(null);
    save.mutate();
  };

  const dirty = Object.values(draft).some((v) => v.trim().length > 0);
  // With nothing on file the form is the message, so it opens straight away.
  const showForm = editing || (!payoutQuery.isLoading && !current);

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-8'}`}>
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Profile"
        title="Payouts"
        subtitle="The bank account Stayo settles your rent into"
      />

      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <Landmark className="mt-0.5 h-4 w-4 flex-none text-primary" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-foreground">
              {payoutQuery.isLoading ? 'Loading…' : payoutRowSummary(current)}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              {current
                ? `Holder ${current.holder_name ?? '—'} · IFSC ${current.ifsc ?? '—'}`
                : 'Until this is added, collected rent stays with Stayo instead of reaching you.'}
            </p>
          </div>
        </div>

        {/*
          Only offered once there is something to change. Before that the form
          below is already open and a button to open it would do nothing.
        */}
        {current && !showForm && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full border-t border-border/60 px-4 py-3 text-left text-[13.5px] font-semibold text-primary"
          >
            Change account
          </button>
        )}
      </div>

      {saved && (
        <p className="flex items-center gap-2 rounded-xl bg-[#E6F0E8] px-3.5 py-2.5 text-[12.5px] font-medium text-[#3F7D58]">
          <ShieldCheck className="h-4 w-4 flex-none" strokeWidth={2} />
          Saved. Your next settlement goes to this account.
        </p>
      )}

      {showForm && (
        <section className="flex flex-col gap-3">
          <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {current ? 'Change the account' : 'Add your account'}
          </h2>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Account holder&apos;s name</span>
            <input
              className={field}
              value={draft.holderName}
              onChange={(e) => set('holderName')(e.target.value)}
              placeholder="Exactly as your bank has it"
              autoComplete="name"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Account number</span>
            <input
              className={field}
              value={draft.accountNo}
              onChange={(e) => set('accountNo')(e.target.value)}
              inputMode="numeric"
              placeholder="Digits only"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Account number again</span>
            <input
              className={field}
              value={draft.accountNoConfirm}
              onChange={(e) => set('accountNoConfirm')(e.target.value)}
              inputMode="numeric"
              placeholder="Type it a second time"
            />
            <span className="text-[11px] leading-[1.5] text-muted-foreground">
              Asked twice on purpose. A wrong digit sends your rent to someone else&apos;s account, and
              it cannot be traced back.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>IFSC</span>
            <input
              className={`${field} uppercase`}
              value={draft.ifsc}
              onChange={(e) => set('ifsc')(e.target.value)}
              placeholder="HDFC0001204"
              autoCapitalize="characters"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>
              Bank name <span className="font-normal">(optional)</span>
            </span>
            <input
              className={field}
              value={draft.bankName}
              onChange={(e) => set('bankName')(e.target.value)}
              placeholder="HDFC Bank"
            />
          </label>

          {error && (
            <p
              className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-medium text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <p className="text-[11px] leading-[1.55] text-muted-foreground">
            Every change is recorded, including who made it and when. Stayo will never ask you for
            this over WhatsApp or a phone call.
          </p>
        </section>
      )}

      <SaveBar
        visible={dirty}
        pending={save.isPending}
        onSave={submit}
        onDiscard={() => {
          setDraft(EMPTY);
          setError(null);
          // Back to the stated account rather than an empty form, when there
          // is one to go back to.
          if (current) setEditing(false);
        }}
        label={current ? 'Update account' : 'Save account'}
      />
    </div>
  );
}
