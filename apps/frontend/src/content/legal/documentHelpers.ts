import type { Anchor, LegalDocument } from './types';

/** Section and clause anchors, in document order — the table of contents. */
export function documentAnchors(doc: LegalDocument): Anchor[] {
  const anchors: Anchor[] = [];
  for (const block of doc.content) {
    if (block.type === 'subheading') {
      anchors.push({ id: block.id, text: block.text, level: 'section' });
    } else if (block.type === 'clause') {
      anchors.push({ id: block.id, text: block.number, level: 'clause' });
    }
  }
  return anchors;
}

function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Which document a URL is asking for, canonical route or alias.
 *
 * Replaces the hand-written if/else chain the previous LegalPage carried: that
 * chain and the route table were edited separately, so a route could exist
 * with nothing rendering it.
 */
export function documentIdForPath(pathname: string, docs: LegalDocument[]): string | null {
  const path = normalise(pathname);
  for (const doc of docs) {
    if (doc.route === path || doc.aliases.includes(path)) return doc.id;
  }
  return null;
}

/** Every path that must resolve — canonical routes first, then aliases. */
export function allRoutes(docs: LegalDocument[]): string[] {
  return docs.flatMap((doc) => [doc.route, ...doc.aliases]);
}

/**
 * Structural rules a published registry must satisfy. Returns failures rather
 * than throwing, so the test can assert on all of them at once.
 */
export function validateRegistry(docs: LegalDocument[]): string[] {
  const failures: string[] = [];
  const seenRoutes = new Map<string, string>();

  for (const doc of docs) {
    if (!doc.version) failures.push(`${doc.id}: missing version`);
    if (!doc.effectiveDate) failures.push(`${doc.id}: missing effectiveDate`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.effectiveDate)) {
      failures.push(`${doc.id}: effectiveDate must be ISO yyyy-mm-dd`);
    }
    if (!doc.summary.length) failures.push(`${doc.id}: missing summary`);
    if (!doc.metaDescription) failures.push(`${doc.id}: missing metaDescription`);
    if (!doc.content.length) failures.push(`${doc.id}: empty content`);

    for (const route of [doc.route, ...doc.aliases]) {
      const owner = seenRoutes.get(route);
      if (owner && owner !== doc.id) failures.push(`${route}: claimed by more than one document`);
      seenRoutes.set(route, doc.id);
    }

    const seenAnchors = new Set<string>();
    for (const anchor of documentAnchors(doc)) {
      if (seenAnchors.has(anchor.id)) failures.push(`${doc.id}: duplicate anchor id "${anchor.id}"`);
      seenAnchors.add(anchor.id);
    }
  }

  return failures;
}
