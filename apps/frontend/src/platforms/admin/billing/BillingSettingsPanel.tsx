import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { useToast } from '../layout/toastContext';
import { adminError } from './subscriptionAdminView';

const input =
  'w-full rounded-[10px] border border-[#EAE1D8] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#221E1A]';
const label = 'text-[11.5px] font-semibold text-[#8A7F75]';

/**
 * Admin billing configuration (ADR-172, Phase 5) — the Stayo payee details the
 * owner billing page shows. Stored on `platform_settings` key `"billing"`; the
 * owner's `/api/owner/subscription/payment-context` reads the same row, so
 * saving here lights up the owner payment screen automatically. NO GST config.
 */
export function BillingSettingsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ['admin', 'billing-settings'],
    queryFn: () => platformAdminService.getBillingSettings(),
    staleTime: 60_000,
  });

  const [form, setForm] = useState({
    upi_vpa: '',
    account_name: '',
    note: '',
    qr_image_url: '',
    bank_account_no: '',
    bank_ifsc: '',
    bank_name: '',
  });

  useEffect(() => {
    const s = query.data?.settings;
    if (!s) return;
    setForm({
      upi_vpa: s.upi_vpa ?? '',
      account_name: s.account_name ?? '',
      note: s.note ?? '',
      qr_image_url: s.qr_image_url ?? '',
      bank_account_no: s.bank?.account_no ?? '',
      bank_ifsc: s.bank?.ifsc ?? '',
      bank_name: s.bank?.bank_name ?? '',
    });
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      platformAdminService.saveBillingSettings({
        upi_vpa: form.upi_vpa || null,
        account_name: form.account_name || null,
        note: form.note || null,
        qr_image_url: form.qr_image_url || null,
        bank: {
          account_name: form.account_name || undefined,
          account_no: form.bank_account_no || undefined,
          ifsc: form.bank_ifsc || undefined,
          bank_name: form.bank_name || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'billing-settings'] });
      toast('Billing details saved — owners will see these on their payment screen', 'ok');
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const uploadQr = useMutation({
    mutationFn: (file: File) => platformAdminService.uploadBillingQr(file),
    onSuccess: ({ url }) => {
      setForm((f) => ({ ...f, qr_image_url: url }));
      toast('QR uploaded — remember to Save', 'ok');
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (query.isLoading) return <p className="text-[13px] text-[#8A7F75]">Loading…</p>;

  return (
    <div className="flex max-w-[560px] flex-col gap-4">
      <p className="text-[12px] leading-[1.55] text-[#7A6F63]">
        These are the details an owner sees on <span className="font-semibold">Subscription → Pay</span>. Leave a field blank
        to hide it. Do not paste real production credentials into a staging environment.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className={label}>UPI VPA</span>
        <input className={input} value={form.upi_vpa} onChange={(e) => set('upi_vpa')(e.target.value)} placeholder="stayo@hdfcbank" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>Payee / account name</span>
        <input className={input} value={form.account_name} onChange={(e) => set('account_name')(e.target.value)} placeholder="Stayo Technologies" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>Payment instructions (shown to the owner)</span>
        <textarea
          className={`${input} min-h-[70px]`}
          value={form.note}
          onChange={(e) => set('note')(e.target.value)}
          placeholder="Include your registered mobile number in the payment note."
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={label}>Payment QR</span>
        {form.qr_image_url && (
          <img src={form.qr_image_url} alt="Payment QR" className="h-32 w-32 rounded-lg border border-[#EAE1D8] object-contain" />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploadQr.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadQr.mutate(f);
          }}
          className="text-[12px] text-[#5A5147]"
        />
      </div>

      <details className="rounded-[10px] border border-[#EAE1D8] p-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-[#5A5147]">Bank transfer details (optional)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={label}>Account number</span>
            <input className={input} value={form.bank_account_no} onChange={(e) => set('bank_account_no')(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>IFSC</span>
            <input className={`${input} uppercase`} value={form.bank_ifsc} onChange={(e) => set('bank_ifsc')(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>Bank name</span>
            <input className={input} value={form.bank_name} onChange={(e) => set('bank_name')(e.target.value)} />
          </label>
        </div>
      </details>

      <button
        type="button"
        disabled={save.isPending}
        onClick={() => save.mutate()}
        className="w-fit rounded-[10px] bg-[#221E1A] px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save billing details'}
      </button>
    </div>
  );
}
