import { describe, it, expect } from 'vitest';
import { parseExportParams } from '@/src/services/exports/export-params';

/**
 * Every rule about what an export request may say.
 *
 * These are the rules most worth testing: a bad one hands an owner someone
 * else's data, or hands him an empty file that reads like "you have no
 * expenses". They live in a pure module precisely so they can be checked
 * without a database, which this environment does not have.
 */

const q = (s: string) => new URLSearchParams(s);

describe('document', () => {
  it('accepts exactly the three real documents', () => {
    for (const id of ['expenses', 'collections', 'finance']) {
      expect(parseExportParams(q(`document=${id}&preset=this_month`)).document).toBe(id);
    }
  });

  it('refuses a document it does not have', () => {
    // The four audience-named documents ADR-197 retired must not resolve.
    for (const old of ['accountant', 'proof_of_income', 'reconciliation', 'who_owes_me']) {
      expect(() => parseExportParams(q(`document=${old}&preset=this_month`))).toThrow(/Unknown document/);
    }
    expect(() => parseExportParams(q('preset=this_month'))).toThrow(/Unknown document/);
  });
});

describe('period', () => {
  it('resolves every preset the screens offer', () => {
    for (const preset of ['today', 'this_week', 'this_month', 'last_month', 'this_fy', 'last_fy', 'all_time']) {
      expect(parseExportParams(q(`document=expenses&preset=${preset}`)).period.label).toBeTruthy();
    }
  });

  it('gives all_time no lower bound', () => {
    expect(parseExportParams(q('document=expenses&preset=all_time')).period.from).toBeNull();
  });

  it('refuses an unknown preset rather than falling back to a default', () => {
    // A silent fallback produces a file covering a period nobody chose.
    expect(() => parseExportParams(q('document=expenses&preset=last_decade'))).toThrow(/Unknown period/);
  });

  it('refuses a reversed custom range instead of repairing it', () => {
    expect(() => parseExportParams(q('document=expenses&from=2026-09-30&to=2026-09-01')))
      .toThrow(/start date is after/);
  });

  it('refuses a request with no period at all', () => {
    expect(() => parseExportParams(q('document=expenses'))).toThrow(/Give a preset/);
  });

  it('accepts a one-sided custom range', () => {
    expect(parseExportParams(q('document=expenses&to=2026-09-12')).period.from).toBeNull();
    expect(parseExportParams(q('document=expenses&from=2026-03-01')).period.from).toBe('2026-03-01');
  });
});

describe('scope', () => {
  it('reads business as a scope, never as a hostel id', () => {
    // The Money screen's `business` option used to collapse to null on the way
    // here, which reads as EVERY hostel — the opposite of what was picked.
    const p = parseExportParams(q('document=expenses&preset=this_month&scope=business'));
    expect(p.scope).toBe('business');
    expect(p.hostelId).toBeNull();
  });

  it('never lets a view sentinel through as a hostel id', () => {
    const p = parseExportParams(q('document=expenses&preset=this_month'));
    expect(p.hostelId).toBeNull();
    expect(p.hostelId).not.toBe('all');
    expect(p.hostelId).not.toBe('business');
  });

  it('refuses a hostel and the business at once — that is a contradiction', () => {
    expect(() => parseExportParams(q('document=expenses&preset=this_month&scope=business&hostelId=h1')))
      .toThrow(/Pick a hostel or the business/);
  });

  it('refuses business scope on a document that has no such thing', () => {
    // A rent payment has no business-HQ scope; only an expense does.
    for (const doc of ['collections', 'finance']) {
      expect(() => parseExportParams(q(`document=${doc}&preset=this_month&scope=business`)))
        .toThrow(/applies to expenses only/);
    }
  });

  it('refuses a scope it does not know', () => {
    expect(() => parseExportParams(q('document=expenses&preset=this_month&scope=everything')))
      .toThrow(/Unknown scope/);
  });
});

describe('expense filters', () => {
  const full = 'document=expenses&preset=this_month&search=diesel&status=Paid&vendor=Sri%20Balaji'
    + '&paymentMethod=UPI&amountMin=100&amountMax=900&recurring=true&sort=lowest';

  it('carries every filter the screen can set', () => {
    expect(parseExportParams(q(full)).expenses).toEqual({
      search: 'diesel',
      status: 'paid',
      vendor: 'Sri Balaji',
      paymentMethod: 'UPI',
      amountMin: 100,
      amountMax: 900,
      recurring: true,
      sort: 'lowest',
    });
  });

  it("normalises the screen's status casing", () => {
    // 'Paid' against a column holding 'paid' matched nothing, with no error.
    expect(parseExportParams(q('document=expenses&preset=this_month&status=Partially%20Paid')).expenses.status)
      .toBe('partially_paid');
    expect(parseExportParams(q('document=expenses&preset=this_month&status=All%20Status')).expenses.status)
      .toBeUndefined();
  });

  it('drops expense filters on the documents they cannot apply to', () => {
    // Otherwise a stale search box could quietly narrow a collections file.
    for (const doc of ['collections', 'finance']) {
      expect(parseExportParams(q(`document=${doc}&preset=this_month&search=diesel&vendor=X`)).expenses)
        .toEqual({});
    }
  });

  it('treats an empty parameter as absent, not as a filter', () => {
    const p = parseExportParams(q('document=expenses&preset=this_month&search=&vendor=&amountMin=&status='));
    expect(p.expenses).toEqual({
      search: undefined, status: undefined, vendor: undefined, paymentMethod: undefined,
      amountMin: undefined, amountMax: undefined, recurring: undefined, sort: undefined,
    });
  });

  it('refuses a non-finite amount bound', () => {
    // `Number('') || Infinity` on the client produces exactly this.
    expect(() => parseExportParams(q('document=expenses&preset=this_month&amountMin=Infinity')))
      .toThrow(/amountMin must be a number/);
    expect(() => parseExportParams(q('document=expenses&preset=this_month&amountMax=abc')))
      .toThrow(/amountMax must be a number/);
  });

  it('reads recurring as three states, not two', () => {
    const rec = (v: string) => parseExportParams(q(`document=expenses&preset=this_month&recurring=${v}`)).expenses.recurring;
    expect(rec('true')).toBe(true);
    expect(rec('false')).toBe(false);
    // Absent means "no opinion" — it must not collapse to false, which would
    // silently exclude every recurring expense.
    expect(rec('')).toBeUndefined();
  });

  it('refuses a sort it does not know', () => {
    expect(() => parseExportParams(q('document=expenses&preset=this_month&sort=alphabetical')))
      .toThrow(/Unknown sort/);
  });
});
