import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Clock, FileText, IdCard, Image as ImageIcon, Upload } from 'lucide-react';
import { kycApi, type OwnerKycDocument } from '../../api/kycApi';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { eyebrow, h1, sub } from '../stepStyles';
import type { OwnerOnboardingKyc } from '../../hooks/useOwnerOnboardingState';

const ITEMS: {
  key: OwnerKycDocument['doc_type'];
  title: string;
  meta: string;
  icon: typeof IdCard;
  /** Identity documents gate going live. The profile photo does not. */
  required: boolean;
}[] = [
  { key: 'AADHAAR', title: 'Aadhaar', meta: 'Required — verified before you go live', icon: IdCard, required: true },
  { key: 'PAN', title: 'PAN', meta: 'Required — verified before you go live', icon: FileText, required: true },
  { key: 'PHOTO', title: 'Profile photo', meta: 'Optional — helps tenants trust you', icon: ImageIcon, required: false },
];

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

/**
 * Real KYC uploads (ADR-038). This step used to be three toggles that stored
 * nothing while claiming documents were "auto-verified" — an owner could
 * believe they were verified when no file had ever left their device.
 *
 * Files go to ImageKit via POST /api/owner/kyc-documents and come back
 * PENDING; only an admin review can mark one verified, so nothing here can
 * overstate its own status.
 */
interface KycStepProps {
  kyc: OwnerOnboardingKyc;
  setKyc: (next: OwnerOnboardingKyc) => void;
}

export function KycStep({ kyc, setKyc }: KycStepProps) {
  const [docs, setDocs] = useState<Record<string, OwnerKycDocument>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let active = true;
    kycApi
      .list()
      .then((list) => {
        if (!active) return;
        const byType = Object.fromEntries(list.map((d) => [d.doc_type, d]));
        setDocs(byType);
        // The wizard gates Continue on this, so it has to know what exists.
        // A rejected document does not count as uploaded — it has to be replaced.
        setKyc({
          aadhaar: byType.AADHAAR?.status === 'PENDING' || byType.AADHAAR?.status === 'VERIFIED',
          pan: byType.PAN?.status === 'PENDING' || byType.PAN?.status === 'VERIFIED',
          photo: Boolean(byType.PHOTO),
        });
      })
      .catch(() => {
        /* An empty list is the correct starting state — no need to alarm. */
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleFile = async (docType: OwnerKycDocument['doc_type'], file?: File) => {
    if (!file) return;
    setUploading(docType);
    try {
      const saved = await kycApi.upload(docType, file);
      setDocs((prev) => ({ ...prev, [docType]: saved }));
      if (docType === 'AADHAAR') setKyc({ ...kyc, aadhaar: true });
      if (docType === 'PAN') setKyc({ ...kyc, pan: true });
      if (docType === 'PHOTO') setKyc({ ...kyc, photo: true });
      stayoToast.success('Uploaded — our team will verify it shortly.');
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Could not upload that file. Please try again.';
      stayoToast.error(message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div>
      <div className={eyebrow}>EARN YOUR BADGE</div>
      <h1 className={h1}>Let&apos;s verify it&apos;s really you.</h1>
      <p className={sub}>
        Aadhaar and PAN are both needed. You can carry on with setup right away — our team reviews them
        while you work, and your hostel goes live once they&apos;re approved.
      </p>

      <div className="flex w-full max-w-[440px] flex-col gap-3.5">
        {ITEMS.map(({ key, title, meta, icon: Icon }) => {
          const doc = docs[key];
          const busy = uploading === key;

          return (
            <div
              key={key}
              className={`flex items-center gap-3.5 rounded-2xl border-[1.5px] bg-card/95 px-4 py-4 transition-colors sm:px-4.5 ${
                doc?.status === 'VERIFIED'
                  ? 'border-success/45'
                  : doc?.status === 'REJECTED'
                    ? 'border-destructive/45'
                    : 'border-border'
              }`}
            >
              <span
                className={`flex h-11.5 w-11.5 flex-none items-center justify-center rounded-xl ${
                  doc?.status === 'VERIFIED'
                    ? 'bg-success/10'
                    : doc?.status === 'REJECTED'
                      ? 'bg-destructive/10'
                      : 'bg-secondary'
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    doc?.status === 'VERIFIED'
                      ? 'text-success'
                      : doc?.status === 'REJECTED'
                        ? 'text-destructive'
                        : 'text-primary'
                  }`}
                  strokeWidth={2.2}
                />
              </span>

              <div className="min-w-0 flex-1">
                <div className="font-display text-[15px] font-bold text-foreground">{title}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {!doc && meta}
                  {doc?.status === 'PENDING' && (
                    <span className="inline-flex items-center gap-1 font-semibold text-foreground/70">
                      <Clock className="h-3 w-3" strokeWidth={2.6} />
                      Uploaded · awaiting review
                    </span>
                  )}
                  {doc?.status === 'VERIFIED' && (
                    <span className="inline-flex items-center gap-1 font-semibold text-success">
                      <Check className="h-3 w-3" strokeWidth={3} />
                      Verified
                    </span>
                  )}
                  {doc?.status === 'REJECTED' && (
                    <span className="inline-flex items-start gap-1 font-semibold text-destructive">
                      <AlertCircle className="mt-0.5 h-3 w-3 flex-none" strokeWidth={2.6} />
                      <span>
                        Rejected — please upload again.
                        {doc.review_note ? <span className="block font-normal">{doc.review_note}</span> : null}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <input
                ref={(el) => {
                  inputs.current[key] = el;
                }}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  handleFile(key, e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => inputs.current[key]?.click()}
                className="flex-none rounded-xl border border-border bg-card px-3.5 py-2 font-display text-[12.5px] font-bold text-foreground transition-colors hover:border-primary disabled:opacity-60"
              >
                {busy ? (
                  'Uploading…'
                ) : doc ? (
                  'Replace'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" strokeWidth={2.4} />
                    Upload
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-5 max-w-[440px] text-[12.5px] leading-relaxed text-muted-foreground">
        <Check className="mr-1 inline h-3 w-3 text-success" strokeWidth={3} />
        Documents are stored securely and only used to verify your identity. Nothing is shown to tenants.
      </p>
    </div>
  );
}
