"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

function formatCurrency(value: unknown) {
  const amount = Number(value || 0);
  return `Rs. ${amount.toLocaleString("en-IN")}`;
}

export default function ConfirmImportPage() {
  const router = useRouter();
  const params = useParams();
  const batchId = params.batchId as string;

  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [batchPreview, setBatchPreview] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBatchPreview() {
      try {
        const response = await fetch(`/api/bulk-import/${batchId}/confirm`, {
          method: "GET",
          credentials: "include",
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error?.message || result.error || "Failed to load import preview");
        }

        if (!cancelled) {
          setBatchPreview(result);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load import preview");
        }
      }
    }

    loadBatchPreview();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const validation = batchPreview?.validation || {
    total_rows: 0,
    valid_rows: 0,
    invalid_rows: 0,
    duplicate_rows: 0,
  };

  const handleConfirm = async () => {
    setIsImporting(true);
    setError(null);

    try {
      const response = await fetch(`/api/bulk-import/${batchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || result.error || "Import failed");
      }

      setImportResult(result);
    } catch (err: any) {
      setError(err.message || "Import failed. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  if (importResult) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-green-800">Import Successful</h3>
          <p className="mt-2 text-sm text-green-700">
            <strong>{importResult.result?.success_count || 0}</strong> tenants imported successfully.
          </p>
          {importResult.result?.failure_count > 0 && (
            <p className="mt-1 text-sm text-green-700">
              <strong>{importResult.result.failure_count}</strong> tenants failed.
            </p>
          )}
        </div>

        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <h3 className="text-sm font-medium text-red-800">IMPORTANT: Delete Your Excel File</h3>
          <p className="mt-2 text-sm text-red-700">
            Now that import is complete, permanently delete the XLSX file you uploaded. It contains temporary passwords that should not be stored.
          </p>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => router.push("/owner/tenants")}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
          >
            View Imported Tenants
          </button>
          <button
            onClick={() => router.push("/owner/bulk-import")}
            className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
          >
            Import More Tenants
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Confirm Import</h1>
      <p className="text-gray-600 mb-8">
        Review validation results and resolved rent before importing tenants.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white shadow rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Rows</p>
          <p className="text-2xl font-bold">{validation.total_rows}</p>
        </div>
        <div className="bg-green-50 shadow rounded-lg border border-green-200 p-4">
          <p className="text-sm text-green-600">Valid</p>
          <p className="text-2xl font-bold text-green-700">{validation.valid_rows}</p>
        </div>
        <div className="bg-red-50 shadow rounded-lg border border-red-200 p-4">
          <p className="text-sm text-red-600">Invalid</p>
          <p className="text-2xl font-bold text-red-700">{validation.invalid_rows}</p>
        </div>
        <div className="bg-yellow-50 shadow rounded-lg border border-yellow-200 p-4">
          <p className="text-sm text-yellow-600">Duplicates</p>
          <p className="text-2xl font-bold text-yellow-700">{validation.duplicate_rows}</p>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg border p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">Resolved Rent Preview</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-3 pr-4">Tenant</th>
                <th className="py-3 pr-4">Room</th>
                <th className="py-3 pr-4">Derived Rent</th>
                <th className="py-3 pr-4">Deposit</th>
                <th className="py-3 pr-4">Maintenance</th>
              </tr>
            </thead>
            <tbody>
              {(batchPreview?.preview?.valid || []).map((row: any) => (
                <tr key={row.row} className="border-b">
                  <td className="py-3 pr-4 font-medium">{row.data.name}</td>
                  <td className="py-3 pr-4">{row.data.room_no}</td>
                  <td className="py-3 pr-4 font-semibold text-green-700">{formatCurrency(row.data.monthly_rent)}</td>
                  <td className="py-3 pr-4">{formatCurrency(row.data.advance_deposit)}</td>
                  <td className="py-3 pr-4">
                    {formatCurrency(row.data.maintenance_charge)} {row.data.maintenance_type?.toLowerCase?.()}
                  </td>
                </tr>
              ))}
              {!batchPreview?.preview?.valid?.length && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    {error ? "Preview unavailable" : "Loading preview..."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-4">
          Rent comes from room configuration, not the uploaded file.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={() => router.push("/owner/bulk-import")}
          disabled={isImporting}
          className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={isImporting || validation.valid_rows === 0}
          className={`flex-1 py-2 px-4 rounded-md text-white ${
            isImporting || validation.valid_rows === 0
              ? "bg-gray-300 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {isImporting ? "Importing..." : `Confirm Import (${validation.valid_rows} valid rows)`}
        </button>
      </div>
    </div>
  );
}
