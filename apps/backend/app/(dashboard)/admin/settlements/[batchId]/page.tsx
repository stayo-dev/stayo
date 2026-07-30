"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Batch detail + admin actions.
 *
 * Sections:
 *   - Header with batch metadata + lifecycle action buttons (approve,
 *     start processing, cancel) gated by current state.
 *   - Items table with per-item action buttons (mark success / failed /
 *     cancel) gated by item state.
 *   - Add-item form (visible only while batch is DRAFT).
 *
 * All writes go through the admin API and route auth-gated. UI forms
 * are intentionally plain — operational correctness over polish.
 */

type Batch = {
  id: string;
  batch_number: string;
  status: string;
  total_amount: string | number;
  total_owners: number;
  total_hostels: number;
  total_items: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  items: Item[];
};

type Item = {
  id: string;
  owner_id: string;
  hostel_id: string;
  amount: string | number;
  payout_method: string;
  payout_status: string;
  payout_reference: string | null;
  failure_reason: string | null;
  covered_credit_ids: string[];
  ledger_debit_id: string | null;
  processed_at: string | null;
  created_at: string;
};

function rupees(n: string | number) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BatchDetailPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId;
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-batch", batchId],
    queryFn: () => api.get<{ batch: Batch }>(`/admin/settlements/batches/${batchId}`),
    refetchInterval: 15_000,
    enabled: !!batchId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });

  const approve = useMutation({
    mutationFn: () => api.post(`/admin/settlements/batches/${batchId}/approve`, {}),
    onSuccess: invalidate,
  });
  const startProcessing = useMutation({
    mutationFn: () => api.post(`/admin/settlements/batches/${batchId}/start-processing`, {}),
    onSuccess: invalidate,
  });
  const cancelBatch = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/settlements/batches/${batchId}/cancel`, { reason }),
    onSuccess: invalidate,
  });

  if (isLoading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-rose-700">Error: {(error as any).message}</div>;
  if (!data) return null;
  const b = data.batch;

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/admin/settlements" className="text-xs text-indigo-700 hover:underline">← Settlement queue</Link>
      </div>

      {/* Header */}
      <header className="rounded border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-gray-500">Batch</div>
            <h1 className="text-lg font-semibold font-mono">{b.batch_number}</h1>
            <div className="mt-2 flex items-center gap-2">
              <StatusPill status={b.status} />
              <span className="text-xs text-gray-500">created {new Date(b.created_at).toLocaleString()}</span>
            </div>
            {b.notes && <div className="text-xs text-gray-500 mt-2 max-w-xl whitespace-pre-wrap">{b.notes}</div>}
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              <div className="text-xs text-gray-500">Total</div>
              <div className="text-2xl font-semibold font-mono">{rupees(b.total_amount)}</div>
              <div className="text-xs text-gray-500">{b.total_items} items · {b.total_owners} owners · {b.total_hostels} hostels</div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              {b.status === "DRAFT" && (
                <>
                  <ActionBtn
                    label="Approve"
                    tone="primary"
                    pending={approve.isPending}
                    onClick={() => { if (confirm("Approve this batch? Items become locked.")) approve.mutate(); }}
                  />
                  <ActionBtn
                    label="Cancel batch"
                    tone="danger"
                    pending={cancelBatch.isPending}
                    onClick={() => {
                      const r = prompt("Cancel reason:");
                      if (r) cancelBatch.mutate(r);
                    }}
                  />
                </>
              )}
              {b.status === "APPROVED" && (
                <>
                  <ActionBtn
                    label="Start processing"
                    tone="primary"
                    pending={startProcessing.isPending}
                    onClick={() => startProcessing.mutate()}
                  />
                  <ActionBtn
                    label="Cancel batch"
                    tone="danger"
                    pending={cancelBatch.isPending}
                    onClick={() => {
                      const r = prompt("Cancel reason:");
                      if (r) cancelBatch.mutate(r);
                    }}
                  />
                </>
              )}
            </div>
            {(approve.error || startProcessing.error || cancelBatch.error) && (
              <div className="text-xs text-rose-700">
                {(approve.error as any)?.message || (startProcessing.error as any)?.message || (cancelBatch.error as any)?.message}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Items table */}
      <section className="rounded border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b text-sm font-medium">Payout Items</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>Owner / Hostel</Th><Th>Status</Th><Th className="text-right">Amount</Th>
                <Th className="text-center">Credits</Th><Th>Method</Th><Th>Reference</Th>
                <Th>Processed</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {b.items.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-400">No items.</td></tr>}
              {b.items.map((i) => (
                <ItemRow key={i.id} item={i} batch={b} onChanged={invalidate} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {b.status === "DRAFT" && <AddItemForm batchId={batchId!} onAdded={invalidate} />}
    </div>
  );
}

function ItemRow(props: { item: Item; batch: Batch; onChanged: () => void }) {
  const { item, batch, onChanged } = props;
  const markSuccess = useMutation({
    mutationFn: (params: { ref: string; method?: string; notes?: string }) =>
      api.post(`/admin/settlements/batches/${batch.id}/items/${item.id}/mark-success`, {
        payoutReference: params.ref, payoutMethod: params.method, notes: params.notes,
      }),
    onSuccess: onChanged,
  });
  const markFailed = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/admin/settlements/batches/${batch.id}/items/${item.id}/mark-failed`, { reason }),
    onSuccess: onChanged,
  });
  const cancelItem = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/admin/settlements/batches/${batch.id}/items/${item.id}/cancel`, { reason }),
    onSuccess: onChanged,
  });

  const canFinalize = ["APPROVED", "PROCESSING"].includes(batch.status) &&
    ["PENDING", "PROCESSING"].includes(item.payout_status);
  const canCancel = batch.status === "DRAFT" && item.payout_status === "PENDING";

  return (
    <tr className="border-t hover:bg-gray-50 align-top">
      <Td className="font-mono text-[10px] leading-tight">
        <div className="text-gray-900">o:{item.owner_id.slice(0, 8)}</div>
        <div className="text-gray-500">h:{item.hostel_id.slice(0, 8)}</div>
      </Td>
      <Td><StatusPill status={item.payout_status} /></Td>
      <Td className="text-right font-mono">{rupees(item.amount)}</Td>
      <Td className="text-center">{item.covered_credit_ids.length}</Td>
      <Td>{item.payout_method}</Td>
      <Td className="font-mono text-[10px]">{item.payout_reference ?? "—"}</Td>
      <Td>{item.processed_at ? new Date(item.processed_at).toLocaleString() : "—"}</Td>
      <Td>
        {canFinalize && (
          <div className="flex flex-col gap-1">
            <button
              className="text-emerald-700 hover:underline text-left"
              disabled={markSuccess.isPending}
              onClick={() => {
                const ref = prompt("Bank/UTR reference:");
                if (!ref) return;
                const method = prompt("Method (NEFT/IMPS/UPI/RTGS/CHEQUE):", item.payout_method) || undefined;
                markSuccess.mutate({ ref, method });
              }}
            >
              {markSuccess.isPending ? "…" : "✓ success"}
            </button>
            <button
              className="text-rose-700 hover:underline text-left"
              disabled={markFailed.isPending}
              onClick={() => {
                const r = prompt("Failure reason:");
                if (r) markFailed.mutate(r);
              }}
            >
              {markFailed.isPending ? "…" : "✗ failed"}
            </button>
          </div>
        )}
        {canCancel && (
          <button
            className="text-gray-600 hover:underline"
            disabled={cancelItem.isPending}
            onClick={() => { const r = prompt("Cancel reason:"); if (r) cancelItem.mutate(r); }}
          >
            {cancelItem.isPending ? "…" : "cancel"}
          </button>
        )}
        {item.failure_reason && <div className="text-[10px] text-rose-700 mt-1">{item.failure_reason}</div>}
        {item.ledger_debit_id && <div className="text-[10px] text-emerald-700 mt-1 font-mono">d:{item.ledger_debit_id.slice(0, 8)}</div>}
        {(markSuccess.error || markFailed.error || cancelItem.error) && (
          <div className="text-[10px] text-rose-700 mt-1">
            {(markSuccess.error as any)?.message || (markFailed.error as any)?.message || (cancelItem.error as any)?.message}
          </div>
        )}
      </Td>
    </tr>
  );
}

function AddItemForm(props: { batchId: string; onAdded: () => void }) {
  const [ownerId, setOwnerId] = useState("");
  const [hostelId, setHostelId] = useState("");
  const [requestedRupees, setRequestedRupees] = useState("");
  const [method, setMethod] = useState<"NEFT" | "IMPS" | "UPI" | "RTGS" | "CHEQUE" | "OTHER">("NEFT");

  const eligibleQ = useQuery({
    queryKey: ["eligible-credits", ownerId, hostelId],
    queryFn: () => api.get<{ credits: Array<{ id: string; amount: string; created_at: string }> }>(
      `/admin/settlements/eligible-credits?ownerId=${ownerId}&hostelId=${hostelId}`
    ),
    enabled: ownerId.length >= 32 && hostelId.length >= 32,
  });

  const addItem = useMutation({
    mutationFn: () => {
      const requestedAmountPaise = requestedRupees ? Math.round(Number(requestedRupees) * 100) : null;
      return api.post(`/admin/settlements/batches/${props.batchId}/items`, {
        ownerId, hostelId, requestedAmountPaise, payoutMethod: method,
      });
    },
    onSuccess: () => {
      props.onAdded();
      setOwnerId(""); setHostelId(""); setRequestedRupees("");
    },
  });

  const eligibleTotal = (eligibleQ.data?.credits ?? []).reduce((s, c) => s + Number(c.amount), 0);

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="text-sm font-medium mb-3">Add Payout Item</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <Field label="Owner ID (UUID)">
          <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full border-gray-300 rounded px-2 py-1 font-mono" placeholder="owner uuid" />
        </Field>
        <Field label="Hostel ID (UUID)">
          <input value={hostelId} onChange={(e) => setHostelId(e.target.value)} className="w-full border-gray-300 rounded px-2 py-1 font-mono" placeholder="hostel uuid" />
        </Field>
        <Field label="Amount in ₹ (blank = all eligible)">
          <input value={requestedRupees} onChange={(e) => setRequestedRupees(e.target.value)} className="w-full border-gray-300 rounded px-2 py-1 font-mono" placeholder="optional" />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="w-full border-gray-300 rounded px-2 py-1">
            {["NEFT", "IMPS", "UPI", "RTGS", "CHEQUE", "OTHER"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      {eligibleQ.data && (
        <div className="mt-3 text-xs text-gray-600">
          Eligible: <span className="font-mono">{eligibleQ.data.credits.length}</span> credits, total <span className="font-mono">{rupees(eligibleTotal)}</span>
          {eligibleQ.data.credits.length === 0 && <span className="text-rose-600 ml-2">— nothing to add</span>}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          disabled={addItem.isPending || !ownerId || !hostelId}
          onClick={() => addItem.mutate()}
        >
          {addItem.isPending ? "Adding…" : "Add Item"}
        </button>
        {addItem.error && <div className="text-xs text-rose-700">{(addItem.error as any).message}</div>}
      </div>
    </section>
  );
}

function ActionBtn(props: { label: string; tone: "primary" | "danger"; pending: boolean; onClick: () => void }) {
  const classes = props.tone === "danger"
    ? "bg-rose-600 hover:bg-rose-500 text-white"
    : "bg-gray-900 hover:bg-gray-700 text-white";
  return (
    <button
      onClick={props.onClick}
      disabled={props.pending}
      className={`px-3 py-1.5 text-xs rounded disabled:opacity-50 ${classes}`}
    >{props.pending ? "…" : props.label}</button>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-gray-600 text-[11px] mb-1">{props.label}</div>
      {props.children}
    </label>
  );
}

function Th(p: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-medium px-3 py-2 ${p.className ?? ""}`}>{p.children}</th>;
}
function Td(p: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${p.className ?? ""}`}>{p.children}</td>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-gray-200 text-gray-800",
    APPROVED: "bg-blue-100 text-blue-800",
    PROCESSING: "bg-amber-100 text-amber-800",
    COMPLETED: "bg-emerald-100 text-emerald-800",
    PARTIALLY_FAILED: "bg-orange-100 text-orange-800",
    FAILED: "bg-rose-100 text-rose-800",
    CANCELLED: "bg-gray-100 text-gray-500 line-through",
    PENDING: "bg-gray-200 text-gray-800",
    SUCCESS: "bg-emerald-100 text-emerald-800",
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-gray-100"}`}>{status}</span>;
}
