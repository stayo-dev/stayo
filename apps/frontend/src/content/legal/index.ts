import type { LegalDocument } from './types';
import { termsDocument } from './terms';
import { privacyDocument } from './privacy';
import { refundsDocument } from './refunds';
import { cookiesDocument } from './cookies';
import { serviceDeliveryDocument } from './serviceDelivery';
import { dataDeletionDocument } from './dataDeletion';
import { contactDocument } from './contact';

/**
 * Every published legal document, in the order the hub lists them.
 *
 * This is the single registry: routes, footer links and the invariant script
 * all derive from it, so adding a document cannot leave a dangling link or an
 * unrendered route.
 */
export const legalDocuments: LegalDocument[] = [
  termsDocument,
  privacyDocument,
  refundsDocument,
  cookiesDocument,
  serviceDeliveryDocument,
  dataDeletionDocument,
  contactDocument,
];

export * from './types';
export * from './documentHelpers';
