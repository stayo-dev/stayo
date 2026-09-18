import { describe, expect, it } from 'vitest';
import { listingPhotoUrl } from './listingPhoto';

const IK = 'https://ik.imagekit.io/stayo/hostel.jpg';

describe('listingPhotoUrl', () => {
  it('is null for a missing photo', () => {
    expect(listingPhotoUrl(null, 600)).toBeNull();
    expect(listingPhotoUrl(undefined, 600)).toBeNull();
  });

  it('asks ImageKit for twice the drawn width, auto format, no face crop', () => {
    const out = listingPhotoUrl(IK, 600);
    expect(new URL(out as string).searchParams.get('tr')).toBe('w-1200,q-75,f-auto');
  });

  it('leaves non-ImageKit hosts untouched', () => {
    const other = 'https://example.com/a.jpg';
    expect(listingPhotoUrl(other, 600)).toBe(other);
  });

  it('never double-transforms a url that already carries one', () => {
    const already = 'https://ik.imagekit.io/stayo/tr:w-100/hostel.jpg';
    expect(listingPhotoUrl(already, 600)).toBe(already);
    const query = `${IK}?tr=w-100`;
    expect(listingPhotoUrl(query, 600)).toBe(query);
  });

  it('returns junk unchanged rather than throwing', () => {
    expect(listingPhotoUrl('not a url', 600)).toBe('not a url');
  });
});
