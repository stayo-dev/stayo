import type { AgreementDocument, DocBlock, SignaturePanel } from './agreementDocument';
import { anchorIdFor } from './documentReading';

/**
 * The agreement, rendered.
 *
 * A thin renderer with no decisions in it: ordering, numbering, interpolation
 * and which sections survive are all settled by the backend composer, so this
 * file can only get the *presentation* wrong, never the contract.
 *
 * Two deliberate choices:
 *
 * - **Semantic tokens, not the hex values the old screen hardcoded.** The step
 *   this replaces painted `#F6F1EA` and `#221E1A` directly, which meant the
 *   document ignored the theme and was unreadable in dark mode.
 * - **Platform sections look exactly like the hostel's own.** The tenant is
 *   reading one contract, not a contract plus an appendix, and visually
 *   demoting the clauses about governing law and stamp duty would misrepresent
 *   what they are agreeing to.
 *
 * Clause text is plain text and is never passed to `dangerouslySetInnerHTML` —
 * an owner types this content, and it ends up on a document people sign.
 */
export function AgreementDocumentView({ doc }: { doc: AgreementDocument }) {
  return (
    <article className="mx-auto w-full max-w-[68ch] text-foreground">
      {doc.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </article>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'title':
      return (
        <header className="mb-6 text-center">
          <h1 className="font-display text-[17px] font-extrabold tracking-[0.02em] text-foreground">
            {block.text}
          </h1>
          {block.subtitle && (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">{block.subtitle}</p>
          )}
          <div className="mt-4 h-px w-full bg-border" />
        </header>
      );

    case 'preamble':
      return (
        <p className="mb-6 text-[13.5px] leading-[1.7] text-foreground/85">{block.text}</p>
      );

    case 'facts':
      return (
        <dl className="mb-7 grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-[14px] bg-secondary px-4 py-4 sm:grid-cols-2">
          {block.rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-[12.5px] text-muted-foreground">{row.label}</dt>
              <dd className="text-right text-[13px] font-bold text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      );

    case 'section':
      return (
        <section id={anchorIdFor(block.number)} className="mb-6 scroll-mt-20">
          <h2 className="mb-2 text-[13.5px] font-extrabold leading-snug text-foreground">
            <span className="text-muted-foreground">{block.number}.</span> {block.title}
            {block.severity === 'important' && (
              <span className="ml-2 align-middle rounded-full bg-[color:var(--warning)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--warning)]">
                Key term
              </span>
            )}
          </h2>
          {block.clauses.map((clause) => (
            <p key={clause.number} className="mb-2 text-[13.5px] leading-[1.7] text-foreground/85">
              {block.clauses.length > 1 && (
                <span className="mr-1.5 font-semibold text-muted-foreground">{clause.number}</span>
              )}
              {clause.text}
            </p>
          ))}
        </section>
      );

    case 'execution':
      return (
        <p className="mb-6 mt-8 border-t border-border pt-5 text-[13px] font-semibold uppercase leading-[1.7] tracking-[0.02em] text-foreground">
          {block.text}
        </p>
      );

    case 'signatures':
      return (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {block.panels.map((panel) => (
            <SignatureBlock key={panel.role} panel={panel} />
          ))}
        </div>
      );

    case 'attestation':
      return (
        <footer className="mt-8 border-t border-dashed border-border pt-4 text-[11.5px] leading-[1.6] text-muted-foreground">
          {block.text}
        </footer>
      );
  }
}

const ROLE_LABEL: Record<SignaturePanel['role'], string> = {
  tenant: 'Resident',
  guardian: 'Parent / Guardian',
  owner: 'For the hostel',
};

function SignatureBlock({ panel }: { panel: SignaturePanel }) {
  return (
    <div className="rounded-[12px] border border-border px-3 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {ROLE_LABEL[panel.role]}
      </div>
      <div className="mt-2 flex h-11 items-end">
        {panel.signatureUrl ? (
          <img
            src={panel.signatureUrl}
            alt={`${ROLE_LABEL[panel.role]} signature`}
            className="max-h-11 max-w-full object-contain"
          />
        ) : (
          // An unsigned panel says so rather than showing an empty box, which
          // reads as a rendering fault on a document somebody is about to sign.
          <span className="text-[11.5px] italic text-muted-foreground">Not signed yet</span>
        )}
      </div>
      <div className="mt-2 border-t border-border pt-1.5 text-[12px] font-semibold text-foreground">
        {panel.name || <span className="font-normal text-muted-foreground">—</span>}
      </div>
      {panel.relation && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{panel.relation}</div>
      )}

      {/*
        The audit stamp, shown rather than hidden.

        An electronic signature is worth what its trail is worth, and the person
        signing is entitled to see exactly what is being recorded about them --
        the moment in IST, the address the request came from, and the device and
        browser used. These are the same values the PDF prints.

        Only rendered once there is a signature: a date and an IP under an
        unsigned panel would describe an event that never happened.
      */}
      {panel.signedAt && (
        <dl className="mt-2 border-t border-border/60 pt-2 text-[10.5px] leading-[1.5] text-muted-foreground">
          <div className="flex gap-1.5">
            <dt className="flex-none font-semibold">Signed</dt>
            <dd className="min-w-0 break-words">{panel.signedAt}</dd>
          </div>
          {panel.device && (
            <div className="mt-0.5 flex gap-1.5">
              <dt className="flex-none font-semibold">Device</dt>
              <dd className="min-w-0 break-words">{panel.device}</dd>
            </div>
          )}
          {panel.ip && (
            <div className="mt-0.5 flex gap-1.5">
              <dt className="flex-none font-semibold">IP</dt>
              <dd className="min-w-0 break-words">{panel.ip}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
