/**
 * Shared vocabulary for a configuration setting row, and the counting rules
 * behind the "N areas configured / N need attention" cards.
 *
 * Pure and I/O-free: `apps/frontend`'s test suite is node-environment with no
 * jsdom (see vitest.config.ts), so anything that must be got right lives here
 * as functions and the components stay thin renderers over it.
 */

export type ConfigRowState =
  /** Set up and doing something. */
  | 'configured'
  /** A genuine gap — missing required data, or an enabled feature with no value. */
  | 'attention'
  /** Deliberately switched off. Not a gap; never nag about it. */
  | 'off'
  /** The subsystem behind this row does not exist yet. Rendered, but inert. */
  | 'unavailable';

export interface ConfigRow {
  key: string;
  title: string;
  /** The sub-line: what this is currently set to, in the owner's words. */
  detail: string;
  state: ConfigRowState;
  route?: string;
}

export interface ConfigAreaTally {
  configured: number;
  attention: number;
}

/**
 * `off` and `unavailable` count toward neither total, by design — see
 * configRows.test.ts for why. An `unavailable` row must not be able to move
 * either number, or the progress ring starts reporting on features that do
 * not exist.
 */
export function tallyConfigRows(rows: ConfigRow[]): ConfigAreaTally {
  return {
    configured: rows.filter((r) => r.state === 'configured').length,
    attention: rows.filter((r) => r.state === 'attention').length,
  };
}

/** An unavailable row never navigates, whatever route it carries. */
export function isRowInteractive(row: ConfigRow): boolean {
  return row.state !== 'unavailable' && Boolean(row.route);
}

/** Label shown in place of a detail line for rows whose subsystem is not built. */
export const UNAVAILABLE_LABEL = 'Not available yet';
