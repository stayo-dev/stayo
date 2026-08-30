import { describe, it, expect } from 'vitest';
import { claimLink, claimInviteMessage, claimWhatsappUrl } from './claimInvite';

describe('claimLink', () => {
  it('points at the claim flow', () => {
    expect(claimLink('https://yourstayo.com')).toBe('https://yourstayo.com/claim');
  });

  it('does not double the slash when the origin carries one', () => {
    expect(claimLink('https://yourstayo.com/')).toBe('https://yourstayo.com/claim');
  });

  it('carries no token — possession is proved by OTP, not by the link', () => {
    // A link that leaked would still get a stranger nowhere, which is what
    // makes it safe to send over WhatsApp or read out on the phone.
    expect(claimLink('https://yourstayo.com')).not.toMatch(/[?&]/);
  });
});

describe('claimInviteMessage', () => {
  const base = { tenantName: 'Shiva Prakash', hostelName: 'Sunrise Residency', link: 'https://yourstayo.com/claim' };

  it('opens as the hostel, not as an app the tenant has never heard of', () => {
    const msg = claimInviteMessage(base);
    expect(msg).toContain('Sunrise Residency');
    expect(msg.startsWith('Hi Shiva,')).toBe(true);
  });

  it('uses the first name only', () => {
    expect(claimInviteMessage(base)).not.toContain('Shiva Prakash');
  });

  it('carries the link', () => {
    expect(claimInviteMessage(base)).toContain('https://yourstayo.com/claim');
  });

  it('says what they will see, in their words rather than ours', () => {
    const msg = claimInviteMessage(base);
    expect(msg).toMatch(/paid/);
    expect(msg).toMatch(/due/);
    // "Claim your tenancy" is our vocabulary, not a resident's.
    expect(msg.toLowerCase()).not.toContain('claim your');
  });

  it('says nothing breaks if they ignore it', () => {
    // They are being asked to tap a link about their own money by someone
    // they may not have expected a message from.
    expect(claimInviteMessage(base)).toMatch(/stay exactly as they are/);
  });

  it('still reads properly with a missing name or hostel', () => {
    const msg = claimInviteMessage({ tenantName: '  ', hostelName: '', link: 'x' });
    expect(msg.startsWith('Hi Hi,')).toBe(false);
    expect(msg).toContain('the hostel');
  });
});

describe('claimWhatsappUrl', () => {
  const msg = 'hello';

  it('opens a chat with the tenant, not a share sheet', () => {
    // The app knows whose number it is; the owner should not have to search
    // their contacts for it.
    expect(claimWhatsappUrl('9876543210', msg)).toBe('https://wa.me/919876543210?text=hello');
  });

  it('accepts a number typed with the country code or spacing', () => {
    expect(claimWhatsappUrl('+91 98765 43210', msg)).toBe('https://wa.me/919876543210?text=hello');
    expect(claimWhatsappUrl('09876543210', msg)).toBe('https://wa.me/919876543210?text=hello');
  });

  it('encodes the message so newlines and symbols survive', () => {
    const url = claimWhatsappUrl('9876543210', 'a\nb & c')!;
    expect(url).toContain('a%0Ab%20%26%20c');
  });

  it('returns null for an unusable number rather than drawing a dead button', () => {
    expect(claimWhatsappUrl('123', msg)).toBeNull();
    expect(claimWhatsappUrl('', msg)).toBeNull();
  });
});
