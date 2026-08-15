import { describe, it, expect } from 'vitest';
import { extractError, interpolate, resolveError, toErrorLine } from './resolveError';

const apiError = (
  code: string,
  message = 'boom',
  status = 400,
  metadata?: Record<string, unknown>,
) => ({
  isAxiosError: true,
  response: { status, data: { success: false, error: { code, message, ...(metadata ? { metadata } : {}) } } },
});

describe('extractError', () => {
  it('reads the envelope the backend actually sends', () => {
    const e = extractError(apiError('OTP_SEND_FAILED', 'Failed to send OTP', 502));
    expect(e).toMatchObject({ code: 'OTP_SEND_FAILED', message: 'Failed to send OTP', status: 502 });
  });

  it('distinguishes "never reached the server" from "server said no"', () => {
    // A dropped connection needs different guidance from a rejection, and
    // axios only tells them apart by the absence of `response`.
    expect(extractError({ isAxiosError: true }).isNetwork).toBe(true);
    expect(extractError(apiError('FORBIDDEN')).isNetwork).toBe(false);
  });

  it('survives anything thrown at it — an error surface must never throw', () => {
    expect(() => extractError(null)).not.toThrow();
    expect(() => extractError(undefined)).not.toThrow();
    expect(() => extractError('plain string')).not.toThrow();
    expect(extractError(new Error('nope')).message).toBe('nope');
    expect(extractError('plain string').message).toBe('plain string');
  });
});

describe('resolveError', () => {
  it('always answers all three questions', () => {
    const r = resolveError(apiError('OTP_SEND_FAILED', 'Failed to send OTP', 502));
    expect(r.title).toBe("Couldn't send the code");
    expect(r.why).toBeTruthy();
    expect(r.nextStep).toBeTruthy();
  });

  it('never leaves a user without a next step, even for an unknown code', () => {
    const r = resolveError(apiError('SOME_CODE_NOBODY_MAPPED', 'Widget desynchronised'));
    expect(r.nextStep).toBeTruthy();
    expect(r.action).toBeTruthy();
  });

  it('keeps the server message as the title for unmapped codes rather than discarding it', () => {
    // It is still the most accurate description available — but it never
    // becomes the *guidance*, because backend messages are written for devs.
    const r = resolveError(apiError('WEIRD', 'Obligation is superseded'));
    expect(r.title).toBe('Obligation is superseded');
    expect(r.nextStep).not.toContain('superseded');
  });

  it('always surfaces the code, so a user reporting it gives support something real', () => {
    expect(resolveError(apiError('TENANT_HAS_ACTIVE_TENANCY')).code).toBe('TENANT_HAS_ACTIVE_TENANCY');
    expect(resolveError(new Error('x')).code).toBe('ERROR');
  });

  it('routes severity so guidance is never shown somewhere it vanishes', () => {
    expect(resolveError(apiError('UNAUTHORIZED', 'x', 401)).severity).toBe('blocking');
    expect(resolveError(apiError('OTP_EXPIRED')).severity).toBe('needs-step');
  });

  it('treats a lost connection as its own case', () => {
    const r = resolveError({ isAxiosError: true });
    expect(r.code).toBe('NETWORK_ERROR');
    expect(r.why).toContain('offline');
    expect(r.nextStep).toContain('nothing was saved');
  });

  it('offers signing back in when the session ended, rather than a bare retry', () => {
    const r = resolveError(apiError('SESSION_INACTIVE', 'Session inactive', 401));
    expect(r.action).toMatchObject({ intent: 'SIGN_IN' });
    expect(r.severity).toBe('blocking');
  });

  describe('generic codes', () => {
    it('says something specific once it knows the flow', () => {
      // FORBIDDEN is emitted 334 times across the backend; context is what
      // makes it mean something without a backend sweep.
      const invite = resolveError(apiError('FORBIDDEN', 'Forbidden', 403), 'invite-tenant');
      const payment = resolveError(apiError('FORBIDDEN', 'Forbidden', 403), 'payment');

      expect(invite.title).toBe("You can't invite to that room");
      expect(payment.title).toBe("You can't record that payment");
      expect(invite.title).not.toBe(payment.title);
    });

    it('still guides usefully with no context at all', () => {
      const r = resolveError(apiError('FORBIDDEN', 'Forbidden', 403));
      expect(r.title).toBe("You don't have access to that");
      expect(r.nextStep).toBeTruthy();
    });

    it('falls back to the status when the code is unmapped in this flow', () => {
      const r = resolveError(apiError('SOMETHING_ODD', 'odd', 404), 'payment');
      expect(r.title).toBe("That doesn't exist any more");
    });

    it('prefers a context entry over the shared catalogue', () => {
      const generic = resolveError(apiError('VALIDATION_ERROR', 'bad', 422));
      const scoped = resolveError(apiError('VALIDATION_ERROR', 'bad', 422), 'hostel-setup');
      expect(scoped.title).toBe("That can't be saved yet");
      expect(scoped.title).not.toBe(generic.title);
    });
  });

  describe('metadata interpolation', () => {
    it('makes guidance specific without the backend carrying prose', () => {
      expect(interpolate('Room {room} already exists', { room: '101' })).toBe('Room 101 already exists');
    });

    it('drops a placeholder with no value rather than printing it raw', () => {
      // A user must never see "Room {room} already exists".
      expect(interpolate('Room {room} already exists', {})).toBe('Room already exists');
      expect(interpolate('a {x} b', { x: null })).toBe('a b');
    });
  });
});

describe('toErrorLine', () => {
  it('keeps the next step when only one line fits', () => {
    const line = toErrorLine(resolveError(apiError('OTP_EXPIRED')));
    expect(line).toContain('expired');
    expect(line).toContain('Request a new one');
  });
});
