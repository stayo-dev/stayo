"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/**
 * Reconciliation dashboard.
 *
 * Surfaces the four invariant-violation views from the batch service:
 *
 *   - uncovered      (informational: pending liability awaiting batches)
 *   - over_covered   (CRITICAL: same credit in >1 active payout — must be 0)
 *   - orphan_debits  (CRITICAL: DEBIT_PAYOUT not linked to a SUCCESS item)
 *   - coverage_drift (CRITICAL: item.amount != SUM(covered_credits.amount) — canary for ledger tampering)
 *
 * The bottom three should always be empty in a healthy system. Phase 7
 * will wire alerts on top of these views.
 */

type Recon = {
  uncovered: Array<{ id: string; owner_id: string; hostel_id: string; amount: string; created_at: string }>;
  over_covered: Array<{ credit_id: string; owner_id: string; hostel_id: string; covered_by_item_count: number; item_ids: string[] }>;
  orphan_debits: Array<{ debit_id: string; batch_item_id: string | null; item_status: string | null }>;
  coverage_drift: Array<{ item_id: string; item_amount: string; covered_total: string; drift: string }>;
  counts: { uncovered: number; over_covered: number; orphan_debits: number; coverage_drift: number };
};

function rupees(n: string | number) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReconciliationPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-reconciliation"],
    queryFn: () => api.get<Recon>("/admin/settlements/reconciliation?limit=200&uncoveredLimit=500"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-rose-700">Error: {(error as any).message}</div>;
  if (!data) return null;

  const critical = data.counts.over_covered + data.counts.orphan_debits + data.counts.coverage_drift;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Reconciliation</h1>
        <span className={`text-xs px-2 py-1 rounded ${critical === 0 ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
          {critical === 0 ? "ALL INVARIANTS HOLD" : `${critical} CRITICAL ISSUE(S)`}
        </span>
      </header>

      {/* Critical (must be 0) */}
      <Card title="Over-Covered Credits" critical hint="Credits attributed to >1 active payout. Must be 0 — indicates a coverage-attribution race or a code path that bypassed eligibility filtering.">
        {data.over_covered.length === 0 ? <Empty good /> : (
          <Table headers={["Credit ID", "Owner", "Hostel", "Item Count", "Item IDs"]}>
            {data.over_covered.map((r) => (
              <tr key={r.credit_id} className="border-t hover:bg-rose-50">
                <Td className="font-mono text-[10px]">{r.credit_id}</Td>
                <Td className="font-mono text-[10px]">{r.owner_id.slice(0, 8)}</Td>
                <Td className="font-mono text-[10px]">{r.hostel_id.slice(0, 8)}</Td>
                <Td className="text-center font-mono">{r.covered_by_item_count}</Td>
                <Td className="font-mono text-[10px]">{r.item_ids.map((id) => id.slice(0, 8)).join(", ")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Orphan Debits" critical hint="DEBIT_PAYOUT entries whose backing batch_item is missing or not SUCCESS. Must be 0 — these represent recorded payouts the operational system has lost track of.">
        {data.orphan_debits.length === 0 ? <Empty good /> : (
          <Table headers={["Debit ID", "Batch Item ID", "Item Status"]}>
            {data.orphan_debits.map((r) => (
              <tr key={r.debit_id} className="border-t hover:bg-rose-50">
                <Td className="font-mono text-[10px]">{r.debit_id}</Td>
                <Td className="font-mono text-[10px]">{r.batch_item_id ?? "—"}</Td>
                <Td>{r.item_status ?? "(missing item)"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Coverage Drift" critical hint="Items where recorded amount disagrees with SUM of covered credit amounts. Must be 0 — canary for CREDIT-row tampering or attribution bugs.">
        {data.coverage_drift.length === 0 ? <Empty good /> : (
          <Table headers={["Item ID", "Item Amount", "Covered Total", "Drift"]}>
            {data.coverage_drift.map((r) => (
              <tr key={r.item_id} className="border-t hover:bg-rose-50">
                <Td className="font-mono text-[10px]">{r.item_id}</Td>
                <Td className="font-mono text-right">{rupees(r.item_amount)}</Td>
                <Td className="font-mono text-right">{rupees(r.covered_total)}</Td>
                <Td className="font-mono text-right text-rose-700">{rupees(r.drift)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Informational */}
      <Card title="Uncovered Credits" hint="Pending liability not yet attributed to any batch — informational. Drives the settlement queue.">
        {data.uncovered.length === 0 ? <Empty good={false} text="No pending liability." /> : (
          <Table headers={["Credit ID", "Owner", "Hostel", "Amount", "Aged"]}>
            {data.uncovered.slice(0, 200).map((r) => {
              const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (24 * 3600 * 1000));
              return (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <Td className="font-mono text-[10px]">{r.id.slice(0, 12)}</Td>
                  <Td className="font-mono text-[10px]">{r.owner_id.slice(0, 8)}</Td>
                  <Td className="font-mono text-[10px]">{r.hostel_id.slice(0, 8)}</Td>
                  <Td className="font-mono text-right">{rupees(r.amount)}</Td>
                  <Td className={`font-mono ${ageDays > 14 ? "text-rose-700" : ageDays > 7 ? "text-amber-700" : ""}`}>{ageDays}d</Td>
                </tr>
              );
            })}
          </Table>
        )}
        {data.uncovered.length > 200 && (
          <div className="px-4 py-2 text-xs text-gray-500">Showing first 200 of {data.counts.uncovered}.</div>
        )}
      </Card>
    </div>
  );
}

function Card(props: { title: string; hint: string; critical?: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded border ${props.critical ? "border-rose-200" : "border-gray-200"} bg-white`}>
      <div className={`px-4 py-3 border-b ${props.critical ? "bg-rose-50" : ""}`}>
        <div className="text-sm font-medium flex items-center gap-2">
          {props.title}
          {props.critical && <span className="text-[10px] px-1.5 py-0.5 bg-rose-600 text-white rounded">CRITICAL</span>}
        </div>
        <div className="text-[11px] text-gray-500 mt-1">{props.hint}</div>
      </div>
      {props.children}
    </section>
  );
}

function Table(props: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>{props.headers.map((h) => <th key={h} className="text-left font-medium px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

function Td(p: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${p.className ?? ""}`}>{p.children}</td>;
}

function Empty(props: { good: boolean; text?: string }) {
  return (
    <div className={`p-4 text-xs ${props.good ? "text-emerald-700" : "text-gray-400"}`}>
      {props.good ? "✓ No issues found." : (props.text ?? "Empty.")}
    </div>
  );
}
