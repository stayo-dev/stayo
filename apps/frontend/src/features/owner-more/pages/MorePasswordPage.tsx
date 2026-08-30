import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { authService } from '@features/auth/api';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { describePasswordStrength, checkPasswordChange } from '../account/passwordChange';

const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 pr-11 text-[14px] text-foreground outline-none focus:border-primary';
const label = 'text-[12px] font-semibold text-muted-foreground';

/**
 * Configure → Password.
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

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Configuration"
        title="Password"
        subtitle="Used to sign in to your Stayo account"
      />

      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Current password</span>
          <div className="relative">
            <input
              className={field}
              type={reveal ? 'text' : 'password'}
              value={current}
              onChange={(e) => touch(setCurrent)(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={label}>New password</span>
          <div className="relative">
            <input
              className={field}
              type={reveal ? 'text' : 'password'}
              value={next}
              onChange={(e) => touch(setNext)(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {reveal ? <EyeOff className="h-4 w-4" strokeWidth={2} /> : <Eye className="h-4 w-4" strokeWidth={2} />}
            </button>
          </div>
          {next.length > 0 && (
            <span className="text-[11.5px] font-medium" style={{ color: strength.tone }}>
              {strength.label}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={label}>New password again</span>
          <div className="relative">
            <input
              className={field}
              type={reveal ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => touch(setConfirm)(e.target.value)}
              autoComplete="new-password"
            />
          </div>
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

        <button
          type="button"
          onClick={submit}
          disabled={change.isPending}
          className="mt-1 rounded-[13px] bg-primary px-4 py-3 text-[14px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {change.isPending ? 'Changing…' : 'Change password'}
        </button>
      </section>
    </div>
  );
}
