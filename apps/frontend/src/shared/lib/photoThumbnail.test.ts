import { describe, expect, it } from 'vitest';
import { photoThumbnail } from './photoThumbnail';

describe('photoThumbnail', () => {
  it('asks ImageKit for a face-centred square at twice the size, for sharp retina screens', () => {
    expect(photoThumbnail('https://ik.imagekit.io/stayo/t/a.jpg', 24)).toBe(
      'https://ik.imagekit.io/stayo/t/a.jpg?tr=w-48%2Ch-48%2Cfo-face',
    );
  });

  it('keeps any query the URL already has', () => {
    const out = photoThumbnail('https://ik.imagekit.io/stayo/a.jpg?updatedAt=1', 24)!;
    expect(out).toContain('updatedAt=1');
    expect(out).toContain('tr=w-48%2Ch-48%2Cfo-face');
  });

  it('never stacks a second transform on one already there', () => {
    expect(photoThumbnail('https://ik.imagekit.io/stayo/tr:w-10/a.jpg', 24)).toBe('https://ik.imagekit.io/stayo/tr:w-10/a.jpg');
    expect(photoThumbnail('https://ik.imagekit.io/stayo/a.jpg?tr=w-10', 24)).toBe('https://ik.imagekit.io/stayo/a.jpg?tr=w-10');
  });

  it('leaves other hosts, data URLs and junk alone', () => {
    expect(photoThumbnail('https://cdn.example.com/a.jpg', 24)).toBe('https://cdn.example.com/a.jpg');
    expect(photoThumbnail('data:image/png;base64,xx', 24)).toBe('data:image/png;base64,xx');
    expect(photoThumbnail('not a url', 24)).toBe('not a url');
  });

  it('has nothing to show for no photo', () => {
    expect(photoThumbnail(null, 24)).toBeNull();
    expect(photoThumbnail(undefined, 24)).toBeNull();
    expect(photoThumbnail('', 24)).toBeNull();
  });
});
