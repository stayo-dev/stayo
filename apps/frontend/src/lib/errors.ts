export interface HmsError {
  title: string;
  description: string;
  action: string;
  retryable: boolean;
  category: ErrorCategory;
}

export type ErrorCategory =
  | 'auth'
  | 'permission'
  | 'network'
  | 'payment'
  | 'validation'
  | 'tenant'
  | 'document'
  | 'not_found'
  | 'server'
  | 'generic';

type AxiosLike = {
  response?: {
    data?: {
      error?: { message?: string; code?: string };
      message?: string;
      code?: string;
    };
    status?: number;
  };
  message?: string;
  code?: string;
};

export function parseApiError(error: unknown): string {
  if (!error) return '';
  const e = error as AxiosLike;
  const data = e.response?.data;
  if (data?.error?.message) return data.error.message;
  if (data?.message) return data.message;
  if (e.message && !e.message.includes('Request failed')) return e.message;
  const status = e.response?.status;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not found';
  if (status === 429) return 'too many attempts';
  if (status && status >= 500) return 'server error';
  if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') return 'network error';
  return 'unknown error';
}

export function translateError(rawMessage: string, context?: string): HmsError {
  const m = rawMessage.toLowerCase();

  // ── AUTH ───────────────────────────────────────────────────────────────
  if (
    m.includes('incorrect email') ||
    m.includes('incorrect password') ||
    m.includes('invalid credentials') ||
    m.includes('password does not match') ||
    (m.includes('password') && m.includes('wrong'))
  ) {
    return {
      title: 'Sign in unsuccessful',
      description: 'The email or password you entered does not match our records.',
      action: 'Double-check your email address and try a different password.',
      retryable: true,
      category: 'auth',
    };
  }

  if (m.includes('too many') || m.includes('rate limit') || m.includes('rate_limited')) {
    return {
      title: 'Too many attempts',
      description: 'Your account has been temporarily locked to protect your security.',
      action: 'Please wait 5–10 minutes before trying again.',
      retryable: false,
      category: 'auth',
    };
  }

  if (
    (m.includes('session') && (m.includes('expired') || m.includes('invalid'))) ||
    m.includes('token expired') ||
    m.includes('jwt expired')
  ) {
    return {
      title: 'Session expired',
      description: 'Your login session has ended. This happens for security after a period of inactivity.',
      action: 'Sign in again to continue where you left off.',
      retryable: false,
      category: 'auth',
    };
  }

  if (
    m.includes('unauthorized') ||
    m.includes('not authenticated') ||
    m === 'unauthorized'
  ) {
    return {
      title: 'Sign in required',
      description: 'You need to be signed in to perform this action.',
      action: 'Sign in and try again.',
      retryable: false,
      category: 'auth',
    };
  }

  if (m.includes('account not found') || m.includes('user not found') || (m.includes('account') && m.includes('404'))) {
    return {
      title: 'Account not found',
      description: 'No account exists with this email address.',
      action: 'Check your email address or contact your hostel manager.',
      retryable: false,
      category: 'auth',
    };
  }

  if (m.includes('identity') || m.includes('confirm-identity') || m.includes('identity_token')) {
    return {
      title: 'Identity verification failed',
      description: 'Your password could not be verified for this sensitive action.',
      action: 'Re-enter your current password and try again.',
      retryable: true,
      category: 'auth',
    };
  }

  // ── PERMISSION ─────────────────────────────────────────────────────────
  if (
    m.includes('forbidden') ||
    m === 'forbidden' ||
    m.includes('access denied') ||
    m.includes('not allowed') ||
    (m.includes('permission') && !m.includes('file'))
  ) {
    return {
      title: 'Access denied',
      description: "You don't have permission to perform this action.",
      action: 'Contact your hostel manager if you believe this is a mistake.',
      retryable: false,
      category: 'permission',
    };
  }

  if (m.includes('hostel_context_required') || m.includes('hostel context required')) {
    return {
      title: 'No hostel selected',
      description: 'This action requires a hostel to be selected first.',
      action: 'Go back, select a hostel, and try again.',
      retryable: false,
      category: 'permission',
    };
  }

  // ── NETWORK ────────────────────────────────────────────────────────────
  if (
    m.includes('network error') ||
    m.includes('unable to connect') ||
    m.includes('check your internet') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('err_network') ||
    m.includes('failed to fetch')
  ) {
    return {
      title: 'Connection problem',
      description: 'Unable to reach the server. Your internet connection may be unstable.',
      action: 'Check your connection and try again.',
      retryable: true,
      category: 'network',
    };
  }

  if (m.includes('timeout') || m.includes('timed out') || m.includes('econnaborted')) {
    return {
      title: 'Request timed out',
      description: 'The server took too long to respond. This is usually temporary.',
      action: 'Try again in a moment.',
      retryable: true,
      category: 'network',
    };
  }

  // ── PAYMENT ────────────────────────────────────────────────────────────
  if (m.includes('already paid') || m.includes('duplicate payment')) {
    return {
      title: 'Payment already recorded',
      description: 'This due has already been paid.',
      action: 'Refresh the page to see the latest payment status.',
      retryable: false,
      category: 'payment',
    };
  }

  if (m.includes('exceed') && (m.includes('amount') || m.includes('outstanding') || m.includes('balance'))) {
    return {
      title: 'Amount too high',
      description: 'The amount entered is more than the outstanding balance for this due.',
      action: 'Enter an amount equal to or less than the outstanding balance.',
      retryable: true,
      category: 'payment',
    };
  }

  if (m.includes('payment') && (m.includes('fail') || m.includes('declin') || m.includes('rejected'))) {
    return {
      title: 'Payment could not be completed',
      description: 'The payment was declined or could not be processed by the bank.',
      action: 'Check your payment details and try again. No amount has been charged.',
      retryable: true,
      category: 'payment',
    };
  }

  if (m.includes('payment') && m.includes('expired')) {
    return {
      title: 'Payment session expired',
      description: 'Your payment session timed out before the transaction completed.',
      action: 'Start a new payment from your financials page.',
      retryable: false,
      category: 'payment',
    };
  }

  if (m.includes('payment') && (m.includes('pending') || m.includes('processing'))) {
    return {
      title: 'Payment is still processing',
      description: "We're waiting for confirmation from the payment provider. Your money is safe.",
      action: 'Wait a moment and check your financials page. Do not pay again.',
      retryable: false,
      category: 'payment',
    };
  }

  // ── TENANT / ROOM ──────────────────────────────────────────────────────
  if (m.includes('room') && m.includes('full')) {
    return {
      title: 'Room is full',
      description: 'The selected room has no available beds.',
      action: 'Choose a different room or update room capacity in room settings.',
      retryable: false,
      category: 'tenant',
    };
  }

  if (m.includes('tenant') && m.includes('not found')) {
    return {
      title: 'Tenant not found',
      description: 'This tenant record could not be located.',
      action: 'Refresh the page or check if the tenant has been removed.',
      retryable: false,
      category: 'tenant',
    };
  }

  if (m.includes('invitation') && m.includes('expired')) {
    return {
      title: 'Invitation has expired',
      description: 'This tenant invitation is no longer active.',
      action: 'Resend the invitation from the tenant list.',
      retryable: false,
      category: 'tenant',
    };
  }

  if (m.includes('already has an active') || m.includes('already active')) {
    return {
      title: 'Tenant is already active',
      description: 'This tenant already has an active room assignment.',
      action: 'Check the tenant profile for current allocation details.',
      retryable: false,
      category: 'tenant',
    };
  }

  if (m.includes('move-out') || m.includes('move out')) {
    return {
      title: 'Move-out request failed',
      description: 'The move-out could not be processed at this time.',
      action: 'Check the tenant status and try again, or contact support.',
      retryable: true,
      category: 'tenant',
    };
  }

  // ── DOCUMENT / UPLOAD ──────────────────────────────────────────────────
  if (m.includes('file') && (m.includes('too large') || m.includes('size limit') || m.includes('payload too large'))) {
    return {
      title: 'File is too large',
      description: 'The file exceeds the maximum allowed upload size.',
      action: 'Compress the file or choose a smaller one and try again.',
      retryable: true,
      category: 'document',
    };
  }

  if (m.includes('unsupported') || (m.includes('file') && m.includes('type'))) {
    return {
      title: 'Unsupported file format',
      description: 'Only JPEG, PNG, and PDF files are accepted.',
      action: 'Convert your document to an accepted format and try again.',
      retryable: true,
      category: 'document',
    };
  }

  if (m.includes('plan_limit') || m.includes('plan limit') || (m.includes('plan') && m.includes('upgrade'))) {
    return {
      title: 'Feature not available on your plan',
      description: 'Your current plan does not include this feature.',
      action: 'Upgrade your plan to unlock this capability.',
      retryable: false,
      category: 'document',
    };
  }

  // ── NOT FOUND ──────────────────────────────────────────────────────────
  if (m.includes('not found') || m === 'not found') {
    const item = context ? `${context}` : 'The item you are looking for';
    return {
      title: 'Not found',
      description: `${item} could not be located.`,
      action: 'Refresh the page or go back and try again.',
      retryable: false,
      category: 'not_found',
    };
  }

  // ── VALIDATION ─────────────────────────────────────────────────────────
  if (m.includes('validation') || m.includes('invalid') || m.includes('required field') || m.includes('missing')) {
    return {
      title: 'Some details are missing or incorrect',
      description: 'One or more fields contain invalid information.',
      action: 'Review the highlighted fields and correct the information.',
      retryable: true,
      category: 'validation',
    };
  }

  // ── SERVER ─────────────────────────────────────────────────────────────
  if (m.includes('server error') || m.includes('internal server') || m.includes('500')) {
    return {
      title: 'Something went wrong on our end',
      description: 'Our server encountered an unexpected problem.',
      action: 'Wait a moment and try again. If the issue persists, contact support.',
      retryable: true,
      category: 'server',
    };
  }

  if (m.includes('service unavailable') || m.includes('502') || m.includes('503')) {
    return {
      title: 'Service temporarily unavailable',
      description: 'Our system is momentarily unavailable.',
      action: 'Please try again in a few minutes.',
      retryable: true,
      category: 'server',
    };
  }

  // ── GENERIC FALLBACK ───────────────────────────────────────────────────
  const titleBase = context ? `${context} failed` : 'Action could not be completed';
  return {
    title: titleBase,
    description:
      rawMessage && rawMessage !== 'unknown error'
        ? rawMessage
        : 'An unexpected error occurred.',
    action: 'Try again. If the issue continues, contact support.',
    retryable: true,
    category: 'generic',
  };
}

export function getHmsError(error: unknown, context?: string): HmsError {
  const raw = parseApiError(error);
  return translateError(raw, context);
}
