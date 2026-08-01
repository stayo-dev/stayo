/**
 * Reading what the invitation endpoints actually said about delivery.
 *
 * The wizard used to render "Invitation sent!" on every 2xx. The backend was
 * already reporting `whatsapp_sent` / `whatsapp_error` / `email_sent` /
 * `needs_email` and handing back the `activation_link` — the frontend threw
 * all of it away, so an owner could send twenty invitations, see twenty
 * success screens, and have nothing reach anyone.
 *
 * The trap this module exists to close: **both endpoints report delivery
 * failure with a 2xx status.** `POST /api/owners/invitations` answers 202 when
 * neither channel sent, and `POST /api/tenants/resend-invitation` answers 202
 * with an *error-shaped* body when it still has no email address. Axios
 * resolves on 2xx, so neither ever rejects — delivery state can only be read
 * from the body. Anything unrecognised is therefore treated as **undelivered**,
 * never as success.
 */

export type InviteDeliveryChannel = 'whatsapp' | 'email' | 'none';

export interface InviteDeliveryOutcome {
  /** Which channel actually reached the tenant. `none` means nothing did. */
  channel: InviteDeliveryChannel;
  /** Where it went — a phone number or an email address. Null when nothing sent. */
  sentTo: string | null;
  /**
   * The tenant's activation URL. Kept on every outcome, including success:
   * when both channels fail it is the owner's only way to onboard the tenant,
   * so it must never be dropped.
   */
  activationLink: string | null;
  /** True when adding an email address would give this invitation another chance. */
  needsEmail: boolean;
  /** Why delivery failed, when it did. Null on success. */
  reason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Strictly `true` — a truthy string like "false" must not read as delivered. */
function isTrue(value: unknown): boolean {
  return value === true;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Interprets a successful `POST /api/owners/invitations` body. */
export function resolveInviteDelivery(response: unknown): InviteDeliveryOutcome {
  const body = asRecord(response);
  const activationLink = asText(body.activation_link);
  const email = asText(body.email);
  const phone = asText(body.phone);

  if (isTrue(body.whatsapp_sent)) {
    return { channel: 'whatsapp', sentTo: phone, activationLink, needsEmail: false, reason: null };
  }

  if (isTrue(body.email_sent)) {
    // The WhatsApp error is deliberately not surfaced here: the invitation was
    // delivered, and reporting a failure alongside a success only confuses.
    return { channel: 'email', sentTo: email, activationLink, needsEmail: false, reason: null };
  }

  return {
    channel: 'none',
    sentTo: null,
    activationLink,
    needsEmail: isTrue(body.needs_email),
    reason: asText(body.whatsapp_error) ?? asText(body.email_error),
  };
}

/**
 * Interprets a `POST /api/tenants/resend-invitation` body.
 *
 * That route answers 202 with `{error: {code: 'EMAIL_FALLBACK_REQUIRED'}}` when
 * it still has no email, and 502 `DELIVERY_FAILED` when delivery failed
 * outright. Neither body carries an `activation_link`, so `previousLink` — the
 * link from the original invite — is carried forward rather than lost.
 */
export function resolveResendDelivery(response: unknown, previousLink: string | null): InviteDeliveryOutcome {
  const body = asRecord(response);
  const error = asRecord(body.error);
  const errorCode = asText(error.code);

  if (errorCode) {
    return {
      channel: 'none',
      sentTo: null,
      activationLink: asText(body.activation_link) ?? previousLink,
      needsEmail: errorCode === 'EMAIL_FALLBACK_REQUIRED',
      reason: asText(error.message),
    };
  }

  const outcome = resolveInviteDelivery(response);
  return { ...outcome, activationLink: outcome.activationLink ?? previousLink };
}

/** Minimal surface of `navigator.clipboard` this module needs, so it can be stubbed. */
export interface ClipboardLike {
  writeText: (text: string) => Promise<void>;
}

/**
 * Copies the activation link, reporting success as a boolean rather than
 * throwing — a blocked clipboard (insecure origin, denied permission) must
 * degrade to "select it yourself", never to an unhandled rejection on a screen
 * whose whole job is telling the owner the truth.
 */
export async function copyActivationLink(
  link: string | null | undefined,
  clipboard: ClipboardLike | undefined = typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
): Promise<boolean> {
  if (!link || !clipboard?.writeText) return false;
  try {
    await clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}

/** The message an owner forwards to a tenant when automated delivery failed. */
export function buildActivationShareText(tenantName: string, activationLink: string): string {
  const name = tenantName.trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return `${greeting}\n\nYour room is ready. Set up your Stayo account here:\n${activationLink}`;
}

/**
 * A `wa.me` deep link. Indian numbers are stored/entered without a country
 * code in this app, so a bare 10-digit number gets the 91 prefix; anything
 * already carrying it is left alone.
 */
export function buildWhatsAppShareUrl(phone: string, text: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  const recipient = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${recipient}?text=${encodeURIComponent(text)}`;
}
