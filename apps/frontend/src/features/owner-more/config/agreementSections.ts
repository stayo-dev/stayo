/**
 * The agreement section, reduced to what is actually there.
 *
 * It listed seven rows across four headings. Three of them were not real:
 *
 * - **Dynamic variables** pointed at `/agreements/variables`, which was never
 *   a route — a dead link presented as "3 of 8 auto-filled fields in use".
 * - **Highlights** opened the clause library, the same screen as the row
 *   directly above it.
 * - **Version history** opened the templates screen, the same screen as the
 *   row two above it.
 *
 * A fourth, **Signatures**, opened the hostel identity page — where an owner
 * uploads their *logo*. The agreement signature is a different thing, with its
 * own endpoint and its own column (`owner_signature_url`), and the only place
 * that ever wrote it was the Add Hostel builder's agreement step. An owner
 * could therefore set it once while creating a hostel and never change it
 * again. It now has a screen of its own.
 *
 * What remains is four rows that each open something different and real.
 *
 * The Agreement row opens the editor rather than the read-only list it used
 * to: every operation the editor needs — save draft, publish, reset a section
 * — already existed on the backend and none was wired, so an owner could read
 * their agreement and change nothing in it.
 */

export interface AgreementRow {
  key: string;
  label: string;
  hint: string;
  route: string;
  /** Live figure for this row, e.g. "1 template · v3". */
  detail?: string;
}

export interface AgreementSectionsInput {
  hostelId?: string | null;
  templateCount: number;
  /** Highest published version, 0 when nothing is published. */
  version: number;
  clauseCount: number;
  agreementRequired: boolean;
  hasSignature: boolean;
}

const BASE = '/owner/more/configuration/agreements';

function scoped(route: string, hostelId?: string | null): string {
  return hostelId ? `${route}?hostelId=${encodeURIComponent(hostelId)}` : route;
}

export function agreementRows(input: AgreementSectionsInput): AgreementRow[] {
  const { hostelId, templateCount, version, clauseCount, agreementRequired, hasSignature } = input;

  return [
    {
      key: 'requirement',
      label: 'Signing',
      hint: 'Whether a tenant must sign before they can move in',
      detail: agreementRequired ? 'Required before activation' : 'Not required',
      route: scoped(`${BASE}/requirement`, hostelId),
    },
    {
      key: 'template',
      label: 'Agreement',
      hint: 'The document itself, and every published version of it',
      // Version history was its own row opening this same screen. It is a
      // property of the document, not a separate place to go.
      detail:
        templateCount === 0
          ? 'Not written yet'
          : version > 0
            ? `${templateCount} document · v${version}`
            : `${templateCount} document · draft`,
      route: scoped(`${BASE}/edit`, hostelId),
    },
    {
      key: 'clauses',
      label: 'Clauses',
      hint: 'The terms your agreement is built from',
      detail: clauseCount > 0 ? `${clauseCount} clauses` : 'None yet',
      route: scoped(`${BASE}/clauses`, hostelId),
    },
    {
      key: 'signature',
      label: 'Your signature',
      hint: 'Signed onto every agreement on your behalf',
      detail: hasSignature ? 'Added' : 'Not added — agreements go out unsigned',
      route: scoped(`${BASE}/signature`, hostelId),
    },
  ];
}
