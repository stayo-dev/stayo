import { describe, expect, it } from 'vitest';
import { dataDeletionDocument } from './dataDeletion';
import { contactDocument } from './contact';
import { termsDocument } from './terms';
import { refundsDocument } from './refunds';

describe('Data Deletion & Retention', () => {
  const text = () => JSON.stringify(dataDeletionDocument.content);

  it('describes closure as anonymisation, matching account-closure-service', () => {
    expect(text()).toMatch(/anonymis/i);
  });

  it('drops the 30-business-day claim — closure is immediate', () => {
    expect(text()).not.toMatch(/30 business days/i);
  });

  it('names the three blockers the backend actually enforces', () => {
    expect(text()).toMatch(/outstanding|owing/i);
    expect(text()).toMatch(/move.?out/i);
    expect(text()).toMatch(/live tenancy|still live/i);
  });

  it('explains why financial records survive', () => {
    expect(text()).toMatch(/ledger|financial record/i);
  });
});

/**
 * Nothing in the code deletes an owner's data on a timer: the data-retention
 * cron is frozen and unscheduled, and would only prune logs if it ran. Terms
 * A.5 and Refunds 1.5 once promised a "window to export your data before it is
 * deleted" — a deletion that never happens. These guard against that promise
 * returning in any of the three documents that discuss it.
 */
describe('no document promises a timed deletion the code does not perform', () => {
  const docs = { dataDeletionDocument, termsDocument, refundsDocument };
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name} does not promise export "before it is deleted"`, () => {
      expect(JSON.stringify(doc.content)).not.toMatch(/before it is deleted/i);
    });
  }
});

describe('Contact & Grievance Redressal', () => {
  const text = () => JSON.stringify(contactDocument.content);

  it('publishes the entity block the e-commerce rules require', () => {
    expect(text()).toContain('Chidiri Shiva Prakash');
    expect(text()).toContain('Telangana');
  });

  it('publishes only the four serviced addresses', () => {
    for (const addr of ['support@', 'grievance@', 'privacy@', 'contact@']) {
      expect(text()).toContain(addr);
    }
    for (const unpublished of ['billing@', 'sales@', 'careers@', 'admin@', 'spchidiri']) {
      expect(text()).not.toContain(unpublished);
    }
  });

  it('states the acknowledgement and resolution windows', () => {
    expect(text()).toMatch(/48 hours|24 hours/);
    expect(text()).toMatch(/15 days|30 days|one month/i);
  });

  it('does not imply a separate support department exists', () => {
    expect(text()).not.toMatch(/our (support|customer care) (team|department) will escalate/i);
  });
});
