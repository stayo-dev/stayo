"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Treasury overview dashboard.
 *
 * Renders the FIVE money buckets distinguished by the financial-ops
 * brief:
 *
 *   1. Platform revenue           — what Sunrise Residency earned
 *   2. Owner payable liability    — what is currently owed to owners (live)
 *   3. Unsettled liability        — un-reserved subset of (2)
 *   4. Settled payouts (window)   — money disbursed in the window
 *   5. Failed payout exposure     — failed items not yet retried
 *
 * Each bucket card includes the underlying counts so the operator can
 * drill into the relevant queue.
 */

type Dashboard = {
  window_days: number;
  buckets: {
    hms_platform_revenue: { total: string; payment_count: number };
    owner_payable_liability: { total: string; owner_hostel_pairs: number };
    unsettled_liability: { total: string; credit_count: number };
    settled_payouts_in_window: { total: string; debit_count: number; window_days: number };
    failed_payout_exposure: { total: string; failed_item_count: number; orphan_credit_count: number };
  };
  reconciliation: {
    uncovered_credits: number;
    over_covered_credits: number;
    orphan_debits: number;
    coverage_drift: number;
    healthy: boolean;
  };
  operational: {
    batches_by_status: Array<{ status: string; _count: { _all: number } }>;
    items_by_payout_status: Array<{ payout_status: string; _count: { _all: number } }>;
    oldest_unsettled_credit: { created_at: string | null; age_days: number | null };
  };
};

function rupees(n: string | number) {
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminOverviewPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-dashboard", days],
    queryFn: () => api.get<Dashboard>(`/admin/settlements/dashboard?days=${days}`),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">Error: {(error as any).message}</div>;
  if (!data) return null;

  const reconHealthy = data.reconciliation.healthy;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Treasury Overview</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Window</label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs border-gray-300 rounded px-2 py-1"
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </header>

      {/* The 5 buckets — distinct, never mixed. */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <Bucket
          tone="indigo"
          label="Sunrise Residency Platform Revenue"
          sub={`${data.buckets.hms_platform_revenue.payment_count} payments · last ${days}d`}
          value={rupees(data.buckets.hms_platform_revenue.total)}
          note="Subscriptions + add-ons. Never mixed with owner liability."
        />
        <Bucket
          tone="slate"
          label="Owner Payable Liability"
          sub={`${data.buckets.owner_payable_liability.owner_hostel_pairs} owner-hostel pairs · live`}
          value={rupees(data.buckets.owner_payable_liability.total)}
          note="Sum of current ledger balances owed to owners."
        />
        <Bucket
          tone="amber"
          label="Unsettled Liability"
          sub={`${data.buckets.unsettled_liability.credit_count} credits · not in any active batch`}
          value={rupees(data.buckets.unsettled_liability.total)}
          note="Subset of payable liability, awaiting batch attribution."
        />
        <Bucket
          tone="emerald"
          label="Settled Payouts"
          sub={`${data.buckets.settled_payouts_in_window.debit_count} debits · last ${days}d`}
          value={rupees(data.buckets.settled_payouts_in_window.total)}
          note="DEBIT_PAYOUT entries in window."
        />
        <Bucket
          tone="rose"
          label="Failed Payout Exposure"
          sub={`${data.buckets.failed_payout_exposure.failed_item_count} items · ${data.buckets.failed_payout_exposure.orphan_credit_count} orphan credits`}
          value={rupees(data.buckets.failed_payout_exposure.total)}
          note="Failed items whose credits are not re-attempted."
        />
      </section>

      {/* Reconciliation health */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`rounded border p-4 ${reconHealthy ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Reconciliation Health</div>
            <span className={`text-xs px-2 py-0.5 rounded ${reconHealthy ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
              {reconHealthy ? "HEALTHY" : "ATTENTION"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <Stat label="Uncovered credits" value={data.reconciliation.uncovered_credits} hint="awaiting batch" />
            <Stat label="Over-covered credits" value={data.reconciliation.over_covered_credits} hint="must be 0" alert={data.reconciliation.over_covered_credits > 0} />
            <Stat label="Orphan debits" value={data.reconciliation.orphan_debits} hint="must be 0" alert={data.reconciliation.orphan_debits > 0} />
            <Stat label="Coverage drift" value={data.reconciliation.coverage_drift} hint="must be 0" alert={data.reconciliation.coverage_drift > 0} />
          </div>
          <Link href="/admin/reconciliation" className="text-xs text-indigo-700 hover:underline inline-block mt-3">View reconciliation dashboard →</Link>
        </div>

        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium">Operational Signals</div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <div>
              <div className="text-gray-500">Oldest unsettled credit</div>
              <div className="font-mono">
                {data.operational.oldest_unsettled_credit.age_days != null
                  ? `${data.operational.oldest_unsettled_credit.age_days} days`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Batches in flight</div>
              <div className="font-mono">
                {data.operational.batches_by_status
                  .filter((b) => ["DRAFT", "APPROVED", "PROCESSING"].includes(b.status))
                  .reduce((s, b) => s + b._count._all, 0)}
              </div>
            </div>
          </div>
          <Link href="/admin/settlements" className="text-xs text-indigo-700 hover:underline inline-block mt-3">View settlement queue →</Link>
        </div>
      </section>

      {/* Status histograms */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Histogram
          title="Batches by Status"
          rows={data.operational.batches_by_status.map((r) => ({ key: r.status, count: r._count._all }))}
        />
        <Histogram
          title="Items by Payout Status"
          rows={data.operational.items_by_payout_status.map((r) => ({ key: r.payout_status, count: r._count._all }))}
        />
      </section>
    </div>
  );
}

function Bucket(props: { tone: string; label: string; sub: string; value: string; note: string }) {
  const toneBg: Record<string, string> = {
    indigo: "border-indigo-200 bg-white",
    slate: "border-slate-200 bg-white",
    amber: "border-amber-200 bg-white",
    emerald: "border-emerald-200 bg-white",
    rose: "border-rose-200 bg-white",
  };
  const toneText: Record<string, string> = {
    indigo: "text-indigo-700",
    slate: "text-slate-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
  };
  return (
    <div className={`rounded border p-4 ${toneBg[props.tone]}`}>
      <div className={`text-xs uppercase tracking-wide ${toneText[props.tone]}`}>{props.label}</div>
      <div className="text-2xl font-semibold mt-2 font-mono">{props.value}</div>
      <div className="text-xs text-gray-500 mt-1">{props.sub}</div>
      <div className="text-[11px] text-gray-400 mt-2">{props.note}</div>
    </div>
  );
}

function Stat(props: { label: string; value: number; hint: string; alert?: boolean }) {
  return (
    <div>
      <div className="text-gray-500">{props.label}</div>
      <div className={`font-mono ${props.alert ? "text-rose-700 font-semibold" : ""}`}>
        {props.value} <span className="text-gray-400 text-[10px]">({props.hint})</span>
      </div>
    </div>
  );
}

function Histogram(props: { title: string; rows: Array<{ key: string; count: number }> }) {
  const max = Math.max(1, ...props.rows.map((r) => r.count));
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="text-sm font-medium mb-2">{props.title}</div>
      <div className="space-y-1">
        {props.rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <div className="w-32 text-gray-600 truncate">{r.key}</div>
            <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
              <div className="h-full bg-gray-700" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="w-10 text-right font-mono">{r.count}</div>
          </div>
        ))}
        {props.rows.length === 0 && <div className="text-xs text-gray-400">No data</div>}
      </div>
    </div>
  );
}
