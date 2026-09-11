import { useRef, useState } from 'react';
import { AlertCircle, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { StayoLoader } from '@shared/ui/brand';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { tenantPortalApi } from '@features/tenant-portal/api';
import { prepareImageForUpload } from '@platforms/tenant/onboarding/compressImage';
import { isImage, uploadProblem } from '@platforms/tenant/onboarding/uploadImagePolicy';

/**
 * A document the hostel sent back, with the one thing the tenant needs next:
 * a way to send a better copy.
 *
 * The tenant already saw "REJECTED" and the owner's message thread, but had no
 * way to act on it outside onboarding — so a rejected Aadhaar stayed rejected
 * until someone phoned. The replacement uploads here, lands PENDING, and goes
 * straight back into the owner's review queue.
 *
 * Images are resized on the phone first (the same policy as onboarding), so a
 * camera photo uploads in a second instead of refusing at 5MB.
 */

interface RejectedDocumentNoticeProps {
  docType: string;
  label: string;
  /** The owner's latest message — shown as the reason, verbatim. */
  reason: string | null;
}

export function RejectedDocumentNotice({ docType, label, reason }: RejectedDocumentNoticeProps) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file?: File) => {
    if (!file) return;
    setError(null);
    if (!isImage(file.type) && file.type !== 'application/pdf') {
      setError(uploadProblem(file, 'document'));
      return;
    }
    setUploading(true);
    try {
      const ready = await prepareImageForUpload(file, 'document');
      const problem = uploadProblem(ready, 'document');
      if (problem) {
        setError(problem);
        return;
      }
      await tenantPortalApi.uploadMyDocument(docType, ready);
      stayoToast.success(`New ${label} sent to your hostel`);
      queryClient.invalidateQueries();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'The upload didn’t go through — please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-destructive/25 bg-destructive/5 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-destructive" strokeWidth={2.2} />
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold text-foreground">Your hostel needs a new copy</p>
          {reason && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">“{reason}”</p>}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={uploading}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {uploading ? <StayoLoader size="sm" label={null} /> : <Upload className="h-4 w-4" strokeWidth={2.2} />}
        {uploading ? 'Uploading…' : `Upload a new ${label}`}
      </button>

      {error && <p className="text-[11.5px] font-semibold text-destructive">{error}</p>}
    </div>
  );
}
