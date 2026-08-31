import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { SignaturePad } from '@shared/ui/inputs/SignaturePad';
import { configApi } from '../api/configApi';
import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card =
  'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/**
 * Your signature on the rental agreement.
 *
 * The endpoint (`POST /owner/hostels/:id/agreement-template/signature`) is
 * called in exactly one place: the Add Hostel builder's agreement step. So an
 * owner could set their signature while first creating a hostel and then had
 * no way to change it — the agreements screen's "Signatures" row said "Owner
 * stamp set" and opened the hostel identity page, where an owner uploads their
 * *logo*. This is that row's real destination.
 *
 * Reuses the owner signature pad with `allowUpload`, which exists for exactly
 * this act: an owner capturing their own signature once for their own
 * hostel's template is a different thing from a tenant signing a particular
 * tenancy, and only the former may be a photograph. See ADR-140.
 */
export function MoreConfigAgreementSignaturePage() {
  const hostelId = useConfiguredHostelId();
  const queryClient = useQueryClient();

  const templateQuery = useQuery({
    queryKey: ['agreement-template', hostelId],
    queryFn: () => configApi.getAgreementTemplate(hostelId!),
    enabled: Boolean(hostelId),
  });

  const existing = templateQuery.data?.active?.owner_signature_url ?? null;

  const upload = useMutation({
    mutationFn: (file: File) => configApi.uploadOwnerSignature(hostelId!, file),
    onSuccess: () => {
      stayoToast.success('Signature saved');
      queryClient.invalidateQueries({ queryKey: ['agreement-template', hostelId] });
    },
    onError: () => stayoToast.error('Could not save your signature'),
  });

  return (
    <div className="flex flex-col gap-5 px-4 pb-24 pt-6 sm:px-6">
      <MoreScreenHeader
        title="Your signature"
        subtitle="Signed onto every agreement on your behalf"
      />

      <div className={`${card} p-4`}>
        <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
          {existing
            ? 'This appears on every agreement your tenants sign. Draw or upload a new one to replace it.'
            : 'Until you add one, agreements go out to tenants without your signature on them.'}
        </p>

        <div className="mt-3.5">
          <SignaturePad
            allowUpload
            existingSignatureUrl={existing}
            placeholder="Sign here"
            onSave={(blob) => {
              if (!blob || !hostelId) return;
              upload.mutate(new File([blob], 'owner-signature.png', { type: 'image/png' }));
            }}
          />
        </div>

        {upload.isPending && (
          <p className="mt-3 text-[12px] font-medium text-muted-foreground">Saving…</p>
        )}

        {existing && !upload.isPending && (
          <p className="mt-3 flex items-center gap-2 text-[12px] font-medium text-[#3F7D58]">
            <ShieldCheck className="h-4 w-4 flex-none" strokeWidth={2} />
            On file — every new agreement carries it.
          </p>
        )}
      </div>

      <p className="pl-0.5 text-[11px] leading-[1.5] text-muted-foreground">
        Captured once per hostel. A tenant signs their own agreement separately, when they activate.
      </p>
    </div>
  );
}
