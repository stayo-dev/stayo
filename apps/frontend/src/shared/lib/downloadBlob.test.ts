import { describe, it, expect } from 'vitest';
import { filenameFromContentDisposition } from './downloadBlob';

/**
 * Three api modules each had their own slightly different version of this
 * regex. The differences were invisible until a header came back in a shape
 * one of them did not expect and the owner got a file called "undefined".
 */
describe('filenameFromContentDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="expenses-2026-09.xlsx"', 'fallback'))
      .toBe('expenses-2026-09.xlsx');
  });

  it('reads an unquoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=report.xlsx', 'fallback'))
      .toBe('report.xlsx');
  });

  it('keeps a space inside a quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="rent collections.xlsx"', 'fallback'))
      .toBe('rent collections.xlsx');
  });

  it('falls back when the header is missing, empty or has no filename', () => {
    expect(filenameFromContentDisposition(undefined, 'stayo-export.xlsx')).toBe('stayo-export.xlsx');
    expect(filenameFromContentDisposition(null, 'stayo-export.xlsx')).toBe('stayo-export.xlsx');
    expect(filenameFromContentDisposition('', 'stayo-export.xlsx')).toBe('stayo-export.xlsx');
    expect(filenameFromContentDisposition('attachment', 'stayo-export.xlsx')).toBe('stayo-export.xlsx');
  });

  it('falls back rather than handing over a percent-encoded blob of a name', () => {
    // RFC 5987 `filename*` is not decoded here; a readable fallback beats
    // saving a file literally named "UTF-8''rent%20collections.xlsx".
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''rent%20collections.xlsx", 'stayo-export.xlsx'))
      .toBe('stayo-export.xlsx');
  });
});
