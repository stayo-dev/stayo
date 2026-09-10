import type { LegalDocument } from './types';
import { termsDocument } from './terms';
import { privacyDocument } from './privacy';

/**
 * Every published legal document, in the order the hub lists them.
 *
 * This is the single registry: routes, footer links and the invariant script
 * all derive from it, so adding a document cannot leave a dangling link or an
 * unrendered route. Tasks 5-7 append here.
 */
export const legalDocuments: LegalDocument[] = [termsDocument, privacyDocument];

export * from './types';
export * from './documentHelpers';
