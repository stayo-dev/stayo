"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useState } from "react";

/**
 * 💸 PRODUCTION-READY: Payment Initiation
 * - Prevents duplicate submissions (isLoading lock)
 * - Detailed error feedback
 * - Method selection
 */
export function InitiatePaymentButton({ obligationId, amount }: { obligationId: string, amount: number }) {
  const [method, setMethod] = useState("RAZORPAY");

  const mutation = useMutation({
    mutationFn: (data: any) => api.post("/payments/initiate", data),
    onSuccess: (data: any) => {
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    },
  });

  const handlePay = () => {
    // UI-level guard to prevent double-click spam
    if (mutation.isPending) return;
    mutation.mutate({ obligationId, method, amount });
  };

  return (
    <div className="flex flex-col gap-2">
      <select 
        value={method} 
        onChange={(e) => setMethod(e.target.value)}
        className="border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none"
        disabled={mutation.isPending}
      >
        <option value="RAZORPAY">Razorpay Checkout</option>
      </select>
      
      <button
        onClick={handlePay}
        disabled={mutation.isPending}
        className={`bg-blue-600 text-white px-4 py-2 rounded font-medium transition-all ${
          mutation.isPending ? "opacity-70 cursor-not-allowed scale-95" : "hover:bg-blue-700 active:scale-95"
        }`}
      >
        {mutation.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Securing Connection...
          </span>
        ) : (
          `Complete Payment (₹${amount})`
        )}
      </button>
      
      {mutation.isError && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
          ⚠️ {(mutation.error as any).message}
        </div>
      )}
    </div>
  );
}
