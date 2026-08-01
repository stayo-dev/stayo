import { describe, expect, it, vi } from 'vitest';
import {
  buildActivationShareText,
  buildWhatsAppShareUrl,
  copyActivationLink,
  resolveInviteDelivery,
  resolveResendDelivery,
} from './inviteDelivery';

/**
 * The invite wizard used to render "Invitation sent! {name} will get a text to
 * complete KYC." on every 2xx, while the backend was already reporting
 * `whatsapp_sent: false, email_sent: false, needs_email: true` and handing
 * back the `activation_link` needed to recover. The owner was told 20 invites
 * had gone out when nothing had been delivered.
 *
 * Both endpoints report delivery failure with a *success* status code — invite
 * answers 202 when nothing was sent, resend answers 202 with an error body —
 * so axios never rejects. Delivery state can only be read from the body, which
 * is what these tests pin.
 */

const LINK = 'https://yourstayo.com/activate/abc123';

function inviteResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    tenant_id: 'tenant-1',
    invitation_id: 'inv-1',
    email: null,
    phone: '+919000000000',
    activation_link: LINK,
    action: 'INVITED',
    whatsapp_sent: true,
    whatsapp_error: undefined,
    email_sent: false,
    email_error: undefined,
    needs_email: false,
    ...overrides,
  };
}

describe('resolveInviteDelivery', () => {
  describe('Case A — WhatsApp delivered', () => {
    it('reports the whatsapp channel', () => {
      const outcome = resolveInviteDelivery(inviteResponse());

      expect(outcome.channel).toBe('whatsapp');
      expect(outcome.needsEmail).toBe(false);
      expect(outcome.reason).toBeNull();
    });

    it('still carries the activation link, so it is never discarded', () => {
      expect(resolveInviteDelivery(inviteResponse()).activationLink).toBe(LINK);
    });

    it('prefers whatsapp when the backend somehow reports both', () => {
      const outcome = resolveInviteDelivery(inviteResponse({ email_sent: true }));

      expect(outcome.channel).toBe('whatsapp');
    });
  });

  describe('Case B — WhatsApp failed, email delivered', () => {
    const emailFallback = inviteResponse({
      whatsapp_sent: false,
      whatsapp_error: 'Template otp not approved',
      email_sent: true,
      email: 'tenant@example.com',
      needs_email: false,
    });

    it('reports the email channel', () => {
      const outcome = resolveInviteDelivery(emailFallback);

      expect(outcome.channel).toBe('email');
      expect(outcome.needsEmail).toBe(false);
    });

    it('names the address the invitation actually went to', () => {
      expect(resolveInviteDelivery(emailFallback).sentTo).toBe('tenant@example.com');
    });

    it('does not surface the WhatsApp error as a failure — delivery succeeded', () => {
      expect(resolveInviteDelivery(emailFallback).reason).toBeNull();
    });
  });

  describe('Case C — both failed', () => {
    it('reports no channel rather than success', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({
          whatsapp_sent: false,
          whatsapp_error: 'Recipient not on WhatsApp',
          email_sent: false,
          email_error: 'Invalid API key',
          email: 'tenant@example.com',
          needs_email: false,
        }),
      );

      expect(outcome.channel).toBe('none');
      expect(outcome.needsEmail).toBe(false);
    });

    it('surfaces why, so the owner is not left guessing', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({ whatsapp_sent: false, whatsapp_error: 'Recipient not on WhatsApp' }),
      );

      expect(outcome.reason).toBe('Recipient not on WhatsApp');
    });

    it('falls back to the email error when WhatsApp reported nothing', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({
          whatsapp_sent: false,
          whatsapp_error: undefined,
          email_sent: false,
          email_error: 'Mailbox full',
          email: 'tenant@example.com',
        }),
      );

      expect(outcome.reason).toBe('Mailbox full');
    });

    it('keeps the activation link — this is the only remaining recovery path', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({ whatsapp_sent: false, email_sent: false, needs_email: true }),
      );

      expect(outcome.activationLink).toBe(LINK);
    });
  });

  describe('needs_email', () => {
    it('flags that an email address would rescue this invitation', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({ whatsapp_sent: false, whatsapp_error: 'unreachable', needs_email: true }),
      );

      expect(outcome.channel).toBe('none');
      expect(outcome.needsEmail).toBe(true);
    });

    it('does not flag it when an email was already tried and failed', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({
          whatsapp_sent: false,
          email_sent: false,
          email_error: 'bounced',
          email: 'tenant@example.com',
          needs_email: false,
        }),
      );

      expect(outcome.needsEmail).toBe(false);
    });
  });

  describe('defensive reading', () => {
    // A 2xx with a body we don't recognise must never read as "delivered" —
    // that is the exact failure this whole change exists to remove.
    it('treats a missing delivery report as undelivered, not delivered', () => {
      expect(resolveInviteDelivery({ success: true, tenant_id: 't1' }).channel).toBe('none');
    });

    it('survives a null or non-object body', () => {
      expect(resolveInviteDelivery(null).channel).toBe('none');
      expect(resolveInviteDelivery('boom').channel).toBe('none');
    });

    it('reports a missing activation link as null rather than the string "undefined"', () => {
      const outcome = resolveInviteDelivery(
        inviteResponse({ whatsapp_sent: false, activation_link: undefined }),
      );

      expect(outcome.activationLink).toBeNull();
    });

    it('does not accept a truthy non-boolean as delivery confirmation', () => {
      expect(resolveInviteDelivery(inviteResponse({ whatsapp_sent: 'false' })).channel).toBe('none');
    });
  });
});

