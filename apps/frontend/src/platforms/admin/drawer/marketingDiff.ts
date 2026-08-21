import type { MarketingContent, MarketingPhoto } from '@features/hostel-marketing/api';

/**
 * What changed between the live listing and the version awaiting review.
 *
 * A reviewer was being handed a whole listing and asked to approve it, with no
 * indication of which part the owner had actually touched — so a one-word
 * tagline fix and a rewritten price table looked identical, and the only way
 * to tell them apart was to remember what the listing said last week. Nobody
 * remembers. This is what turns "read all of it again" into "check this one
 * line".
 *
 * PURE — runs under vitest's node environment.
 */

export type DiffSection = 'basics' | 'photos' | 'beds' | 'amenities' | 'places' | 'mess';

export interface DiffLine {
  /** What changed, in words a reviewer reads rather than a field path. */
  label: string;
  before?: string | null;
  after?: string | null;
}

export interface SectionDiff {
  section: DiffSection;
  label: string;
  lines: DiffLine[];
}

export interface ContentDiff {
  /** True when there is nothing live yet — every part is new, not changed. */
  isFirstSubmission: boolean;
  sections: SectionDiff[];
  /** Total changed lines, for the header count. */
  changeCount: number;
}

export const DIFF_SECTION_LABEL: Record<DiffSection, string> = {
  basics: 'Basics',
  photos: 'Photos & videos',
  beds: 'Bed types',
  amenities: 'Amenities',
  places: 'Getting around',
  mess: 'Mess menu',
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MEAL_NAMES: Record<string, string> = { b: 'Breakfast', l: 'Lunch', s: 'Snacks', dn: 'Dinner' };

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function rupees(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

function mediaKey(photo: MarketingPhoto): string {
  return photo.url;
}

function diffBasics(before: MarketingContent | null, after: MarketingContent): DiffLine[] {
  const lines: DiffLine[] = [];
  const was = before?.basics;
  const now = after.basics;

  if (text(was?.tagline) !== text(now.tagline)) {
    lines.push({ label: 'Tagline', before: text(was?.tagline) || null, after: text(now.tagline) || null });
  }
  if (text(was?.about) !== text(now.about)) {
    lines.push({ label: 'About', before: text(was?.about) || null, after: text(now.about) || null });
  }

  const wasHighlights = (was?.highlights ?? []).join(' · ');
  const nowHighlights = now.highlights.join(' · ');
  if (wasHighlights !== nowHighlights) {
    lines.push({ label: 'Highlights', before: wasHighlights || null, after: nowHighlights || null });
  }
  return lines;
}

function diffPhotos(before: MarketingContent | null, after: MarketingContent): DiffLine[] {
  const lines: DiffLine[] = [];
  const was = before?.photos ?? [];
  const now = after.photos;

  const wasKeys = was.map(mediaKey);
  const nowKeys = now.map(mediaKey);
  const added = now.filter((photo) => !wasKeys.includes(mediaKey(photo)));
  const removed = was.filter((photo) => !nowKeys.includes(mediaKey(photo)));

  const describe = (items: MarketingPhoto[]) => {
    const videos = items.filter((item) => item.kind === 'video').length;
    const photos = items.length - videos;
    return [photos ? `${photos} photo${photos > 1 ? 's' : ''}` : '', videos ? `${videos} video${videos > 1 ? 's' : ''}` : '']
      .filter(Boolean)
      .join(' and ');
  };

  if (added.length > 0) lines.push({ label: 'Added', after: describe(added) });
  if (removed.length > 0) lines.push({ label: 'Removed', before: describe(removed) });

  const wasCover = was.find((photo) => photo.is_cover)?.url;
  const nowCover = now.find((photo) => photo.is_cover)?.url;
  if (before && wasCover !== nowCover) {
    // Named, not shown: the cover is what every search card and shared link
    // uses, so a quiet change to it is the one most worth flagging.
    lines.push({ label: 'Cover photo', before: 'changed', after: 'a different photo' });
  }

  // Only worth reporting when the set is otherwise identical — otherwise
  // "reordered" is just noise on top of an add or a delete.
  if (added.length === 0 && removed.length === 0 && wasKeys.join('|') !== nowKeys.join('|')) {
    lines.push({ label: 'Order', after: 'rearranged' });
  }

  const wasCaptions = was.map((photo) => `${photo.url}:${text(photo.label)}`).join('|');
  const nowCaptions = now.map((photo) => `${photo.url}:${text(photo.label)}`).join('|');
  if (before && added.length === 0 && removed.length === 0 && wasCaptions !== nowCaptions) {
    lines.push({ label: 'Captions', after: 'edited' });
  }

  return lines;
}

function diffBeds(before: MarketingContent | null, after: MarketingContent): DiffLine[] {
  const lines: DiffLine[] = [];
  const was = before?.beds ?? [];
  const now = after.beds;

  for (const bed of now) {
    const previous = was.find((item) => item.name === bed.name);
    if (!previous) {
      lines.push({ label: `Added "${bed.name}"`, after: `${bed.sharing}-bed · ${rupees(bed.price)}/mo` });
      continue;
    }
    // Price is the claim a tenant acts on, so it is called out by itself
    // rather than folded into "this tier changed".
    if (previous.price !== bed.price) {
      lines.push({ label: `${bed.name} price`, before: `${rupees(previous.price)}/mo`, after: `${rupees(bed.price)}/mo` });
    }
    if (previous.sharing !== bed.sharing) {
      lines.push({ label: `${bed.name} sharing`, before: `${previous.sharing}-bed`, after: `${bed.sharing}-bed` });
    }
    if (text(previous.inclusions) !== text(bed.inclusions)) {
      lines.push({ label: `${bed.name} inclusions`, before: text(previous.inclusions) || null, after: text(bed.inclusions) || null });
    }
    if (previous.availability !== bed.availability) {
      lines.push({ label: `${bed.name} availability`, before: previous.availability, after: bed.availability });
    }
  }

  for (const bed of was) {
    if (!now.some((item) => item.name === bed.name)) {
      lines.push({ label: `Removed "${bed.name}"`, before: `${bed.sharing}-bed · ${rupees(bed.price)}/mo` });
    }
  }

  return lines;
}

function diffAmenities(before: MarketingContent | null, after: MarketingContent): DiffLine[] {
  const enabled = (content: MarketingContent | null) =>
    (content?.amenities ?? []).filter((amenity) => amenity.enabled).map((amenity) => amenity.label);

  const was = enabled(before);
  const now = enabled(after);
  const added = now.filter((label) => !was.includes(label));
  const removed = was.filter((label) => !now.includes(label));

  const lines: DiffLine[] = [];
  if (added.length > 0) lines.push({ label: 'Added', after: added.join(', ') });
  if (removed.length > 0) lines.push({ label: 'Removed', before: removed.join(', ') });
  return lines;
}

function diffPlaces(before: MarketingContent | null, after: MarketingContent): DiffLine[] {
  const lines: DiffLine[] = [];
  const was = before?.places ?? [];
  const now = after.places;

  for (const place of now) {
    const previous = was.find((item) => item.name === place.name);
    if (!previous) {
      lines.push({ label: `Added "${place.name}"`, after: place.distance });
    } else if (previous.distance !== place.distance) {
      lines.push({ label: place.name, before: previous.distance, after: place.distance });
    }
  }
  for (const place of was) {
    if (!now.some((item) => item.name === place.name)) lines.push({ label: `Removed "${place.name}"`, before: place.distance });
  }
  return lines;
}

function diffMess(before: MarketingContent | null, after: MarketingContent): DiffLine[] {
  const lines: DiffLine[] = [];
  const was = before?.mess;
  const now = after.mess;

  if (Boolean(was?.provided) !== now.provided) {
    lines.push({ label: 'Meals provided', before: was?.provided ? 'yes' : 'no', after: now.provided ? 'yes' : 'no' });
  }
  if (was && was.type !== now.type) {
    lines.push({ label: 'Menu type', before: was.type, after: now.type });
  }

  for (const meal of now.meals) {
    const previous = was?.meals.find((item) => item.key === meal.key);
    if (!previous) continue;
    if (previous.enabled !== meal.enabled) {
      lines.push({ label: `${meal.label} served`, before: previous.enabled ? 'yes' : 'no', after: meal.enabled ? 'yes' : 'no' });
    }
    if (text(previous.time) !== text(meal.time)) {
      lines.push({ label: `${meal.label} time`, before: text(previous.time) || null, after: text(meal.time) || null });
    }
  }

  // The week is indexed positionally by both surfaces, so a changed day is
  // reported by name rather than by index.
  const changedDays: string[] = [];
  now.week.forEach((day, index) => {
    const previous = was?.week[index];
    if (!previous) return;
    const mealsChanged = (Object.keys(MEAL_NAMES) as (keyof typeof day)[]).some(
      (key) => text(previous[key] as string) !== text(day[key] as string),
    );
    if (mealsChanged) changedDays.push(DAY_NAMES[index] ?? `Day ${index + 1}`);
  });
  if (changedDays.length > 0) lines.push({ label: 'Menu edited', after: changedDays.join(', ') });

  return lines;
}

export function diffMarketingContent(
  before: MarketingContent | null,
  after: MarketingContent,
): ContentDiff {
  const sections: SectionDiff[] = [];
  const build = (section: DiffSection, lines: DiffLine[]) => {
    if (lines.length > 0) sections.push({ section, label: DIFF_SECTION_LABEL[section], lines });
  };

  build('basics', diffBasics(before, after));
  build('photos', diffPhotos(before, after));
  build('beds', diffBeds(before, after));
  build('amenities', diffAmenities(before, after));
  build('places', diffPlaces(before, after));
  build('mess', diffMess(before, after));

  return {
    isFirstSubmission: before === null,
    sections,
    changeCount: sections.reduce((total, section) => total + section.lines.length, 0),
  };
}
