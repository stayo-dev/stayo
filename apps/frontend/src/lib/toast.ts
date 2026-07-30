import { toast } from 'sonner';
import { getHmsError, parseApiError } from './errors';

const fmt = (n: number) => `\u20B9${n.toLocaleString('en-IN')}`;

export const hmsToast = {
  error(error: unknown, context?: string): void {
    const { title, description, action } = getHmsError(error, context);
    toast.error(title, {
      description: `${description} \u2192 ${action}`,
      duration: 7000,
    });
  },

  success(message: string, description?: string): void {
    toast.success(message, { description, duration: 4000 });
  },

  warning(message: string, description?: string): void {
    toast.warning(message, { description, duration: 5500 });
  },

  info(message: string, description?: string): void {
    toast.info(message, { description, duration: 4500 });
  },

  paymentSuccess(amount?: number): void {
    const amtStr = amount != null ? ` of ${fmt(amount)}` : '';
    toast.success(`Payment${amtStr} confirmed`, {
      description: 'Your balance has been updated.',
      duration: 5000,
    });
  },

  paymentFailed(): void {
    toast.error('Payment could not be completed', {
      description: 'No amount was charged. Your payment was not processed. \u2192 Check your payment details and try again.',
      duration: 8000,
    });
  },

  paymentPending(): void {
    toast.loading('Confirming your payment\u2026', {
      description: 'This usually takes under a minute. Do not close this page.',
    });
  },

  networkError(): void {
    toast.error('Connection problem', {
      description: 'Unable to reach the server. Check your internet connection and try again.',
      duration: 6000,
    });
  },

  sessionExpired(): void {
    toast.error('Session expired', {
      description: 'Your login session has ended. \u2192 Sign in again to continue.',
      duration: 8000,
    });
  },

  copied(label?: string): void {
    toast.success(`${label ?? 'Copied'} to clipboard`, { duration: 2500 });
  },

  raw(message: string, opts?: { duration?: number }): void {
    toast.error(message, { duration: opts?.duration ?? 5000 });
  },

  fromApiError(error: unknown, fallback?: string): void {
    const raw = parseApiError(error);
    if (!raw || raw === 'unknown error') {
      toast.error(fallback ?? 'Something went wrong', {
        description: 'An unexpected error occurred. \u2192 Try again or contact support.',
        duration: 6000,
      });
      return;
    }
    hmsToast.error(error);
  },
};