describe('resolveResendDelivery', () => {
  it('reports success when the resend actually delivered', () => {
    const outcome = resolveResendDelivery(
      { success: true, action: 'RESENT', activation_link: LINK, whatsapp_sent: false, email_sent: true, email: 'tenant@example.com' },
      LINK,
    );

    expect(outcome.channel).toBe('email');
    expect(outcome.sentTo).toBe('tenant@example.com');
  });

  // POST /api/tenants/resend-invitation answers 202 with an *error* body when
  // it still has no email. 202 is 2xx, so axios resolves — reading this as
  // success would re-introduce the exact lie being fixed.
  it('reads the 202 EMAIL_FALLBACK_REQUIRED body as undelivered', () => {
    const outcome = resolveResendDelivery(
      { error: { message: 'WhatsApp delivery failed.', code: 'EMAIL_FALLBACK_REQUIRED' } },
      LINK,
    );

    expect(outcome.channel).toBe('none');
    expect(outcome.needsEmail).toBe(true);
    expect(outcome.reason).toBe('WhatsApp delivery failed.');
  });

  it('reads a DELIVERY_FAILED body as undelivered without asking for an email again', () => {
    const outcome = resolveResendDelivery(
      { error: { message: 'Mailbox full', code: 'DELIVERY_FAILED' } },
      LINK,
    );

    expect(outcome.channel).toBe('none');
    expect(outcome.needsEmail).toBe(false);
  });

  // The resend error body carries no activation_link. Losing it here would
  // strand the owner with no recovery path at all.
  it('keeps the original activation link when the resend response omits it', () => {
    const outcome = resolveResendDelivery(
      { error: { message: 'nope', code: 'DELIVERY_FAILED' } },
      LINK,
    );

    expect(outcome.activationLink).toBe(LINK);
  });

  it('prefers a fresh activation link when the resend supplies one', () => {
    const fresh = 'https://yourstayo.com/activate/xyz789';
    const outcome = resolveResendDelivery(
      { success: true, activation_link: fresh, whatsapp_sent: true },
      LINK,
    );

    expect(outcome.activationLink).toBe(fresh);
  });
});

describe('copyActivationLink', () => {
  it('writes the link to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyActivationLink(LINK, { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('reports failure instead of throwing when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));

    await expect(copyActivationLink(LINK, { writeText })).resolves.toBe(false);
  });

  it('reports failure when there is no clipboard at all', async () => {
    await expect(copyActivationLink(LINK, undefined)).resolves.toBe(false);
  });

  it('refuses to copy a missing link', async () => {
    const writeText = vi.fn();

    await expect(copyActivationLink(null, { writeText })).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('share helpers', () => {
  it('names the tenant and includes the link', () => {
    const text = buildActivationShareText('Arjun Mehta', LINK);

    expect(text).toContain('Arjun Mehta');
    expect(text).toContain(LINK);
  });

  it('falls back to a neutral greeting when the name is blank', () => {
    expect(buildActivationShareText('  ', LINK)).not.toContain('undefined');
  });

  it('builds a wa.me url with the digits-only number and encoded text', () => {
    const url = buildWhatsAppShareUrl('90000 00000', 'Hi there & welcome');

    expect(url).toBe('https://wa.me/919000000000?text=Hi%20there%20%26%20welcome');
  });

  it('does not double-prefix a number that already carries the country code', () => {
    expect(buildWhatsAppShareUrl('+91 90000 00000', 'x')).toContain('wa.me/919000000000?');
  });

  it('omits the recipient when no usable phone is available', () => {
    expect(buildWhatsAppShareUrl('', 'x')).toBe('https://wa.me/?text=x');
  });
});
