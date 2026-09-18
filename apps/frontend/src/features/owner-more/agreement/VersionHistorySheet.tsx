import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, History, X } from 'lucide-react';
import { AgreementDocumentView } from '@features/agreements/document/AgreementDocumentView';
import type { RulesContent } from '../config/agreements';
import {
  canRestore,
  publishedLabel,
  restoreConfirmation,
  signedLabel,
  type AgreementVersion,
} from './versionHistory';
import {
  fetchAgreementVersionContent,
  fetchAgreementVersions,
  fetchOwnerAgreementDocument,
  ownerAgreementKeys,
} from './ownerAgreementApi';

/**
 * Every version of the agreement that was ever live.
 *
 * ## Why this exists at all
 *
 * Publishing has always archived the outgoing version rather than deleting it,
 * and `Agreement.template_id` pins each signed agreement to the row it was
 * signed under — so a complete history was stored from the beginning and shown
 * nowhere. An owner could reword a legal document with no way to see what it
 * used to say, let alone go back.
 *
 * ## Why it is a sheet, and why it has two levels
 *
 * A third segment beside Write/Read would have broken the two-pane desktop
 * layout for a screen most owners open rarely. A sheet leaves that alone and
 * matches `PublishReviewSheet`, the one modal this feature already has.
 *
 * The levels are list → document, never both at once: a scrolling list holding
 * a scrolling document inside a scrolling sheet is three nested scroll
 * containers on a phone, and the inner one is unreachable in practice.
 *
 * ## Why the live version has no action
 *
 * The same rule the section controls follow — an action that cannot do
 * anything is absent rather than present and refusing. "Use this wording
 * again" on the version already in use is a button whose success state is
 * indistinguishable from doing nothing.
 */
