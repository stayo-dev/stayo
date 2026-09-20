"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Settlement queue.
 *
 * Two stacked sections:
 *   1. Batch list with status filter — operational view of in-flight batches.
 *   2. Owners with pending payable — the source pool of un-settled credits,
 *      sorted by oldest first so admins drain liability FIFO.
 *
 * Both are info-dense tables. Action buttons (create batch, drill into
 * batch, drill into owner) are explicit.
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
  notes: string | null;
};

type PendingOwner = {
  owner_id: string;
  hostel_count: number;
  pending_credit_count: number;
  pending_amount: string;
  oldest_credit_at: string;
};

const STATUS_FILTERS = ["ALL", "DRAFT", "APPROVED", "PROCESSING", "COMPLETED", "PARTIALLY_FAILED", "FAILED", "CANCELLED"];

function rupees(n: string | number) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function ago(iso: string) {
  const d = new Date(iso).getTime();
  const days = Math.floor((Date.now() - d) / (24 * 3600 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function SettlementQueuePage() {
  const [status, setStatus] = useState<string>("ALL");
  const router = useRouter();
  const qc = useQueryClient();

  const batchesQ = useQuery({
    queryKey: ["admin-batches", status],
    queryFn: () =>
      api.get<{ batches: Batch[] }>(
        `/admin/settlements/batches${status !== "ALL" ? `?status=${status}` : ""}`
      ),
    refetchInterval: 30_000,
  });

  const pendingQ = useQuery({
    queryKey: ["admin-pending-payable"],
    queryFn: () => api.get<{ owners: PendingOwner[] }>("/admin/settlements/pending-payable?limit=200"),
    refetchInterval: 60_000,
  });

  const createBatch = useMutation({
    mutationFn: (notes: string) => api.post<{ batch: Batch }>("/admin/settlements/batches", { notes: notes || undefined }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin-batches"] });
      router.push(`/admin/settlements/${data.batch.id}`);
    },
  });

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settlement Queue</h1>
        <button
          className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          disabled={createBatch.isPending}
          onClick={() => {
            const notes = window.prompt("Notes for this batch (optional):", "");
            if (notes !== null) createBatch.mutate(notes);
          }}
        >
          {createBatch.isPending ? "Creating…" : "+ New Draft Batch"}
        </button>
      </header>

      {createBatch.error && (
        <div className="text-xs text-rose-700">Error: {(createBatch.error as any).message}</div>
      )}

      {/* Batches table */}
      <section className="rounded border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Batches</div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="text-xs border-gray-300 rounded px-2 py-1"
            >
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>Batch #</Th><Th>Status</Th><Th className="text-right">Total</Th>
                <Th className="text-center">Items</Th><Th className="text-center">Success / Failed</Th>
                <Th>Created</Th><Th>Approved</Th><Th>Completed</Th><Th>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {batchesQ.isLoading && <tr><td colSpan={9} className="p-4 text-center text-gray-400">Loading…</td></tr>}
              {batchesQ.data?.batches.length === 0 && (
                <tr><td colSpan={9} className="p-4 text-center text-gray-400">No batches.</td></tr>
              )}
              {batchesQ.data?.batches.map((b) => (
                <tr key={b.id} className="border-t hover:bg-gray-50">
                  <Td className="font-mono">{b.batch_number}</Td>
                  <Td><StatusPill status={b.status} /></Td>
                  <Td className="text-right font-mono">{rupees(b.total_amount)}</Td>
                  <Td className="text-center">{b.total_items}</Td>
                  <Td className="text-center font-mono">
                    <span className="text-emerald-700">{b.success_count}</span>
                    <span className="text-gray-400"> / </span>
                    <span className={b.failed_count > 0 ? "text-rose-700" : "text-gray-400"}>{b.failed_count}</span>
                  </Td>
                  <Td>{ago(b.created_at)}</Td>
                  <Td>{b.approved_at ? ago(b.approved_at) : "—"}</Td>
                  <Td>{b.completed_at ? ago(b.completed_at) : "—"}</Td>
                  <Td>
                    <Link className="text-indigo-700 hover:underline" href={`/admin/settlements/${b.id}`}>open</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending payable owners */}
      <section className="rounded border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b text-sm font-medium">
          Owners with Pending Payable
          <span className="ml-2 text-xs text-gray-500">(FIFO by oldest credit)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <Th>Owner ID</Th><Th className="text-center">Hostels</Th>
                <Th className="text-center">Credits</Th><Th className="text-right">Pending Amount</Th>
                <Th>Oldest Credit</Th>
              </tr>
            </thead>
            <tbody>
              {pendingQ.isLoading && <tr><td colSpan={5} className="p-4 text-center text-gray-400">Loading…</td></tr>}
              {pendingQ.data?.owners.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-gray-400">No pending liability. ✓</td></tr>
              )}
              {pendingQ.data?.owners.map((o) => {
                const ageDays = Math.floor((Date.now() - new Date(o.oldest_credit_at).getTime()) / (24 * 3600 * 1000));
                const aging = ageDays > 14 ? "text-rose-700 font-semibold" : ageDays > 7 ? "text-amber-700" : "text-gray-700";
                return (
                  <tr key={o.owner_id} className="border-t hover:bg-gray-50">
                    <Td className="font-mono text-[11px]">{o.owner_id}</Td>
                    <Td className="text-center">{o.hostel_count}</Td>
                    <Td className="text-center">{o.pending_credit_count}</Td>
                    <Td className="text-right font-mono">{rupees(o.pending_amount)}</Td>
                    <Td className={`font-mono ${aging}`}>{ageDays}d ago</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Th(props: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-medium px-3 py-2 ${props.className ?? ""}`}>{props.children}</th>;
}
function Td(props: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${props.className ?? ""}`}>{props.children}</td>;
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
