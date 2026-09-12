import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Eye, FileText, Loader2, Upload } from 'lucide-react';

import { useAuth } from '@context/AuthContext';
import { hasLiveTenancy } from '@/app/nav/useAppNav';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { useVaultDocuments } from '@features/profile/hooks/useProfileIdentity';
import { DocumentPreviewSheet } from '@features/owner-tenants/profile/DocumentPreviewSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';

import { C, FONT } from './discoverTheme';

const dateLabel = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** The owner's most recent message from a rejected document's thread. */
function latestRejectionReason(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.trim();
  if (!text.startsWith('[')) return text;
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return null;
    const owner = [...arr].reverse().find((m) => m && m.sender === 'owner' && m.message);
    return owner?.message ?? null;
  } catch {
    return null;
  }
}

/**
 * Documents, split into two genuinely different systems rather than
 * unified (that would be real backend work, out of scope for this
 * restructure):
 *
 * - **Your document vault** (`profile_identity`'s `VaultDocument`, ADR-074)
 *   — portable, hostel-independent, always shown.
 * - **This hostel's verification documents** (per-tenancy KYC, owner
 *   verification workflow) — only relevant with a live tenancy, carried
 *   over unchanged from the old `TenantProfilePage`'s Documents section.
 *
 * Every row opens. This screen used to list documents the tenant had uploaded
 * with no way to look at any of them — the owner could open a resident's
 * Aadhaar from the Documents tab, and the resident who uploaded it could not.
 * `DocumentPreviewSheet` is the same viewer that side uses (it already
 * distinguishes our auth-guarded `download_url` from a raw vault URL, and the
 * download route authorises a tenant for their own documents).
 */
export function ProfileDocumentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const liveTenancy = hasLiveTenancy(user);
  const vault = useVaultDocuments();
  const tenantProfile = useTenantProfile();
  const [preview, setPreview] = useState<{ title: string; url: string; fileName: string } | null>(null);

  useEffect(() => {
    document.title = 'Documents — Stayo';
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col lg:min-h-0">
      {/*
        The console topbar already carries "Documents" at lg+
        (`appHeaders.ts`'s `/profile/documents` entry) — this back+title row
        is mobile-only chrome from when this page had no shell around it.
      */}
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))] lg:hidden"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/profile')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: 'var(--muted-foreground)' }} />
        </button>
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Documents
        </h1>
      </header>

      <main className="flex-1 space-y-6 px-5 py-5 lg:mx-auto lg:w-full lg:max-w-[640px] lg:px-0 lg:pt-8">
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Your document vault
          </h2>
          <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: C.line }}>
            {vault.isLoading && <div className="p-4 text-[12.5px]" style={{ color: C.textMuted }}>Loading…</div>}
            {!vault.isLoading && (vault.data ?? []).length === 0 && (
              <div className="p-4 text-[12.5px]" style={{ color: C.textMuted }}>No documents in your vault yet.</div>
            )}
            {(vault.data ?? []).map((d, i) => {
              const docLabel = tenantProfile.docLabel[d.doc_type] ?? d.doc_type;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setPreview({ title: docLabel, url: d.file_url, fileName: d.doc_type.toLowerCase() })}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.lineSoft}` }}
                >
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7', color: C.clay }}>
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{docLabel}</div>
                    {/* `created_at` — a vault document has no `uploaded_at`, so
                        this row printed an em-dash for every document. */}
                    <div className="mt-0.5 text-[11.5px]" style={{ color: C.textFaint }}>{dateLabel(d.created_at)}</div>
                  </div>
                  <Eye className="h-4 w-4 flex-none" style={{ color: C.textFaint }} strokeWidth={1.9} />
                </button>
              );
            })}
          </div>
        </section>

        {liveTenancy && (
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
                This hostel's verification documents
              </h2>
              {tenantProfile.missingDocuments.length > 0 && (
                <span className="text-[11px] font-semibold" style={{ color: C.amber }}>{tenantProfile.missingDocuments.length} pending</span>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border bg-white divide-y" style={{ borderColor: C.line }}>
              {tenantProfile.documents.map((d: any) => {
                const isAgreement = d.doc_type === 'RENTAL_AGREEMENT';
                const verified = isAgreement || d.document_status === 'VERIFIED' || d.is_verified;
                const rejected = !isAgreement && d.document_status === 'REJECTED';
                const label = isAgreement ? 'Signed' : verified ? 'Verified' : rejected ? 'Rejected' : 'Pending';
                const docLabel = d.doc_type_label ?? tenantProfile.docLabel[d.doc_type] ?? d.doc_type;

                const openPreview = () =>
                  d.download_url &&
                  setPreview({ title: docLabel, url: String(d.download_url), fileName: String(d.doc_type).toLowerCase() });

                // A rejected document is the tenant's to fix. The row used to
                // be one big <label> wrapping the file input, which left no
                // room to *look* at what was rejected — the one thing that
                // makes the owner's reason make sense. The text opens it; the
                // pill still re-uploads.
                if (rejected) {
                  const reason = latestRejectionReason(d.rejection_reason);
                  return (
                    <div key={d.id} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                      <button type="button" onClick={openPreview} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F7E4DF', color: '#B3402F' }}>
                          {tenantProfile.isUploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{docLabel}</span>
                          <span className="mt-0.5 block text-[11.5px]" style={{ color: '#B3402F' }}>
                            Rejected{reason ? ` — ${reason}` : ''}
                          </span>
                        </span>
                      </button>
                      <label className="flex flex-none cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: '#F7E4DF', color: '#B3402F' }}>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          className="hidden"
                          disabled={tenantProfile.isUploadingDocument}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            tenantProfile
                              .uploadDocument({ docType: d.doc_type, file })
                              .then(() => stayoToast.success(`${docLabel} re-uploaded`))
                              .catch(() => stayoToast.error('Could not upload — please try again'));
                          }}
                        />
                        <Upload className="h-3 w-3" /> Upload again
                      </label>
                    </div>
                  );
                }

                return (
                  <button key={d.id} type="button" onClick={openPreview} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                    <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7', color: C.clay }}>
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{docLabel}</div>
                      <div className="mt-0.5 text-[11.5px]" style={{ color: C.textFaint }}>{label} · {dateLabel(d.uploaded_at ?? d.created_at)}</div>
                    </div>
                    <span
                      className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                      style={{
                        background: verified ? '#EAF3EE' : '#FBF1DE',
                        color: verified ? C.green : C.amber,
                      }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
              {tenantProfile.missingDocuments.map((d) => (
                <label key={d.doc_type} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    disabled={tenantProfile.isUploadingDocument}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      tenantProfile
                        .uploadDocument({ docType: d.doc_type, file })
                        .then(() => stayoToast.success(`${d.doc_type_label} uploaded`))
                        .catch(() => stayoToast.error('Could not upload — please try again'));
                    }}
                  />
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7', color: C.clay }}>
                    {tenantProfile.isUploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{d.doc_type_label}</div>
                    <div className="mt-0.5 text-[11.5px]" style={{ color: C.textFaint }}>Not uploaded yet</div>
                  </div>
                  <span className="flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: '#FBF1DE', color: C.amber }}>
                    <Upload className="h-3 w-3" /> Upload
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
      </main>

      <DocumentPreviewSheet
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title ?? 'Document'}
        url={preview?.url ?? null}
        fileName={preview?.fileName ?? 'document'}
      />
    </div>
  );
}
