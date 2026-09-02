import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { authService } from '@features/auth/api';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { describePasswordStrength, checkPasswordChange } from '../account/passwordChange';

const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 pr-11 text-[14px] text-foreground outline-none focus:border-primary';
const label = 'text-[12px] font-semibold text-muted-foreground';

/**
 * Profile → Password.
 *
 * `POST /auth/change-password` has existed and worked with **no caller in the
 * app**: the "Change password" row in the old Account & security menu pointed
 * at the Settings *list*, so an owner tapping it landed on a menu and there
 * was no way to change a password at all.
 *
 * Deliberately its own screen rather than a section of the profile form. A
 * password change is a security action with a different failure mode from
 * editing a display name, and burying it under "Your details" is how it stayed
 * unnoticed and unbuilt.
 *
 * Commits through the same `SaveBar` as Details and Payouts. Those three
 * screens previously had three different ways to commit a change — a sticky
 * bar, and two differently-placed inline buttons — so the gesture an owner
 * learned on one screen did not transfer to the next. The bar appears once
 * anything is typed, which is also the only "dirty" state a password form has:
 * there is no baseline to diff against, because the current value is a secret
 * this screen is never given.
 *
 * The reveal toggle covers all three fields together. It sat on the middle
 * field alone, so an owner checking a typo in "New password again" — the field
 * most likely to hold one — had no way to see it.
 */
export function MorePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = describePasswordStrength(next);

  const change = useMutation({
    mutationFn: () => authService.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    },
    onError: (err: any) =>
      setError(
        err?.response?.data?.error?.message ||
          'Could not change your password. Check your current one and try again.',
      ),
  });

  const submit = () => {
    const check = checkPasswordChange({ current, next, confirm });
    if (!check.ok) {
      setError(check.reason ?? 'Please check the details.');
      return;
    }
    setError(null);
    change.mutate();
  };

  const touch = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setError(null);
    setDone(false);
  };

  const anythingTyped = Boolean(current || next || confirm);

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${anythingTyped ? 'pb-40' : 'pb-8'}`}>
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Profile"
        title="Password"
        subtitle="Used to sign in to your Stayo account"
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className={label}>Current password</span>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-primary"
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" strokeWidth={2} /> : <Eye className="h-3.5 w-3.5" strokeWidth={2} />}
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          className={field}
          type={reveal ? 'text' : 'password'}
          value={current}
          onChange={(e) => touch(setCurrent)(e.target.value)}
          autoComplete="current-password"
        />

        <label className="mt-1 flex flex-col gap-1.5">
          <span className={label}>New password</span>
          <input
            className={field}
            type={reveal ? 'text' : 'password'}
            value={next}
            onChange={(e) => touch(setNext)(e.target.value)}
            autoComplete="new-password"
          />
          {next.length > 0 && (
            <span className="text-[11.5px] font-medium" style={{ color: strength.tone }}>
              {strength.label}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={label}>New password again</span>
          <input
            className={field}
            type={reveal ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => touch(setConfirm)(e.target.value)}
            autoComplete="new-password"
          />
          {confirm.length > 0 && next === confirm && (
            <span className="text-[11.5px] font-medium text-[#3F7D58]">Both match</span>
          )}
        </label>

        {error && (
          <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        {done && (
          <p className="flex items-center gap-2 rounded-xl bg-[#E6F0E8] px-3.5 py-2.5 text-[12.5px] font-medium text-[#3F7D58]">
            <ShieldCheck className="h-4 w-4 flex-none" strokeWidth={2} />
            Password changed. Use the new one next time you sign in.
          </p>
        )}
      </section>

      {/*
        Discard clears all three fields rather than restoring a baseline —
        there is no baseline to restore, since the screen is never told the
        current password.
      */}
      <SaveBar
        visible={anythingTyped}
        pending={change.isPending}
        onSave={submit}
        onDiscard={() => {
          setCurrent('');
          setNext('');
          setConfirm('');
          setError(null);
        }}
        label="Change password"
      />
    </div>
  );
}
