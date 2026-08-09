import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, LockKeyhole } from 'lucide-react';
import { authService } from '@/features/auth/api';
import { supabase } from '@lib/supabaseClient';
import { StayoLoader } from '@shared/ui/brand';

function readResetToken(search: string, hash: string) {
  const queryParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  return {
    code: queryParams.get('code') || hashParams.get('code') || undefined,
    accessToken: hashParams.get('access_token') || queryParams.get('access_token') || undefined,
  };
}

function passwordStrength(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/i.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-z0-9]/i.test(password)) score += 1;

  if (score <= 1) return { label: 'Weak', color: '#dc2626', width: '25%' };
  if (score === 2) return { label: 'Fair', color: '#f97316', width: '50%' };
  if (score === 3) return { label: 'Good', color: '#16a34a', width: '75%' };
  return { label: 'Strong', color: '#059669', width: '100%' };
}

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const resetToken = useMemo(() => readResetToken(location.search, location.hash), [location.hash, location.search]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const strength = passwordStrength(newPassword);
  const hasResetToken = Boolean(resetToken.code || resetToken.accessToken);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasResetToken || isLoading) return;
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await authService.resetPassword({
        code: resetToken.code,
        accessToken: resetToken.accessToken,
        newPassword,
        confirmPassword,
      });
      // ADR-031: no more ownerUser/tenantUser localStorage — sign the
      // Supabase client out locally too, matching "this signs out all
      // devices" (the backend already revoked every session server-side).
      await supabase.auth.signOut();
      setSuccess(result?.message || 'Password reset successfully. Please sign in again.');
      window.setTimeout(() => navigate('/login?signin=1', { replace: true }), 1400);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Reset link is invalid or expired.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10" style={{ backgroundColor: '#FFFDF5' }}>
      <div className="w-full max-w-md">
        <Link to="/login?signin=1" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: '#1B2D5B' }}>
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div className="rounded-3xl border bg-white p-6 shadow-sm" style={{ borderColor: '#eadfce' }}>
          <div className="mb-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: '#FFF3E8', color: '#F07B1D' }}>
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold" style={{ color: '#1B2D5B', fontFamily: 'var(--font-display)' }}>
              Reset password
            </h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Choose a new password. This signs out all devices for your security.
            </p>
          </div>

          {!hasResetToken && (
            <div className="mb-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>This reset link is missing its secure token. Request a fresh password reset email.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold" style={{ color: '#1B2D5B' }}>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none transition focus:border-[#1B2D5B]"
                style={{ borderColor: '#e5e0d8' }}
                placeholder="At least 8 characters"
              />
            </label>

            <div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full transition-all" style={{ width: strength.width, backgroundColor: strength.color }} />
              </div>
              <p className="mt-1 text-xs font-semibold" style={{ color: strength.color }}>{strength.label}</p>
            </div>

            <label className="block">
              <span className="text-sm font-semibold" style={{ color: '#1B2D5B' }}>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none transition focus:border-[#1B2D5B]"
                style={{ borderColor: '#e5e0d8' }}
                placeholder="Repeat new password"
              />
            </label>

            {success && (
              <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{success}</p>
              </div>
            )}

            {error && (
              <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !hasResetToken}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundColor: '#F07B1D' }}
            >
              {isLoading ? <StayoLoader size="sm" label={null} /> : null}
              Reset password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
