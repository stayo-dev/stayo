import { describe, expect, it } from 'vitest';
import {
  buildHostByline, buildHostCard, buildMilestones, draftFrom, formatMonthYear, hiddenNotice, hostFacts,
  hostingYears, languagesPhrase, publicView, residentsLabel, toggleLanguage, withDraft,
} from './hostCardModel';
import type { EditableHost, PublicHost } from './types';

const HOST: PublicHost = {
  platform_listed: false,
  name: 'Shiva Prakash',
  photo_url: 'https://ik.example/p.jpg',
  bio: 'I started Sri Adithya in 2015.',
  languages: ['Telugu', 'Hindi', 'English'],
  hosting_since: 2015,
  verified: true,
  listed_since: '2026-09-15T12:00:00.000Z',
  stats: { review_count: 36, rating: 4.8, residents: 240 },
};

describe('formatting', () => {
  it('names months without depending on the runtime locale', () => {
    expect(formatMonthYear('2026-09-15T12:00:00.000Z')).toBe('September 2026');
    expect(formatMonthYear('2026-09-15T12:00:00.000Z', 'short')).toBe('Sep 2026');
    expect(formatMonthYear(null)).toBeNull();
    expect(formatMonthYear('not a date')).toBeNull();
  });

  it('lists languages the way a person says them', () => {
    expect(languagesPhrase([])).toBeNull();
    expect(languagesPhrase(['Telugu'])).toBe('Telugu');
    expect(languagesPhrase(['Telugu', 'Hindi'])).toBe('Telugu and Hindi');
    expect(languagesPhrase(['Telugu', 'Hindi', 'English'])).toBe('Telugu, Hindi and English');
  });

  it('adds + only to the rounded resident figures', () => {
    expect(residentsLabel(7)).toBe('7');
    expect(residentsLabel(240)).toBe('240+');
  });

  it('states facts only when the owner gave them', () => {
    expect(hostFacts(HOST)).toEqual(['Running hostels since 2015', 'Speaks Telugu, Hindi and English']);
    expect(hostFacts({ hosting_since: null, languages: [] })).toEqual([]);
  });
});

describe('buildHostCard', () => {
  it('leads with the owner\'s own words when there are some', () => {
    const card = buildHostCard(HOST, { hostelName: 'Sri Adithya Boys Hostel' })!;
    expect(card.variant).toBe('note');
    expect(card.heading).toBe('Meet your host');
    expect(card.name).toBe('Shiva Prakash');
    expect(card.bio).toBe('I started Sri Adithya in 2015.');
    expect(card.role).toBe('Owner');
    expect(card.stats).toEqual([
      { key: 'rating', value: '4.8★', label: '36 reviews' },
      { key: 'residents', value: '240+', label: 'residents' },
      { key: 'since', value: 'Sep 2026', label: 'on Stayo since' },
    ]);
  });

  it('addresses the owner by full name on the button — never first name only', () => {
    expect(buildHostCard(HOST)!.ctaLabel).toBe('Enquire with Shiva Prakash');
    expect(buildHostCard({ ...HOST, name: null })!.ctaLabel).toBe('Enquire');
  });

  it('honours an owner with no words yet: no quote, name and hostel first', () => {
    const card = buildHostCard({ ...HOST, bio: '   ' }, { hostelName: 'Sri Adithya Boys Hostel' })!;
    expect(card.variant).toBe('compact');
    expect(card.heading).toBe('Meet your host');
    expect(card.bio).toBeNull();
    expect(card.role).toBe('Owner of Sri Adithya Boys Hostel · On Stayo since September 2026');
    // The role line already says since when — the stat would repeat it.
    expect(card.stats.map((s) => s.key)).toEqual(['rating', 'residents']);
  });

  it('never shows a zero or an unknown stat', () => {
    const card = buildHostCard({ ...HOST, stats: { review_count: 0, rating: null, residents: null } })!;
    expect(card.stats.map((s) => s.key)).toEqual(['since']);
    expect(buildHostCard({ ...HOST, stats: { review_count: 1, rating: 5, residents: null } })!.stats[0])
      .toEqual({ key: 'rating', value: '5.0★', label: '1 review' });
  });

  it('keeps a platform listing to "Listed by Stayo"', () => {
    const card = buildHostCard({ ...HOST, platform_listed: true, name: null, bio: null })!;
    expect(card.variant).toBe('platform');
    expect(card.heading).toBe('Listed by Stayo');
    expect(card.ctaLabel).toBeNull();
    expect(card.stats).toEqual([]);
  });

  it('names the owner on a platform listing whose content carries a host name', () => {
    const card = buildHostCard({ ...HOST, platform_listed: true, name: ' Samala Poshetty ', bio: null })!;
    expect(card.variant).toBe('platform');
    expect(card.heading).toBe('Hosted by Samala Poshetty');
    expect(card.role).toBe('Owner');
    expect(card.initial).toBe('S');
    // Naming them claims nothing else: no button, no stats.
    expect(card.ctaLabel).toBeNull();
    expect(card.stats).toEqual([]);
  });

  it('renders nothing without a host', () => {
    expect(buildHostCard(null)).toBeNull();
    expect(buildHostCard(undefined)).toBeNull();
  });

  it('falls back to an initial, never an empty circle', () => {
    expect(buildHostCard(HOST)!.initial).toBe('S');
    expect(buildHostCard({ ...HOST, name: null })!.initial).toBe('S');
    expect(buildHostCard({ ...HOST, name: 'ravi kumar' })!.initial).toBe('R');
  });
});

