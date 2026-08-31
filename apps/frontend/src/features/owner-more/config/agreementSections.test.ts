import { describe, it, expect } from 'vitest';
import { agreementRows } from './agreementSections';

const input = (over: Partial<Parameters<typeof agreementRows>[0]> = {}) => ({
  hostelId: 'h-1',
  templateCount: 1,
  version: 3,
  clauseCount: 28,
  agreementRequired: true,
  hasSignature: true,
  ...over,
});

describe('agreementRows', () => {
  it('lists four rows that each open something different', () => {
    // It listed seven. Three opened a screen another row already opened, or a
    // route that did not exist.
    const rows = agreementRows(input());
    expect(rows.map((r) => r.key)).toEqual(['requirement', 'template', 'clauses', 'signature']);
    const destinations = rows.map((r) => r.route.split('?')[0]);
    expect(new Set(destinations).size).toBe(rows.length);
  });

  it('drops the rows that were never real', () => {
    const keys = agreementRows(input()).map((r) => r.key);
    // `variables` pointed at a route that was never registered; `highlights`
    // and `version-history` opened screens other rows already opened.
    expect(keys).not.toContain('variables');
    expect(keys).not.toContain('highlights');
    expect(keys).not.toContain('version-history');
  });

  it('opens the editor, not the read-only list', () => {
    // Every operation the editor needs already existed on the backend and none
    // was wired: an owner could read the agreement and change nothing in it.
    expect(agreementRows(input()).find((r) => r.key === 'template')?.route.split('?')[0])
      .toBe('/owner/more/configuration/agreements/edit');
  });

  it('folds the version into the document row rather than giving it its own', () => {
    expect(agreementRows(input()).find((r) => r.key === 'template')?.detail).toBe('1 document · v3');
  });

  it('says a document is a draft until something is published', () => {
    expect(agreementRows(input({ version: 0 })).find((r) => r.key === 'template')?.detail)
      .toBe('1 document · draft');
  });

  it('says when no agreement has been written at all', () => {
    expect(agreementRows(input({ templateCount: 0, version: 0 })).find((r) => r.key === 'template')?.detail)
      .toBe('Not written yet');
  });

  it('names the consequence when no signature is on file', () => {
    // "Not set" describes a field. This describes what goes out to a tenant.
    expect(agreementRows(input({ hasSignature: false })).find((r) => r.key === 'signature')?.detail)
      .toBe('Not added — agreements go out unsigned');
  });

  it('sends the signature row to its own screen, not to hostel identity', () => {
    // The old row opened the page where an owner uploads their *logo*.
    const row = agreementRows(input()).find((r) => r.key === 'signature');
    expect(row?.route.split('?')[0]).toBe('/owner/more/configuration/agreements/signature');
  });

  it('tells every screen which hostel it is editing', () => {
    for (const row of agreementRows(input())) {
      expect(row.route).toContain('hostelId=h-1');
    }
  });

  it('omits the hostel query when there is no hostel to name', () => {
    for (const row of agreementRows(input({ hostelId: null }))) {
      expect(row.route).not.toContain('hostelId');
    }
  });

  it('says plainly whether signing is required', () => {
    expect(agreementRows(input()).find((r) => r.key === 'requirement')?.detail)
      .toBe('Required before activation');
    expect(agreementRows(input({ agreementRequired: false })).find((r) => r.key === 'requirement')?.detail)
      .toBe('Not required');
  });
});
