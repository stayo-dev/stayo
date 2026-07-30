import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { tenantPortalApi } from '@features/tenant-portal/api';

const TERMINAL_STATUSES = ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED', 'PENDING_MANUAL_CONFIRMATION'];
const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PaymentAttempt {
  id?: string;
  status?: string;
  merchant_txn_id?: string;
  amount?: number;
}

export function TenantPaymentReturnPage() {
  const [searchParams] = useSearchParams();
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const cancelledRef = useRef(false);
  const focusVerifyingRef = useRef(false);
  const attemptRef = useRef<PaymentAttempt | null>(null);

  const currentStatus = attempt?.status;
  const merchantTxnId =
    searchParams.get('merchant_txn_id') ||
    searchParams.get('merchantOrderId') ||
    searchParams.get('transactionId');

  const doVerify = useCallback(async () => {
    const result = await tenantPortalApi.verifyPayment({ merchant_txn_id: merchantTxnId });
    const data = (result?.attempt ?? result) as PaymentAttempt;
    if (data) {
      attemptRef.current = data;
      setAttempt(data);
      setError('');
    }
    return data;
  }, [merchantTxnId]);

  useEffect(() => {
    if (!merchantTxnId) {
      setError('Invalid payment return. Missing transaction reference.');
      setLoading(false);
      return;
    }

    cancelledRef.current = false;

    const runPolling = async () => {
      for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
        if (cancelledRef.current) return;
        try {
          const data = await doVerify();
          if (!data) {
            setError('Payment record not found.');
            setLoading(false);
            return;
          }
          if (TERMINAL_STATUSES.includes(String(data.status))) {
            setLoading(false);
            return;
          }
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 404) {
            setError('Payment not found. It may still be processing.');
            setLoading(false);
            return;
          }
          if (TERMINAL_STATUSES.includes(String(attemptRef.current?.status))) {
            setLoading(false);
            return;
          }
        }
        if (i < MAX_POLL_ATTEMPTS && !cancelledRef.current) await sleep(POLL_INTERVAL_MS);
      }
      setTimedOut(true);
      setLoading(false);
    };

    runPolling();
    return () => {
      cancelledRef.current = true;
    };
  }, [merchantTxnId, doVerify]);

  useEffect(() => {
    if (!timedOut) return;
    if (attempt && TERMINAL_STATUSES.includes(String(attempt.status))) return;

    const bgTimer = setInterval(async () => {
      try {
        const data = await doVerify();
        if (TERMINAL_STATUSES.includes(String(data?.status))) {
          setTimedOut(false);
          clearInterval(bgTimer);
        }
      } catch {
        /* silent */
      }
    }, 15000);

    return () => clearInterval(bgTimer);
  }, [timedOut, attempt, doVerify]);

  const handleManualCheck = async () => {
    if (!merchantTxnId || isChecking) return;
    setIsChecking(true);
    setError('');
    try {
      const data = await doVerify();
      if (TERMINAL_STATUSES.includes(String(data?.status))) setTimedOut(false);
    } catch {
      setError('Failed to check status. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  const fmt = (n?: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto" />
          <h1 className="mt-4 text-xl font-bold">Verifying payment</h1>
          <p className="mt-2 text-sm text-muted-foreground">Please wait — do not close this page.</p>
        </div>
      </div>
    );
  }

  if (error && !attempt) {
    return (
      <Shell>
        <AlertCircle className="w-10 h-10 text-destructive" />
        <h1 className="mt-4 text-xl font-bold text-destructive">Verification failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <ActionButton onClick={handleManualCheck} loading={isChecking} label="Try again" />
        <BackLink />
      </Shell>
    );
  }

  if (timedOut && currentStatus !== 'SUCCESS') {
    return (
      <Shell>
        <Clock className="w-10 h-10 text-amber-500" />
        <h1 className="mt-4 text-xl font-bold">Payment still processing</h1>
        <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
          UPI confirmation can take a minute. We&apos;ll update your ledger automatically.
        </p>
        {attempt && (
          <div className="mt-4 w-full text-sm space-y-2 rounded-xl bg-muted p-4">
            <Row label="Reference" value={attempt.merchant_txn_id} mono />
            <Row label="Amount" value={fmt(attempt.amount)} />
            <Row label="Status" value={currentStatus} />
          </div>
        )}
        <ActionButton onClick={handleManualCheck} loading={isChecking} label="Check payment status" />
        <BackLink />
      </Shell>
    );
  }

  if (currentStatus === 'SUCCESS') {
    return (
      <Shell>
        <CheckCircle2 className="w-12 h-12 text-emerald-500" />
        <h1 className="mt-4 text-xl font-bold">Payment successful</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your rent payment has been recorded.</p>
        {attempt?.amount != null && <p className="mt-2 text-lg font-bold">{fmt(attempt.amount)}</p>}
        <Link
          to="/tenant/money"
          className="mt-6 w-full block py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-center"
        >
          View payments
        </Link>
      </Shell>
    );
  }

  if (currentStatus === 'FAILED' || currentStatus === 'EXPIRED' || currentStatus === 'CANCELLED') {
    return (
      <Shell>
        <XCircle className="w-10 h-10 text-destructive" />
        <h1 className="mt-4 text-xl font-bold">Payment {String(currentStatus).toLowerCase()}</h1>
        <p className="mt-2 text-sm text-muted-foreground">No amount was charged. You can try again.</p>
        <Link
          to="/tenant/money"
          className="mt-6 w-full block py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-center"
        >
          Try again
        </Link>
        <BackLink />
      </Shell>
    );
  }

  return (
    <Shell>
      <Clock className="w-10 h-10 text-amber-500" />
      <h1 className="mt-4 text-xl font-bold">Awaiting confirmation</h1>
      <p className="mt-2 text-sm text-muted-foreground">Status: {currentStatus ?? 'pending'}</p>
      <ActionButton onClick={handleManualCheck} loading={isChecking} label="Refresh status" />
      <BackLink />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 flex flex-col items-center">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value ?? '—'}</span>
    </div>
  );
}

function ActionButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-accent-foreground font-semibold disabled:opacity-50"
    >
      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Checking…' : label}
    </button>
  );
}

function BackLink() {
  return (
    <Link to="/tenant/money" className="mt-4 text-sm text-muted-foreground hover:text-foreground">
      Back to financials
    </Link>
  );
}

