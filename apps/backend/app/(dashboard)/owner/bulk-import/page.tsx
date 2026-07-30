"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Tenant Onboarding Campaign - Upload & Validate
 * 
 * Allows hostel owners to upload XLSX/CSV files containing tenant data
 * for bulk import. Validates the file and shows preview before import.
 */
export default function BulkImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [hostelId, setHostelId] = useState<string>("");
  const [joiningDate, setJoiningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [advanceDeposit, setAdvanceDeposit] = useState("");
  const [maintenanceCharge, setMaintenanceCharge] = useState("");
  const [maintenanceType, setMaintenanceType] = useState("MONTHLY");
  const [billingStartMode, setBillingStartMode] = useState("JOINING_DATE");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    
    if (!validTypes.includes(selectedFile.type)) {
      setError("Invalid file type. Please upload XLSX or CSV file.");
      setFile(null);
      return;
    }

    // Validate file size (5MB max)
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError("File too large. Maximum size is 5MB.");
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file || !hostelId) {
      setError("Please select a file and hostel.");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("hostel_id", hostelId);
      formData.append("joining_date", joiningDate);
      formData.append("advance_deposit", advanceDeposit);
      formData.append("maintenance_charge", maintenanceCharge);
      formData.append("maintenance_type", maintenanceType);
      formData.append("billing_start_mode", billingStartMode);

      const response = await fetch("/api/bulk-import/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || result.error || "Upload failed");
      }

      // Navigate to confirmation page
      router.push(`/owner/bulk-import/${result.batch_id}/confirm`);
    } catch (err: any) {
      setError(err.message || "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Tenant Onboarding Campaign</h1>
      <p className="text-gray-600 mb-8">
        Configure owner defaults, collect tenant identity details, and import with room-derived rent.
      </p>

      {/* Security Warning */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800">Security Notice</h3>
            <div className="mt-2 text-sm text-yellow-700">
              <p>For security, <strong>DELETE</strong> the exported XLSX file after successful import.</p>
              <p className="mt-1">The file may contain temporary onboarding credentials.</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Import completes → Delete Excel file</li>
                <li>Change Google Form password after export</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      <div className="bg-white shadow rounded-lg border p-6">
        <div className="space-y-6">
          {/* Hostel Selection */}
          <div>
            <label htmlFor="hostelId" className="block text-sm font-medium text-gray-700 mb-2">
              Select Hostel
            </label>
            <input
              type="text"
              id="hostelId"
              value={hostelId}
              onChange={(e) => setHostelId(e.target.value)}
              placeholder="Enter Hostel ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Enter the UUID of the hostel where tenants will be imported
            </p>
          </div>

          {/* Campaign Defaults */}
          <div>
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Owner Defaults</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Joining Date</span>
                <input
                  type="date"
                  value={joiningDate}
                  onChange={(e) => setJoiningDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Billing Start</span>
                <select
                  value={billingStartMode}
                  onChange={(e) => setBillingStartMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="JOINING_DATE">Joining date</option>
                  <option value="IMPORT_DATE">Import date</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Deposit</span>
                <input
                  type="number"
                  min="0"
                  value={advanceDeposit}
                  onChange={(e) => setAdvanceDeposit(e.target.value)}
                  placeholder="Use hostel default"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Maintenance</span>
                <div className="grid grid-cols-[1fr_140px] gap-2">
                  <input
                    type="number"
                    min="0"
                    value={maintenanceCharge}
                    onChange={(e) => setMaintenanceCharge(e.target.value)}
                    placeholder="Use default"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={maintenanceType}
                    onChange={(e) => setMaintenanceType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="ONE_TIME">One-time</option>
                    <option value="NONE">None</option>
                  </select>
                </div>
              </label>
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-2">
              Upload Tenant Identity File
            </label>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md hover:border-gray-400">
              <div className="space-y-1 text-center">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="flex text-sm text-gray-600">
                  <label
                    htmlFor="file-upload"
                    className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
                  >
                    <span>Upload a file</span>
                    <input
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      className="sr-only"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileSelect}
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-500">XLSX, XLS, or CSV up to 5MB</p>
                <p className="text-xs text-gray-500">Maximum 150 rows per file</p>
              </div>
            </div>
            {file && (
              <p className="mt-2 text-sm text-green-600">
                ✓ Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Upload Button */}
          <div>
            <button
              onClick={handleUpload}
              disabled={!file || !hostelId || isUploading}
              className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                !file || !hostelId || isUploading
                  ? "bg-gray-300 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              }`}
            >
              {isUploading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Validating...
                </span>
              ) : (
                "Review Campaign"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">Tenant-Entered Columns</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li><strong>name</strong> - Tenant name (required)</li>
          <li><strong>phone</strong> - Phone number, 10 digits (required)</li>
          <li><strong>room_no</strong> - Room number (required)</li>
          <li><strong>onboarding_password</strong> - Password for first login (required, 6+ chars, letter+number)</li>
          <li><strong>email</strong> - Email address (optional but recommended)</li>
        </ul>
        <p className="text-sm text-blue-700 mt-3 font-medium">
          Rent is resolved from room configuration. Deposit, maintenance, and billing dates come from owner defaults above.
        </p>
      </div>
    </div>
  );
}
