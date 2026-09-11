import { useCallback, useEffect, useState } from 'react';
import { tenantService } from '@features/tenants/api';
import { normalizeEmail, type EmailRequirement } from './steps/emailVerification';

/**
 * The state behind the onboarding email field: where a code went, what has
 * been proved, and the resend countdown. Decisions live in
 * `steps/emailVerification.ts`, which the suite can test; this only holds
 * state and talks to the two endpoints.
 */
export function useEmailVerification(token: string, requirement: EmailRequirement | null | undefined) {
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [verifiedAs, setVerifiedAs] = useState<string | null>(requirement?.verified_email ?? null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');

  // A reload after verifying lands here with the proof already on the server.
  useEffect(() => {
    if (requirement?.verified_email) setVerifiedAs(requirement.verified_email);
  }, [requirement?.verified_email]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const sendCode = useCallback(
    async (email: string) => {
      setSending(true);
      setError('');
      try {
        const result: any = await tenantService.sendActivationEmailCode({ token, email: normalizeEmail(email) });
        setCodeSentTo(result?.email ?? normalizeEmail(email));
        setCode('');
        setCountdown(Number(result?.resend_after_seconds) || 45);
        return true;
      } catch (err: any) {
        setError(err?.response?.data?.error?.message || 'We couldn’t send the code. Try again in a moment.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [token]
  );

  const verify = useCallback(
    async (email: string, value: string) => {
      setVerifying(true);
      setError('');
      try {
        const result: any = await tenantService.verifyActivationEmailCode({
          token,
          email: normalizeEmail(email),
          code: value.replace(/\s+/g, ''),
        });
        setVerifiedAs(result?.email ?? normalizeEmail(email));
        return true;
      } catch (err: any) {
        setError(err?.response?.data?.error?.message || 'That code didn’t work. Try again.');
        return false;
      } finally {
        setVerifying(false);
      }
    },
    [token]
  );

  return { codeSentTo, verifiedAs, code, setCode, sending, verifying, countdown, error, setError, sendCode, verify };
}

export type EmailVerificationState = ReturnType<typeof useEmailVerification>;
