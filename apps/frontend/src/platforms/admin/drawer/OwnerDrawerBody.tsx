import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { DrawerSection, KeyValueRows } from './AdminDrawer';
import { formatInr } from '../owners/ownerRows';
import { Field, Modal, MODAL_INPUT, ModalFooter } from '../ui';
import { useToast } from '../layout/toastContext';
import { adminError, formatDate as formatBillingDate, formatPaise } from '../billing/subscriptionAdminView';
import {
  invoiceEmailNeedsAttention,
  invoiceWhatsAppNeedsAttention,
  OWNER_PAYMENT_METHODS,
  ownerPaymentMethodLabel,
  validateAddOwnerPaymentForm,
  whatsAppStatusLabel,
} from '../billing/ownerPaymentsView';

const STATUS_COLOR: Record<string, string> = {
  LIVE: '#1F7A52',
  PENDING: '#B8792B',
  REJECTED: '#B3402F',
  SUSPENDED: '#B3402F',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * The owner detail drawer body. Every value here comes from
 * `/platform-admin/owners/[id]`; fields the endpoint does not return are
 * omitted entirely rather than rendered as an empty row, which would imply
 * the data exists and happens to be blank.
 */
export function OwnerDrawerBody({ ownerId }: { ownerId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['admin', 'owner', ownerId],
    queryFn: () => platformAdminService.getOwner(ownerId),
    staleTime: 30_000,
  });

  const payments = useQuery({
    queryKey: ['admin', 'owner-payments', ownerId],
    queryFn: () => platformAdminService.getOwnerPayments(ownerId),
    staleTime: 15_000,
  });

  const downloadInvoice = useMutation({
    mutationFn: (invoiceId: string) => platformAdminService.downloadOwnerInvoice(invoiceId),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const resendInvoice = useMutation({
    mutationFn: (invoiceId: string) => platformAdminService.resendOwnerInvoice(invoiceId),
    onSuccess: (res) => {
      toast(res.sent ? 'Invoice emailed to the owner' : "Couldn't send — check the owner's email on file", res.sent ? 'ok' : 'no');
      qc.invalidateQueries({ queryKey: ['admin', 'owner-payments', ownerId] });
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const resendInvoiceWhatsApp = useMutation({
    mutationFn: (invoiceId: string) => platformAdminService.resendOwnerInvoiceWhatsApp(invoiceId),
    onSuccess: (res) => {
      toast(res.sent ? 'Invoice sent on WhatsApp' : res.detail || "Couldn't send on WhatsApp", res.sent ? 'ok' : 'no');
      qc.invalidateQueries({ queryKey: ['admin', 'owner-payments', ownerId] });
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  if (detail.isLoading) {
    return <div className="py-12 text-center text-[13px] text-[#8A7F75]">Loading owner…</div>;
  }
  if (detail.isError || !detail.data) {
    return <div className="py-12 text-center text-[13px] text-[#B3402F]">Couldn't load this owner.</div>;
  }

  const { owner, hostels } = detail.data;

  const metrics = [
    { k: 'Hostels', v: String(owner.hostels ?? 0) },
    { k: 'Beds', v: String(owner.capacity ?? 0) },
    { k: 'Occupancy', v: owner.capacity > 0 ? `${owner.occupancy}%` : '—' },
    { k: 'Tenants', v: String(owner.active_tenants ?? 0) },
  ];

  return (
    <>
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-2.5">
        {metrics.map((m) => (
          <div key={m.k} className="rounded-2xl border border-[#EFE6DA] bg-white px-3 py-[13px] text-center">
            <div className="font-admin text-[18px] font-extrabold text-[#221E1A]">{m.v}</div>
            <div className="mt-0.5 text-[10px] font-medium text-[#9A8F84]">{m.k}</div>
          </div>
        ))}
      </div>

      <DrawerSection title="Account & contact">
        <KeyValueRows
          rows={[
            { k: 'Email', v: owner.email || '—' },
            { k: 'Phone', v: owner.phone || '—' },
            { k: 'City', v: owner.city || '—' },
            { k: 'Joined', v: formatDate(owner.joined_at) },
            {
              k: 'Status',
              v: (
                <span className={owner.is_active ? 'text-[#1F7A52]' : 'text-[#B0A597]'}>
                  {owner.is_active ? 'Active' : 'Paused'}
                </span>
              ),
            },
            // "Unassigned" — not blank — when the owner has no
            // `owner_subscriptions` row at all (pre-ADR-172-backfill gap),
            // matching the Owners table's own convention.
            { k: 'Plan', v: owner.plan_name || 'Unassigned' },
          ]}
        />
      </DrawerSection>

      <DrawerSection title="This month">
        <KeyValueRows
          rows={[
            { k: 'Collected', v: formatInr(Number(owner.collected_this_month ?? 0)) },
            { k: 'Outstanding', v: formatInr(Number(owner.outstanding ?? 0)) },
          ]}
        />
      </DrawerSection>

      <DrawerSection
        title="Billing / Payments"
        action={
          <button
            type="button"
            onClick={() => setAddPaymentOpen(true)}
            className="rounded-full bg-[#221E1A] px-3 py-1 text-[11px] font-bold text-white"
          >
            + Add Payment
          </button>
        }
      >
        {payments.isLoading ? (
          <div className="px-[18px] py-4 text-[12px] text-[#A2978B]">Loading payments…</div>
        ) : payments.isError ? (
          <div className="px-[18px] py-4 text-[12px] text-[#B3402F]">Couldn't load payments.</div>
        ) : (payments.data?.payments ?? []).length === 0 ? (
          <div className="px-[18px] py-4 text-[12px] text-[#A2978B]">
            No payments recorded yet — use "+ Add Payment" for a one-off charge (onboarding cost, setup fee, etc).
          </div>
        ) : (
          (payments.data?.payments ?? []).map((p: any, index: number) => (
            <div
              key={p.id}
              className={`flex items-start justify-between gap-3 px-[18px] py-[13px] ${
                index > 0 ? 'border-t border-[#F2ECE5]' : ''
              } ${p.status === 'VOIDED' ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[#2A2521]">{formatPaise(p.amount_paise)}</div>
                <div className="truncate text-[11.5px] text-[#5A5147]">{p.description}</div>
                <div className="text-[10.5px] text-[#9A8F84]">
                  {ownerPaymentMethodLabel(p.payment_method)} · {formatBillingDate(p.created_at)}
                  {p.status === 'VOIDED' ? ' · Voided' : ''}
                </div>
              </div>
              {p.invoice ? (
                <div className="flex flex-none flex-col items-end gap-1">
                  <div className="text-[9.5px] font-bold uppercase text-[#9A8F84]">{p.invoice.invoice_number}</div>
                  <button
                    type="button"
                    onClick={() => downloadInvoice.mutate(p.invoice.id)}
                    className="rounded-[8px] border border-[#EAE1D8] bg-white px-2.5 py-1 text-[11px] font-bold text-[#5A5147]"
                  >
                    {downloadInvoice.isPending ? 'Preparing…' : 'View Invoice'}
                  </button>

                  <div className="mt-0.5 flex flex-col items-end gap-0.5 text-[10px]">
                    <span className={p.invoice.email.sent ? 'text-[#1F7A52]' : 'text-[#B3402F]'}>
                      Email {p.invoice.email.sent ? '✓ Sent' : '✕ Failed'}
                    </span>
                    {invoiceEmailNeedsAttention(p) && (
                      <button
                        type="button"
                        onClick={() => resendInvoice.mutate(p.invoice.id)}
                        className="font-semibold text-[#B8792B] underline"
                      >
                        Retry email
                      </button>
                    )}

                    <span
                      className={
                        p.invoice.whatsapp.status === 'SENT'
                          ? 'text-[#1F7A52]'
                          : p.invoice.whatsapp.status === 'FAILED'
                            ? 'text-[#B3402F]'
                            : 'text-[#B8792B]'
                      }
                    >
                      WhatsApp{' '}
                      {p.invoice.whatsapp.status === 'SENT' ? '✓ ' : p.invoice.whatsapp.status === 'FAILED' ? '✕ ' : '⏳ '}
                      {whatsAppStatusLabel(p.invoice.whatsapp.status)}
                    </span>
                    {p.invoice.whatsapp.error && (
                      <span className="max-w-[160px] text-right text-[9.5px] text-[#B0A597]">{p.invoice.whatsapp.error}</span>
                    )}
                    {(invoiceWhatsAppNeedsAttention(p) || p.invoice.whatsapp.status === 'PENDING') && (
                      <button
                        type="button"
                        onClick={() => resendInvoiceWhatsApp.mutate(p.invoice.id)}
                        className="font-semibold text-[#B8792B] underline"
                      >
                        {invoiceWhatsAppNeedsAttention(p) ? 'Retry WhatsApp' : 'Send WhatsApp Invoice'}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </DrawerSection>

      <DrawerSection title={`Hostels held (${hostels?.length ?? 0})`}>
        {(hostels ?? []).length === 0 ? (
          <div className="px-[18px] py-4 text-[12px] text-[#A2978B]">
            No hostels yet — this owner hasn't completed the add-hostel wizard.
          </div>
        ) : (
          (hostels ?? []).map((h: any, index: number) => (
            <div
              key={h.id}
              className={`flex items-center gap-3 px-[18px] py-[13px] ${
                index > 0 ? 'border-t border-[#F2ECE5]' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-[#2A2521]">{h.name}</div>
                <div className="truncate text-[11px] text-[#9A8F84]">
                  {[h.city, h.capacity ? `${h.capacity} beds` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span
                className="flex-none text-[10px] font-semibold"
                style={{ color: STATUS_COLOR[String(h.listing_status)] ?? '#8A7F75' }}
              >
                {h.listing_status}
              </span>
            </div>
          ))
        )}
      </DrawerSection>
    </div>

    {addPaymentOpen && (
      <AddOwnerPaymentModal
        ownerId={ownerId}
        onClose={() => setAddPaymentOpen(false)}
        onRecorded={() => {
          qc.invalidateQueries({ queryKey: ['admin', 'owner-payments', ownerId] });
          qc.invalidateQueries({ queryKey: ['admin', 'owner', ownerId] });
          setAddPaymentOpen(false);
          toast('Payment recorded — invoice generated and emailed to the owner', 'ok');
        }}
      />
    )}
    </>
  );
}

function AddOwnerPaymentModal({
  ownerId,
  onClose,
  onRecorded,
}: {
  ownerId: string;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Generated once per modal-open — sent as `idempotency_key` so a
  // double-click or a retried request after a network hiccup resolves to the
  // same payment row instead of creating a duplicate charge.
  const [idempotencyKey] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `owner-payment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  const check = validateAddOwnerPaymentForm({ amountRupees: amount, paymentMethod: method, description, notes });

  const record = useMutation({
    mutationFn: async () => {
      if (!check.ok) throw new Error(check.reason);
      return platformAdminService.recordOwnerPayment(ownerId, {
        amount_paise: check.amountPaise!,
        payment_method: method as any,
        description: description.trim(),
        transaction_reference: reference.trim() || undefined,
        proof_file_url: proofUrl || undefined,
        notes: notes.trim() || undefined,
        idempotency_key: idempotencyKey,
      });
    },
    onSuccess: onRecorded,
    onError: (e) => toast(adminError(e), 'no'),
  });

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await platformAdminService.uploadOwnerPaymentProof(file);
      setProofUrl(url);
    } catch (e) {
      toast(adminError(e), 'no');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Add Payment" subtitle="Record a one-off payment for this owner" onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <Field label="Amount (₹)">
          <input
            type="number"
            min={1}
            step="0.01"
            className={MODAL_INPUT}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
          />
        </Field>
        <Field label="Payment method">
          <select className={MODAL_INPUT} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="" disabled>
              Choose a method…
            </option>
            {OWNER_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {ownerPaymentMethodLabel(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" hint="What is this payment for? e.g. Tenant onboarding cost">
          <input
            className={MODAL_INPUT}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tenant onboarding cost"
            maxLength={240}
          />
        </Field>
        <Field label="Transaction / Reference ID" hint="Optional">
          <input
            className={MODAL_INPUT}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR / receipt number"
          />
        </Field>
        <Field label="Payment proof" hint="Optional — screenshot or PDF">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[12px] text-[#5A5147] file:mr-3 file:rounded-[9px] file:border file:border-[#E7DDD1] file:bg-white file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-[#2A2521]"
          />
          {uploading && <span className="mt-1 block text-[10.5px] text-[#A2978B]">Uploading…</span>}
          {proofUrl && !uploading && <span className="mt-1 block text-[10.5px] text-[#1F7A52]">Uploaded</span>}
        </Field>
        <Field label="Notes" hint="Optional">
          <textarea className={MODAL_INPUT} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() => record.mutate()}
        confirmLabel="Record Payment"
        disabled={!check.ok || uploading}
        pending={record.isPending}
      />
    </Modal>
  );
}
