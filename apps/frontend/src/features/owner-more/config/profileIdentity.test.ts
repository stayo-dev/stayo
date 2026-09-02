import { describe, expect, it } from 'vitest';
import { profileIdentity } from './profileIdentity';

/**
 * The Profile header names the owner, not the workspace. Two sources feed it
 * at different speeds — `useOwnerSession().ownerName` is already in context
 * and paints immediately, `GET /owner/me/profile` is authoritative but
 * arrives a moment later — so the resolution order is the whole design and
 * belongs in a pure function rather than inline in the page.
 */
describe('profileIdentity', () => {
  it('names the owner from their profile', () => {
    const id = profileIdentity({ profileName: 'Shivaprakash A', email: 'sp@example.com' });

    expect(id.name).toBe('Shivaprakash A');
    expect(id.sub).toBe('sp@example.com');
    expect(id.initials).toBe('SA');
  });

  it('paints the session name while the profile query is still in flight', () => {
    // The header must never flash empty: the session already knows who this
    // is, so it carries the first paint.
    const id = profileIdentity({ sessionName: 'Shivaprakash A' });

    expect(id.name).toBe('Shivaprakash A');
    expect(id.initials).toBe('SA');
  });

  it('prefers the profile name once it arrives', () => {
    // The profile is the record the owner edits under "Details"; the session
    // copy can lag behind a rename.
    const id = profileIdentity({ sessionName: 'Old Name', profileName: 'New Name' });

    expect(id.name).toBe('New Name');
  });

  it('treats a blank name as absent rather than showing an empty header', () => {
    const id = profileIdentity({ sessionName: '   ', profileName: '', email: 'sp@example.com' });

    expect(id.name).toBe('sp');
  });

  it('falls back to a placeholder when nothing at all is known yet', () => {
    expect(profileIdentity({}).name).toBe('Your profile');
    expect(profileIdentity({}).sub).toBe('');
  });

  it('shows the phone only when there is no email', () => {
    expect(profileIdentity({ profileName: 'A B', phone: '+919000000000' }).sub).toBe('+91 90000 00000');
    expect(profileIdentity({ profileName: 'A B', email: 'a@b.com', phone: '+919000000000' }).sub).toBe('a@b.com');
  });

  it('groups the phone for reading rather than printing it raw', () => {
    // Stored E.164 is one 12-digit run — "+918008046952" is a string to decode,
    // not a number to read. Whatever notation it arrives in, it is shown the
    // one way, via the shared formatter.
    for (const stored of ['+918008046952', '918008046952', '8008046952']) {
      expect(profileIdentity({ profileName: 'A B', phone: stored }).sub).toBe('+91 80080 46952');
    }
  });

  it('leaves a value it cannot read as a 10-digit number alone', () => {
    // Anything that does not reduce to ten digits is handed back untouched
    // rather than sliced into a shape it does not have.
    expect(profileIdentity({ profileName: 'A B', phone: '12345' }).sub).toBe('12345');
  });

  it('known limitation — a longer number keeps only its last ten digits', () => {
    // `toLocalPhone` slices the trailing 10 digits from *any* value, so an
    // 11-digit landline is reshaped into a mobile that does not exist. Pinned
    // rather than fixed: the helper is shared with every other phone display
    // in the app, and `canonicalPhone` only ever stores `[6-9]\d{9}`, so an
    // owner's number here is a mobile. Worth revisiting if landlines are ever
    // stored on a profile.
    expect(profileIdentity({ profileName: 'A B', phone: '044 2345 6789' }).sub).toBe('+91 44234 56789');
  });

  it('builds initials from at most the first two words', () => {
    expect(profileIdentity({ profileName: 'sri adithya boys hostel' }).initials).toBe('SA');
    expect(profileIdentity({ profileName: 'Meera' }).initials).toBe('M');
  });

  it('survives punctuation and extra whitespace in a name', () => {
    expect(profileIdentity({ profileName: '  Shivaprakash   A.  ' }).name).toBe('Shivaprakash   A.');
    expect(profileIdentity({ profileName: '  Shivaprakash   A.  ' }).initials).toBe('SA');
  });

  it('carries the photo when there is one', () => {
    expect(profileIdentity({ profileName: 'A B', photoUrl: 'https://ik.example/p.jpg' }).photoUrl).toBe(
      'https://ik.example/p.jpg',
    );
  });

  it('falls back to initials when there is no photo', () => {
    // Initials are computed either way, so the avatar has something to draw
    // the moment a photo is removed — no empty frame in between.
    const id = profileIdentity({ profileName: 'Shivaprakash A' });
    expect(id.photoUrl).toBeNull();
    expect(id.initials).toBe('SA');
  });

  it('ignores a blank photo url rather than rendering a broken image', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(profileIdentity({ profileName: 'A B', photoUrl: empty }).photoUrl).toBeNull();
    }
  });

  it('never returns an empty avatar', () => {
    // A blank circle reads as a broken image, not as "loading".
    for (const input of [{}, { profileName: '!!!' }, { email: 'x@y.com' }]) {
      expect(profileIdentity(input).initials.length).toBeGreaterThan(0);
    }
  });
});
