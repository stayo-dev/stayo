import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Chrome, MapPin, UtensilsCrossed, Shield, AlertCircle } from 'lucide-react';
import { useAuth } from '@context/AuthContext';

const SESSION_EXPIRY_NOTICE_KEY = 'hms_session_expiry_notice';

const readSessionExpiryNotice = (): { message?: string } | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_EXPIRY_NOTICE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SESSION_EXPIRY_NOTICE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const getErrorDetails = (error: string) => {
  if (error.includes('Incorrect email') || error.includes('incorrect') || error.includes('password') || error.includes('phone')) {
    return {
      title: 'Incorrect credentials',
      message: 'The email/phone or password you entered does not match our records.',
      action: 'Double-check your email/phone and try a different password.',
    };
  }
  if (error.includes('Too many') || error.includes('rate') || error.includes('429')) {
    return {
      title: 'Too many attempts',
      message: 'Your account is temporarily locked to protect your security.',
      action: 'Please wait 5–10 minutes before trying again.',
    };
  }
  if (error.includes('not found') || error.includes('404')) {
    return {
      title: 'Account not found',
      message: 'No account exists with this email or phone number.',
      action: 'Check the email/phone or contact your hostel manager.',
    };
  }
  if (error.includes('connect') || error.includes('internet') || error.includes('network')) {
    return {
      title: 'No connection',
      message: 'Unable to reach the server.',
      action: 'Check your internet connection and try again.',
    };
  }
  if (error.includes('Google') || error.includes('google')) {
    return {
      title: 'Google sign-in failed',
      message: 'Could not complete Google authentication.',
      action: 'Try again or sign in with email & password instead.',
    };
  }
  if (error.includes('access') || error.includes('403') || error.includes('permission')) {
    return {
      title: 'Access denied',
      message: 'Your account does not have permission to sign in here.',
      action: 'Contact your hostel manager if this is unexpected.',
    };
  }
  return {
    title: 'Sign-in failed',
    message: error || 'Something went wrong.',
    action: 'Please try again. If the problem persists, contact support.',
  };
};

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const navigateForUser = (user: any) => {
    const role = (user?.role || '').toLowerCase();
    if (role === 'admin') {
      navigate('/admin', { replace: true });
    } else if (role === 'owner') {
      navigate('/owner/home', { replace: true });
    } else {
      navigate('/tenant/home', { replace: true });
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      // signInWithOAuth is a full-page redirect (Google → Supabase →
      // /auth/callback) — this only ever throws if Supabase rejects the
      // request *before* redirecting (e.g. misconfiguration); the actual
      // sign-in outcome is handled on AuthCallbackPage after the redirect.
      await loginWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Google authentication failed');
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setIsLoading(true);
    setError('');
    try {
      const user = await login(email, password);
      navigateForUser(user);
    } catch (err: unknown) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#FFFDF5' }}>

      {/* ── Left brand panel (desktop only) ─────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-5/12 xl:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundColor: '#1B2D5B' }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full opacity-10" style={{ backgroundColor: '#F07B1D' }} />
        <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] rounded-full opacity-10" style={{ backgroundColor: '#FBB040' }} />
        <div className="absolute top-1/2 -right-16 w-64 h-64 rounded-full opacity-5" style={{ backgroundColor: '#F07B1D' }} />

        {/* Logo */}
        <div className="relative z-10">
          <Link to="/" className="inline-flex items-center gap-3 no-underline">
            <img
              src="/stayo-dev.png"
              alt="Stayo"
              className="h-14 w-auto rounded-xl object-contain"
            />
            <span
              className="text-xl font-bold text-white leading-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Stayo
            </span>
          </Link>
        </div>

        {/* Tagline */}
        <div className="relative z-10 space-y-8">
          <div>
            <h2
              className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Your home<br />away from home
            </h2>
            <p className="text-white/70 text-lg leading-relaxed max-w-sm">
              Verified stays and a seamless tenant experience — safe, comfortable, and always welcoming.
            </p>
          </div>

          {/* Feature bullets */}
          <div className="space-y-4">
            {[
              { icon: UtensilsCrossed, text: 'Fresh homely meals included daily' },
              { icon: MapPin,          text: 'Hostels close to your campus' },
              { icon: Shield,          text: '24/7 security & CCTV' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#F07B1D' }}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <span className="text-white/80 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom strip */}
        <div className="relative z-10">
          <div className="h-px w-full mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <p className="text-white/40 text-xs">© {new Date().getFullYear()} StayO</p>
        </div>
      </div>

      {/* ── Right form panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:px-16">

        {/* Mobile-only brand header */}
        <div className="lg:hidden flex flex-col items-center mb-10">
          <Link to="/" className="flex flex-col items-center gap-2 no-underline">
            <img src="/android-chrome-512x512.png" alt="Logo" className="h-20 w-auto object-contain" />
            <span
              className="text-base font-bold tracking-wide"
              style={{ color: '#1B2D5B', fontFamily: 'var(--font-display)' }}
            >
              StayO
            </span>
          </Link>
        </div>

        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="mb-8">
            <h1
              className="text-3xl font-bold mb-1"
              style={{ color: '#1B2D5B', fontFamily: 'var(--font-display)' }}
            >
              Welcome back
            </h1>
            <p className="text-sm" style={{ color: '#2C2C2A', opacity: 0.65 }}>
              Sign in to your StayO account
            </p>
          </div>

          {/* Saffron accent bar */}
          <div className="h-1 w-12 rounded-full mb-8" style={{ backgroundColor: '#F07B1D' }} />

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (() => {
              const { title, message, action } = getErrorDetails(error);
              return (
                <div
                  className="px-4 py-4 rounded-xl border flex gap-3 items-start"
                  style={{ backgroundColor: 'rgba(220,38,38,0.05)', borderColor: 'rgba(220,38,38,0.2)' }}
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#dc2626' }} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold" style={{ color: '#dc2626' }}>{title}</p>
                    <p className="text-sm mt-0.5" style={{ color: '#7f1d1d' }}>{message}</p>
                    <p className="text-xs mt-1.5 font-semibold" style={{ color: '#991b1b' }}>→ {action}</p>
                  </div>
                </div>
              );
            })()}

            {/* Email or Mobile */}
            <div className="space-y-1.5">
              <label
                className="text-sm font-semibold"
                style={{ color: '#1B2D5B' }}
                htmlFor="email"
              >
                Email address or Mobile number
              </label>
              <input
                id="email"
                type="text"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com or mobile number"
                className="w-full px-4 py-3 rounded-xl text-sm transition-all outline-none"
                style={{
                  backgroundColor: '#fff',
                  border: '1.5px solid #e5e7eb',
                  color: '#2C2C2A',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#1B2D5B')}
                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                className="text-sm font-semibold"
                style={{ color: '#1B2D5B' }}
                htmlFor="password"
              >
                <span className="flex items-center justify-between gap-3">
                  <span>Password</span>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-bold underline-offset-4 hover:underline"
                    style={{ color: '#F07B1D' }}
                  >
                    Forgot password?
                  </Link>
                </span>
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl text-sm transition-all outline-none"
                  style={{
                    backgroundColor: '#fff',
                    border: '1.5px solid #e5e7eb',
                    color: '#2C2C2A',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#1B2D5B')}
                  onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 transition-colors"
                  style={{ color: '#9ca3af' }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="w-full py-3.5 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              style={{ backgroundColor: '#F07B1D' }}
              onMouseEnter={(e) => { if (!isLoading) (e.currentTarget.style.backgroundColor = '#d96e18'); }}
              onMouseLeave={(e) => { (e.currentTarget.style.backgroundColor = '#F07B1D'); }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                'Sign In'
              )}
            </button>

            {/* Divider */}
            <div className="relative my-2 flex items-center">
              <div className="flex-1 border-t" style={{ borderColor: '#e5e7eb' }} />
              <span
                className="px-3 text-[11px] uppercase font-bold tracking-widest"
                style={{ color: '#9ca3af' }}
              >
                or
              </span>
              <div className="flex-1 border-t" style={{ borderColor: '#e5e7eb' }} />
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              style={{
                backgroundColor: '#fff',
                border: '1.5px solid #e5e7eb',
                color: '#2C2C2A',
              }}
              onMouseEnter={(e) => { (e.currentTarget.style.borderColor = '#1B2D5B'); }}
              onMouseLeave={(e) => { (e.currentTarget.style.borderColor = '#e5e7eb'); }}
            >
              <Chrome className="w-4 h-4" style={{ color: '#F07B1D' }} />
              Continue with Google
            </button>
          </form>

          {/* Footer links */}
          <div className="mt-8 space-y-3 text-center">
            <p className="text-xs" style={{ color: '#9ca3af' }}>
              By continuing, you agree to our{' '}
              <a
                href="/legal/terms"
                className="underline underline-offset-4 transition-colors"
                style={{ color: '#6b7280' }}
              >
                Terms
              </a>
              {' '}and{' '}
              <a
                href="/legal/privacy"
                className="underline underline-offset-4 transition-colors"
                style={{ color: '#6b7280' }}
              >
                Privacy Policy
              </a>.
            </p>
            <p className="text-xs" style={{ color: '#d1d5db' }}>
              StayO · HMS
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
