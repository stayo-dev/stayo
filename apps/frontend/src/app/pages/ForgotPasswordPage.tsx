import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { authService } from '@/features/auth/api';

const GENERIC_MESSAGE = 'If an account exists for this email, you will receive password reset instructions shortly.';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await authService.forgotPassword(email);
      setMessage(result?.message || GENERIC_MESSAGE);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Could not send reset instructions.');
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
              <Mail className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold" style={{ color: '#1B2D5B', fontFamily: 'var(--font-display)' }}>
              Forgot password
            </h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Enter the email linked to your owner or tenant account. A secure reset link will be sent to your registered email address.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold" style={{ color: '#1B2D5B' }}>Email address</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none transition focus:border-[#1B2D5B]"
                style={{ borderColor: '#e5e0d8' }}
                placeholder="you@example.com"
              />
            </label>

            {message && (
              <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{message}</p>
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
              disabled={isLoading || !email.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundColor: '#F07B1D' }}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send reset instructions
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