describe('buildHostByline', () => {
  it('names the host in full, above the price, with no bio or button', () => {
    const byline = buildHostByline(HOST)!;
    expect(byline.title).toBe('Hosted by Shiva Prakash');
    expect(byline.line).toBe('Owner · On Stayo since Sep 2026');
    expect(byline.photoUrl).toBe('https://ik.example/p.jpg');
    expect(byline.verified).toBe(true);
    // The byline carries nothing the full card owns.
    expect(byline).not.toHaveProperty('bio');
    expect(byline).not.toHaveProperty('ctaLabel');
    expect(byline).not.toHaveProperty('stats');
  });

  it('says Stayo listed it rather than naming a sentinel profile', () => {
    const byline = buildHostByline({ ...HOST, platform_listed: true, name: null })!;
    expect(byline.title).toBe('Listed by Stayo');
    expect(byline.line).toBe('On Stayo since Sep 2026');
    expect(byline.photoUrl).toBeNull();
  });

  it('names the owner on a platform listing that carries a host name', () => {
    const byline = buildHostByline({ ...HOST, platform_listed: true, name: 'Samala Poshetty' })!;
    expect(byline.title).toBe('Hosted by Samala Poshetty');
    expect(byline.line).toBe('Owner');
    expect(byline.photoUrl).toBeNull();
  });

  it('still attributes the listing when the owner has no name on file', () => {
    expect(buildHostByline({ ...HOST, name: '  ' })!.title).toBe('Hosted by the owner');
  });

  it('drops the date rather than inventing one', () => {
    expect(buildHostByline({ ...HOST, listed_since: null })!.line).toBe('Owner');
  });

  it('renders nothing without a host', () => {
    expect(buildHostByline(null)).toBeNull();
    expect(buildHostByline(undefined)).toBeNull();
  });
});

describe('owner screen helpers', () => {
  const EDITABLE: EditableHost = { ...HOST, bio_hidden: false, photo_hidden: false };

  it('always shows three milestones, with a gentle placeholder instead of a zero', () => {
    expect(buildMilestones(HOST)).toEqual([
      { key: 'residents', value: '240+', label: 'residents welcomed' },
      { key: 'rating', value: '4.8★', label: 'from 36 reviews' },
      { key: 'since', value: 'Sep 2026', label: 'on Stayo since' },
    ]);
    expect(buildMilestones({ ...HOST, stats: { review_count: 0, rating: null, residents: null } })).toEqual([
      { key: 'residents', value: null, label: 'Shows once 5 residents have stayed' },
      { key: 'rating', value: null, label: 'Your first review will show here' },
      { key: 'since', value: 'Sep 2026', label: 'on Stayo since' },
    ]);
  });

  it('previews the draft exactly as the public will see it', () => {
    const draft = { ...draftFrom(EDITABLE), bio: '  New words  ', languages: ['Tamil'] };
    const preview = withDraft(EDITABLE, draft);
    expect(preview.bio).toBe('New words');
    expect(preview.languages).toEqual(['Tamil']);
    const hidden = publicView({ ...preview, bio_hidden: true, photo_hidden: true });
    expect(hidden.bio).toBeNull();
    expect(hidden.photo_url).toBeNull();
  });

  it('starts the draft from what is saved', () => {
    expect(draftFrom({ ...EDITABLE, bio: null, hosting_since: null, languages: [] }))
      .toEqual({ bio: '', languages: [], hosting_since: null });
  });

  it('toggles languages up to the limit', () => {
    expect(toggleLanguage(['Telugu'], 'Hindi')).toEqual(['Telugu', 'Hindi']);
    expect(toggleLanguage(['Telugu', 'Hindi'], 'Telugu')).toEqual(['Hindi']);
    const six = ['Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Malayalam'];
    expect(toggleLanguage(six, 'Odia')).toEqual(six);
  });

  it('tells the owner plainly what Stayo has hidden', () => {
    expect(hiddenNotice(EDITABLE)).toBeNull();
    expect(hiddenNotice({ ...EDITABLE, bio_hidden: true })).toBe(
      'Stayo has hidden your story from your public listing. Contact support if you think this is a mistake.',
    );
    expect(hiddenNotice({ ...EDITABLE, bio_hidden: true, photo_hidden: true })).toBe(
      'Stayo has hidden your story and photo from your public listing. Contact support if you think this is a mistake.',
    );
  });

  it('offers every year from now back to 1950', () => {
    const years = hostingYears(new Date('2026-09-14T00:00:00Z'));
    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(1950);
    expect(years).toHaveLength(77);
  });
});
