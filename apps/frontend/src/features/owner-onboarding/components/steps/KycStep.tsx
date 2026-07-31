import { useEffect, useRef, useState } from 'react';
import { Check, Clock, FileText, IdCard, Image as ImageIcon, Upload } from 'lucide-react';
import { kycApi, type OwnerKycDocument } from '../../api/kycApi';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { eyebrow, h1, sub } from '../stepStyles';

const ITEMS: {
  key: OwnerKycDocument['doc_type'];
  title: string;
  meta: string;
  icon: typeof IdCard;
}[] = [
  { key: 'AADHAAR', title: 'Aadhaar', meta: 'Required before you go live', icon: IdCard },
  { key: 'PAN', title: 'PAN', meta: 'Optional', icon: FileText },
  { key: 'PHOTO', title: 'Profile photo', meta: 'Helps tenants trust you', icon: ImageIcon },
];

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

/**
 * Real KYC uploads (ADR-037). This step used to be three toggles that stored
 * nothing while claiming documents were "auto-verified" — an owner could
 * believe they were verified when no file had ever left their device.
 *
 * Files go to ImageKit via POST /api/owner/kyc-documents and come back
 * PENDING; only an admin review can mark one verified, so nothing here can
 * overstate its own status.
 */
export function KycStep() {
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
        setDocs(Object.fromEntries(list.map((d) => [d.doc_type, d])));
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
        Upload what you have — our team reviews these after you publish. You can add them later too.
      </p>

      <div className="flex max-w-[440px] flex-col gap-3.5">
        {ITEMS.map(({ key, title, meta, icon: Icon }) => {
          const doc = docs[key];
          const busy = uploading === key;

          return (
            <div
              key={key}
              className={`flex items-center gap-3.5 rounded-2xl border-[1.5px] bg-card/95 px-4.5 py-4 transition-colors ${
                doc ? 'border-success/45' : 'border-border'
              }`}
            >
              <span
                className={`flex h-11.5 w-11.5 flex-none items-center justify-center rounded-xl ${
                  doc ? 'bg-success/10' : 'bg-secondary'
                }`}
              >
                <Icon className={`h-5 w-5 ${doc ? 'text-success' : 'text-primary'}`} strokeWidth={2.2} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="font-display text-[15px] font-bold text-foreground">{title}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {doc ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-foreground/70">
                      <Clock className="h-3 w-3" strokeWidth={2.6} />
                      Uploaded · awaiting review
                    </span>
                  ) : (
                    meta
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
