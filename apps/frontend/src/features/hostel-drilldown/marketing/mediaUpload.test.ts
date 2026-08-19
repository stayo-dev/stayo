import { describe, expect, it } from 'vitest';
import type { MarketingPhoto } from '@features/hostel-marketing/api';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  canBeCover,
  classifyFiles,
  isVideoFile,
  removeMedia,
  reorderMedia,
  setCover,
} from './mediaUpload';

/** A stand-in for a picked file — only type/size/name are ever read. */
function file(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

function media(overrides: Partial<MarketingPhoto> = {}): MarketingPhoto {
  return { url: 'https://x/1.jpg', is_cover: false, sort: 0, kind: 'image', ...overrides };
}

describe('classifyFiles', () => {
  it('accepts a whole phone multi-select whose files are each within the limit', () => {
    // The bug: ten 4MB photos were sent as one ~40MB request and rejected as
    // "limit exceeded", though no single photo was near the 8MB cap.
    const picked = Array.from({ length: 10 }, (_unused, i) => file(`p${i}.jpg`, 'image/jpeg', 4 * 1024 * 1024));
    const result = classifyFiles(picked, 24);
    expect(result.accepted).toHaveLength(10);
    expect(result.tooBig).toHaveLength(0);
  });

  it('measures each file against the limit for its own kind', () => {
    const result = classifyFiles(
      [
        file('big.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1),
        file('clip.mp4', 'video/mp4', 30 * 1024 * 1024),
        file('huge.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1),
      ],
      24,
    );
    expect(result.accepted.map((f) => f.name)).toEqual(['clip.mp4']);
    expect(result.tooBig.map((f) => f.name)).toEqual(['big.jpg', 'huge.mp4']);
  });

  it('takes iPhone .mov video', () => {
    expect(classifyFiles([file('IMG_0001.MOV', 'video/quicktime', 1000)], 24).accepted).toHaveLength(1);
  });

  it('separates files it cannot take at all', () => {
    const result = classifyFiles([file('doc.pdf', 'application/pdf', 100)], 24);
    expect(result.accepted).toHaveLength(0);
    expect(result.wrongType).toHaveLength(1);
  });

  it('fills the remaining slots and reports the rest as overflow', () => {
    const picked = Array.from({ length: 5 }, (_u, i) => file(`p${i}.jpg`, 'image/jpeg', 1000));
    const result = classifyFiles(picked, 2);
    expect(result.accepted).toHaveLength(2);
    expect(result.overflow).toHaveLength(3);
  });

  it('accepts nothing when the listing is already full', () => {
    expect(classifyFiles([file('p.jpg', 'image/jpeg', 1000)], 0).accepted).toHaveLength(0);
    expect(classifyFiles([file('p.jpg', 'image/jpeg', 1000)], -3).accepted).toHaveLength(0);
  });
});

describe('isVideoFile', () => {
  it('knows the three video types we take', () => {
    expect(isVideoFile('video/mp4')).toBe(true);
    expect(isVideoFile('video/quicktime')).toBe(true);
    expect(isVideoFile('image/jpeg')).toBe(false);
  });
});

describe('reorderMedia', () => {
  const list = [
    media({ url: 'a', sort: 0, is_cover: true }),
    media({ url: 'b', sort: 1 }),
    media({ url: 'c', sort: 2 }),
  ];

  it('moves an item and renumbers sort with no gaps', () => {
    const next = reorderMedia(list, 2, 0);
    expect(next.map((m) => m.url)).toEqual(['c', 'a', 'b']);
    expect(next.map((m) => m.sort)).toEqual([0, 1, 2]);
  });

  it('keeps the cover on the same photo, wherever it moves', () => {
    const next = reorderMedia(list, 0, 2);
    expect(next.find((m) => m.is_cover)?.url).toBe('a');
  });

  it('is a no-op for an out-of-range or unchanged move, but still renumbers', () => {
    expect(reorderMedia(list, 1, 1).map((m) => m.url)).toEqual(['a', 'b', 'c']);
    expect(reorderMedia(list, 0, 9).map((m) => m.url)).toEqual(['a', 'b', 'c']);
    expect(reorderMedia([media({ url: 'a', sort: 7 })], 0, 0)[0].sort).toBe(0);
  });
});

describe('removeMedia', () => {
  it('passes the cover to the first remaining photo', () => {
    const next = removeMedia(
      [media({ url: 'a', is_cover: true }), media({ url: 'b' }), media({ url: 'c' })],
      0,
    );
    expect(next.find((m) => m.is_cover)?.url).toBe('b');
  });

  it('never hands the cover to a video', () => {
    // The cover is the search card's thumbnail and a shared link's preview
    // image; neither can play.
    const next = removeMedia(
      [media({ url: 'a', is_cover: true }), media({ url: 'v', kind: 'video' }), media({ url: 'c' })],
      0,
    );
    expect(next.find((m) => m.is_cover)?.url).toBe('c');
  });

  it('leaves an all-video gallery with no cover rather than an unplayable one', () => {
    const next = removeMedia([media({ url: 'a', is_cover: true }), media({ url: 'v', kind: 'video' })], 0);
    expect(next.some((m) => m.is_cover)).toBe(false);
  });

  it('renumbers what is left', () => {
    const next = removeMedia([media({ url: 'a' }), media({ url: 'b' }), media({ url: 'c' })], 1);
    expect(next.map((m) => m.sort)).toEqual([0, 1]);
  });
});

describe('setCover / canBeCover', () => {
  it('refuses to make a video the cover', () => {
    expect(canBeCover({ kind: 'video' })).toBe(false);
    const list = [media({ url: 'a', is_cover: true }), media({ url: 'v', kind: 'video' })];
    expect(setCover(list, 1)).toBe(list);
  });

  it('moves the cover between photos', () => {
    const next = setCover([media({ url: 'a', is_cover: true }), media({ url: 'b' })], 1);
    expect(next.map((m) => m.is_cover)).toEqual([false, true]);
  });

  it('treats media with no kind as a photo — revisions predating video', () => {
    expect(canBeCover({ kind: undefined })).toBe(true);
  });
});
