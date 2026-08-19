import { describe, expect, it } from 'vitest';
import type { MarketingContent } from '@features/hostel-marketing/api';
import { diffMarketingContent } from './marketingDiff';

function content(over: Partial<MarketingContent> = {}): MarketingContent {
  return {
    basics: { tagline: 'Quiet rooms near campus', about: 'A calm place', highlights: ['Wi-Fi'] },
    photos: [
      { url: 'a.jpg', label: null, is_cover: true, sort: 0, kind: 'image' },
      { url: 'b.jpg', label: null, is_cover: false, sort: 1, kind: 'image' },
    ],
    beds: [{ name: '4 Sharing', sharing: 4, price: 7000, inclusions: null, availability: 'AVAILABLE' }],
    amenities: [
      { label: 'Wi-Fi', enabled: true },
      { label: 'Gym', enabled: false },
    ],
    places: [{ name: 'Metro', distance: '400 m', category: 'TRANSPORT', sort: 0 }],
    mess: {
      provided: true,
      type: 'VEG',
      meals: [{ key: 'b', label: 'Breakfast', time: '7:30 – 9:00', enabled: true }],
      week: Array.from({ length: 7 }, () => ({ b: 'Idli', l: '', s: '', dn: '' })),
    },
    ...over,
  } as MarketingContent;
}

const section = (diff: ReturnType<typeof diffMarketingContent>, name: string) =>
  diff.sections.find((s) => s.section === name);

describe('diffMarketingContent', () => {
  it('reports nothing when nothing changed', () => {
    const diff = diffMarketingContent(content(), content());
    expect(diff.sections).toHaveLength(0);
    expect(diff.changeCount).toBe(0);
  });

  it('marks a first submission, where everything is new rather than changed', () => {
    expect(diffMarketingContent(null, content()).isFirstSubmission).toBe(true);
  });

  it('shows a tagline edit as before and after', () => {
    const diff = diffMarketingContent(content(), content({ basics: { tagline: 'Now with AC', about: 'A calm place', highlights: ['Wi-Fi'] } }));
    const line = section(diff, 'basics')!.lines[0];
    expect(line.label).toBe('Tagline');
    expect(line.before).toBe('Quiet rooms near campus');
    expect(line.after).toBe('Now with AC');
  });

  it('calls out a price change by itself — it is the claim a tenant acts on', () => {
    const diff = diffMarketingContent(
      content(),
      content({ beds: [{ name: '4 Sharing', sharing: 4, price: 9500, inclusions: null, availability: 'AVAILABLE' }] as any }),
    );
    expect(section(diff, 'beds')!.lines[0]).toMatchObject({
      label: '4 Sharing price',
      before: '₹7,000/mo',
      after: '₹9,500/mo',
    });
  });

  it('names added and removed bed types', () => {
    const diff = diffMarketingContent(
      content(),
      content({ beds: [{ name: '2 Sharing', sharing: 2, price: 12000, inclusions: null, availability: 'AVAILABLE' }] as any }),
    );
    const labels = section(diff, 'beds')!.lines.map((line) => line.label);
    expect(labels).toEqual(['Added "2 Sharing"', 'Removed "4 Sharing"']);
  });

  it('counts added photos and videos separately', () => {
    const diff = diffMarketingContent(
      content(),
      content({
        photos: [
          ...content().photos,
          { url: 'c.jpg', label: null, is_cover: false, sort: 2, kind: 'image' },
          { url: 'v.mp4', label: null, is_cover: false, sort: 3, kind: 'video' },
        ],
      }),
    );
    expect(section(diff, 'photos')!.lines[0]).toMatchObject({ label: 'Added', after: '1 photo and 1 video' });
  });

  it('reports a reorder only when nothing was added or removed', () => {
    const swapped = content({
      photos: [
        { url: 'b.jpg', label: null, is_cover: false, sort: 0, kind: 'image' },
        { url: 'a.jpg', label: null, is_cover: true, sort: 1, kind: 'image' },
      ],
    });
    expect(section(diffMarketingContent(content(), swapped), 'photos')!.lines.map((l) => l.label)).toContain('Order');

    const alsoAdded = content({
      photos: [...swapped.photos, { url: 'c.jpg', label: null, is_cover: false, sort: 2, kind: 'image' }],
    });
    expect(section(diffMarketingContent(content(), alsoAdded), 'photos')!.lines.map((l) => l.label)).not.toContain('Order');
  });

  it('flags a changed cover — every card and shared link uses it', () => {
    const recovered = content({
      photos: [
        { url: 'a.jpg', label: null, is_cover: false, sort: 0, kind: 'image' },
        { url: 'b.jpg', label: null, is_cover: true, sort: 1, kind: 'image' },
      ],
    });
    expect(section(diffMarketingContent(content(), recovered), 'photos')!.lines.map((l) => l.label)).toContain('Cover photo');
  });

  it('lists amenities switched on and off by name', () => {
    const diff = diffMarketingContent(
      content(),
      content({ amenities: [{ label: 'Wi-Fi', enabled: false }, { label: 'Gym', enabled: true }] as any }),
    );
    expect(section(diff, 'amenities')!.lines).toEqual([
      { label: 'Added', after: 'Gym' },
      { label: 'Removed', before: 'Wi-Fi' },
    ]);
  });

  it('names the days whose menu changed', () => {
    const week = Array.from({ length: 7 }, () => ({ b: 'Idli', l: '', s: '', dn: '' }));
    week[2] = { b: 'Poha', l: '', s: '', dn: '' };
    const diff = diffMarketingContent(content(), content({ mess: { ...content().mess, week } as any }));
    expect(section(diff, 'mess')!.lines[0]).toMatchObject({ label: 'Menu edited', after: 'Wed' });
  });

  it('notices meals being switched off', () => {
    const diff = diffMarketingContent(
      content(),
      content({ mess: { ...content().mess, meals: [{ key: 'b', label: 'Breakfast', time: '7:30 – 9:00', enabled: false }] } as any }),
    );
    expect(section(diff, 'mess')!.lines.map((l) => l.label)).toContain('Breakfast served');
  });

  it('totals every changed line for the header count', () => {
    const diff = diffMarketingContent(
      content(),
      content({
        basics: { tagline: 'New', about: 'New about', highlights: [] },
        places: [],
      }),
    );
    expect(diff.changeCount).toBe(diff.sections.reduce((n, s) => n + s.lines.length, 0));
    expect(diff.changeCount).toBeGreaterThan(3);
  });
});
