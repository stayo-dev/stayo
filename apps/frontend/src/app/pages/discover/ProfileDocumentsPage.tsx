import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, FileText, Loader2, Upload } from 'lucide-react';

import { useAuth } from '@context/AuthContext';
import { hasLiveTenancy } from '@/app/nav/useAppNav';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { useVaultDocuments } from '@features/profile/hooks/useProfileIdentity';
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
 */
export function ProfileDocumentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const liveTenancy = hasLiveTenancy(user);
  const vault = useVaultDocuments();
  const tenantProfile = useTenantProfile();

  useEffect(() => {
    document.title = 'Documents — Stayo';
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/profile')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Documents
        </h1>
      </header>

      <main className="flex-1 space-y-6 px-5 py-5">
        <section>
          <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Your document vault
          </h2>
          <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: C.line }}>
            {vault.isLoading && <div className="p-4 text-[12.5px]" style={{ color: C.textMuted }}>Loading…</div>}
            {!vault.isLoading && (vault.data ?? []).length === 0 && (
              <div className="p-4 text-[12.5px]" style={{ color: C.textMuted }}>No documents in your vault yet.</div>
            )}
            {(vault.data ?? []).map((d, i) => (
              <div
                key={d.id}
                className="flex items-center gap-3 px-4 py-3.5"
                style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.lineSoft}` }}
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7', color: C.clay }}>
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{d.doc_type}</div>
                  <div className="mt-0.5 text-[11.5px]" style={{ color: C.textFaint }}>{dateLabel(d.uploaded_at)}</div>
                </div>
              </div>
            ))}
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

                // A rejected document is the tenant's to fix — the whole row
                // becomes an "Upload again" control, with the owner's reason.
                if (rejected) {
                  const reason = latestRejectionReason(d.rejection_reason);
                  return (
                    <label key={d.id} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left">
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
                      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F7E4DF', color: '#B3402F' }}>
                        {tenantProfile.isUploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{docLabel}</div>
                        <div className="mt-0.5 text-[11.5px]" style={{ color: '#B3402F' }}>
                          Rejected{reason ? ` — ${reason}` : ''}
                        </div>
                      </div>
                      <span className="flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: '#F7E4DF', color: '#B3402F' }}>
                        <Upload className="h-3 w-3" /> Upload again
                      </span>
                    </label>
                  );
                }

                return (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3.5">
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
                  </div>
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
    </div>
  );
}