export function VersionHistorySheet({
  hostelId,
  liveVersionNumber,
  hasDraftEdits,
  onClose,
  onUseVersion,
}: {
  hostelId: string;
  liveVersionNumber: number | null;
  /** Whether loading a version would discard work in progress. */
  hasDraftEdits: boolean;
  onClose: () => void;
  onUseVersion: (content: RulesContent) => void;
}) {
  const [openVersion, setOpenVersion] = useState<AgreementVersion | null>(null);
  const [confirming, setConfirming] = useState<AgreementVersion | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: versions, isLoading } = useQuery({
    queryKey: ownerAgreementKeys.versions(hostelId),
    queryFn: () => fetchAgreementVersions(hostelId),
  });

  const use = async (version: AgreementVersion) => {
    setLoadingId(version.id);
    try {
      const content = await fetchAgreementVersionContent(hostelId, version.id);
      if (content) onUseVersion(content);
    } finally {
      setLoadingId(null);
      setConfirming(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-[22px] bg-card sm:max-w-[560px] sm:rounded-[22px]">
        <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
          {openVersion ? (
            <button
              type="button"
              onClick={() => setOpenVersion(null)}
              aria-label="Back to all versions"
              className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
              <History className="h-4 w-4" strokeWidth={2} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[16px] font-extrabold text-foreground">
              {openVersion ? `Version ${openVersion.version_number}` : 'Version history'}
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              {openVersion
                ? [publishedLabel(openVersion.published_at), signedLabel(openVersion.agreements_count)]
                    .filter(Boolean)
                    .join(' · ')
                : 'Every version you have published. Nothing here is ever deleted.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-muted-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {openVersion ? (
            <VersionDocument hostelId={hostelId} version={openVersion} />
          ) : isLoading ? (
            <div className="flex flex-col gap-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-[16px] bg-muted" />
              ))}
            </div>
          ) : (versions ?? []).length === 0 ? (
            /* A promise rather than a blank screen: history starts existing
               the first time they publish, and saying so is the point. */
            <p className="py-8 text-center text-[12.5px] leading-relaxed text-muted-foreground">
              You have not published an agreement yet.
              <br />
              Once you do, every version you publish is kept here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {(versions ?? []).map((version) => (
                <li key={version.id}>
                  <VersionCard
                    version={version}
                    busy={loadingId === version.id}
                    onOpen={() => setOpenVersion(version)}
                    onUse={() => setConfirming(version)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The document view gets its own action bar, so an owner who has read
            a version can act on it without going back to the list to find it. */}
        {openVersion && canRestore(openVersion) && (
          <div className="border-t border-border/60 px-5 pt-3 pb-[calc(0.9rem+env(safe-area-inset-bottom,0px))]">
            <button
              type="button"
              disabled={loadingId === openVersion.id}
              onClick={() => setConfirming(openVersion)}
              className="w-full rounded-[13px] bg-primary py-3 text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Use this wording again
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <RestoreConfirm
          version={confirming}
          hasDraftEdits={hasDraftEdits}
          liveVersionNumber={liveVersionNumber}
          busy={loadingId === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={() => use(confirming)}
        />
      )}
    </div>
  );
}

function VersionCard({
  version,
  busy,
  onOpen,
  onUse,
}: {
  version: AgreementVersion;
  busy: boolean;
  onOpen: () => void;
  onUse: () => void;
}) {
  const live = version.is_live;
  return (
    <div
      className={`rounded-[16px] border bg-card p-3.5 ${
        live ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'
      }`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-2">
          <span className="font-display text-[14px] font-bold text-foreground">
            Version {version.version_number}
          </span>
          {live && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-primary-foreground">
              Live now
            </span>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          {[publishedLabel(version.published_at), signedLabel(version.agreements_count)]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {/* Recognition over recall: nobody remembers what "v2" was. */}
        <div className="mt-1.5 text-[12px] font-medium text-foreground/75">{version.change_summary}</div>
      </button>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-full border border-border px-3 py-1.5 text-[11.5px] font-semibold text-foreground/80"
        >
          Read it
        </button>
        {canRestore(version) && (
          <button
            type="button"
            disabled={busy}
            onClick={onUse}
            className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11.5px] font-semibold text-primary disabled:opacity-50"
          >
            {busy ? 'Loading…' : 'Use this wording'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A past version as the real composed document.
 *
 * Through the same endpoint and the same view the Read pane uses, rather than
 * an approximation rendered from `rules_content`: the editor's old private
 * preview omitted the preamble, the standard legal clauses, the execution
 * statement and the signature block, and an owner comparing versions must not
 * be comparing two summaries of them.
 */
function VersionDocument({ hostelId, version }: { hostelId: string; version: AgreementVersion }) {
  const { data: content } = useQuery({
    queryKey: ownerAgreementKeys.versionContent(hostelId, version.id),
    queryFn: () => fetchAgreementVersionContent(hostelId, version.id),
  });

  const { data: document } = useQuery({
    queryKey: ownerAgreementKeys.document(hostelId, `version:${version.id}`),
    queryFn: () => fetchOwnerAgreementDocument(hostelId, content ?? null, version.version_number),
    enabled: Boolean(content),
  });

  if (!document) return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  return <AgreementDocumentView doc={document} />;
}

/**
 * The confirmation before an old version's wording is brought back.
 *
 * Its copy comes from `restoreConfirmation`, where the ordering is the
 * decision: the reassurances land before the cost, because an owner reverting
 * a legal document is asking what it breaks and the honest answer is nothing
 * that has been signed.
 */
function RestoreConfirm({
  version,
  hasDraftEdits,
  liveVersionNumber,
  busy,
  onCancel,
  onConfirm,
}: {
  version: AgreementVersion;
  hasDraftEdits: boolean;
  liveVersionNumber: number | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = restoreConfirmation({ versionNumber: version.version_number, hasDraftEdits });
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pb-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full rounded-[20px] bg-card p-5 sm:max-w-[420px]">
        <h3 className="font-display text-[15.5px] font-extrabold text-foreground">{copy.title}</h3>
        <div className="mt-2 flex flex-col gap-1.5">
          {copy.lines.map((line) => (
            <p key={line} className="text-[12.5px] leading-relaxed text-muted-foreground">
              {line}
            </p>
          ))}
        </div>

        {liveVersionNumber !== null && (
          <p className="mt-3 rounded-xl bg-secondary/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-foreground/75">
            Publishing afterwards makes this the wording new tenants sign, as version{' '}
            {liveVersionNumber + 1}. Version {version.version_number} stays in your history.
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[13px] border border-border px-4 py-3 text-[13px] font-semibold text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-primary py-3 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {!busy && <Check className="h-4 w-4" strokeWidth={2.4} />}
            {busy ? 'Loading…' : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
