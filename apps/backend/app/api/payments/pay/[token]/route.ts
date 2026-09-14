export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { paymentService } from "@/src/services/payments/payment-service";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";
import { financialService } from "@/src/services/payments/financial-service";
import { getProviderContext } from "@/src/services/payments/merchant-context";
import { getLogger } from "@/lib/logger";
import { frontendUrl } from "@/lib/config/domains";
import { DOG_CONCERNED, DOG_HAPPY, stayoMark } from "./brand";

const logger = getLogger("api.payments.pay");

/**
 * Format a date as "June 2026" style
 */
function formatMonth(date: Date | string | null): string {
  if (!date) return "N/A";
  const d = new Date(date);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}

/**
 * Format currency as ₹X,XXX
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

/**
 * Render a self-contained HTML payment summary page.
 * Mobile-optimized, no JS framework needed.
 */
function renderPage(content: {
  title: string;
  hostelName: string;
  tenantName: string;
  status: "DUE" | "PAID" | "EXPIRED" | "ERROR";
  dueMonth?: string;
  dueDate?: string;
  amount?: number;
  supportPhone?: string;
  token?: string;
  errorMessage?: string;
  roomNo?: string;
  breakdown?: { label: string; value: number }[];
  openedFromWhatsApp?: boolean;
  hostelAddress?: string;
  logoUrl?: string;
  monthlyRent?: number;
}): string {
  const {
    title,
    hostelName,
    tenantName,
    status,
    dueMonth,
    dueDate,
    amount,
    supportPhone,
    token,
    errorMessage,
    roomNo = "N/A",
    breakdown = [],
    openedFromWhatsApp = false,
    hostelAddress = "",
    logoUrl = "",
    monthlyRent = 0,
  } = content;

  const statusBlock = (() => {
    switch (status) {
      case "DUE":
        return `
          <div class="amount-card">
            <p class="label">Amount to Pay</p>
            <div class="amount-input-row">
              <span class="amount-currency">₹</span>
              <input type="number" id="amount-input" class="amount-input" min="1" step="1" inputmode="numeric" value="${Math.round(amount || 0)}" />
            </div>
          </div>

          <div class="breakdown-box">
            <p class="breakdown-title">Payment Breakdown</p>
            <div id="breakdown-content">
              <p class="breakdown-loading">Calculating...</p>
            </div>
          </div>

          <button type="button" id="pay-btn" class="pay-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Pay ${formatCurrency(amount || 0)} securely
          </button>
          <div id="error-message" class="error-msg" style="display: none;"></div>
        `;
      case "PAID":
        return `
          <div class="status-card paid">
            <div class="dog-stage">${DOG_HAPPY}</div>
            ${amount ? `<p class="status-amount">${formatCurrency(amount)}</p>` : ""}
            <p class="status-text">Rent paid${dueMonth ? ` for ${dueMonth}` : ""}</p>
            <p class="status-sub">That's settled — nothing more to do. Your receipt is on its way to you on WhatsApp.</p>
          </div>
        `;
      case "EXPIRED":
        return `
          <div class="status-card expired">
            <div class="dog-stage">${DOG_CONCERNED}</div>
            <p class="status-text">This link has expired</p>
            <p class="status-sub">Payment links last seven days. ${supportPhone ? "Ask" : "Ask"} ${hostelName} for a fresh one and it will arrive on WhatsApp.</p>
          </div>
        `;
      case "ERROR":
        return `
          <div class="status-card error">
            <div class="dog-stage">${DOG_CONCERNED}</div>
            <p class="status-text">${errorMessage || "Something went wrong"}</p>
            <p class="status-sub">Nothing has been charged. ${hostelName} can send you a new link.</p>
          </div>
        `;
    }
  })();

  const razorpayScript = status === "DUE" ? `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>` : "";

  const clientScript = status === "DUE" ? `
    <script>
      (function() {
        window.consoleLogs = window.consoleLogs || [];
        const originalLog = console.log;
        console.log = function(...args) {
          window.consoleLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          originalLog.apply(console, args);
        };
        const originalError = console.error;
        console.error = function(...args) {
          window.consoleLogs.push('ERROR: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          originalError.apply(console, args);
        };
        window.addEventListener('error', function(e) {
          window.consoleLogs.push('UNCAUGHT ERROR: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
        });

        const payBtn = document.getElementById('pay-btn');
        // The idle label, captured once. Restoring it with innerHTML keeps the
        // padlock and the amount; the old code assigned innerText, which threw
        // the icon away the first time the button was ever re-enabled.
        const payBtnIdleLabel = payBtn ? payBtn.innerHTML : '';
        const errorMsg = document.getElementById('error-message');
        const logoUrl = "${logoUrl}";

        const amountInput = document.getElementById('amount-input');
        const breakdownContent = document.getElementById('breakdown-content');
        const monthlyRent = ${Number(monthlyRent || 0)};
        let previewDebounceTimer = null;

        function renderBreakdown(plan) {
          if (!breakdownContent) return;
          if (!plan.payment_accepted) {
            breakdownContent.innerHTML = '<p class="breakdown-error">' + escapeHtml(plan.rejection_reason || 'This amount cannot be accepted.') + '</p>';
            return;
          }
          const rows = plan.allocations
            .filter(function(a) { return a.allocated > 0; })
            .map(function(a) {
              return '<div class="breakdown-row"><span>' + escapeHtml(a.label) + '</span><span>₹' + Number(a.allocated).toLocaleString('en-IN') + '</span></div>';
            })
            .join('');
          // ADR-036: no advance/future-credit row — every rupee lands on an
          // installment, so the breakdown is exactly the allocations.
          breakdownContent.innerHTML = rows || '<p class="breakdown-loading">Enter an amount above.</p>';
        }

        async function fetchPreview(amount) {
          if (!amount || amount <= 0) {
            if (breakdownContent) breakdownContent.innerHTML = '<p class="breakdown-loading">Enter an amount above.</p>';
            return;
          }
          try {
            const res = await fetch(window.location.pathname, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'preview', amount: amount })
            });
            const data = await res.json();
            if (data.success) renderBreakdown(data.plan);
          } catch (e) {
            console.error('preview fetch failed', e);
          }
        }

        if (amountInput) {
          fetchPreview(Number(amountInput.value));
          amountInput.addEventListener('input', function() {
            clearTimeout(previewDebounceTimer);
            previewDebounceTimer = setTimeout(function() {
              fetchPreview(Number(amountInput.value));
            }, 400);
          });
        }

        if (payBtn) {
          payBtn.addEventListener('click', async () => {
            payBtn.disabled = true;
            payBtn.innerText = 'Initializing...';
            if (errorMsg) errorMsg.style.display = 'none';

            const enteredAmount = Number(amountInput ? amountInput.value : 0);
            if (!enteredAmount || enteredAmount <= 0) {
              payBtn.disabled = false;
              payBtn.innerHTML = payBtnIdleLabel;
              if (errorMsg) { errorMsg.textContent = 'Please enter an amount before proceeding.'; errorMsg.style.display = 'block'; }
              return;
            }
            if (monthlyRent > 0 && enteredAmount > monthlyRent * 3) {
              const confirmed = window.confirm('That is a large amount (₹' + enteredAmount.toLocaleString('en-IN') + '). Are you sure you want to proceed?');
              if (!confirmed) {
                payBtn.disabled = false;
                payBtn.innerHTML = payBtnIdleLabel;
                return;
              }
            }

            try {
              const response = await fetch(window.location.pathname, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action: 'initiate', amount: enteredAmount })
              });

              const data = await response.json();
              console.log('[Payment Link Client Debug] Received response:', data);
              if (!data.success) {
                throw new Error(data.error?.message || data.error || 'Failed to initiate payment');
              }

              const attempt = data.attempt;
              console.log('[Payment Link Client Debug] data.attempt:', attempt);
              if (attempt) {
                console.log('[Payment Link Client Debug] data.attempt.raw_response:', attempt.raw_response);
              }
              const raw_response = attempt ? attempt.raw_response : null;
              const raw = typeof raw_response === "string"
                  ? JSON.parse(raw_response)
                  : raw_response || {};

              console.log('[Payment Link Client Debug] parsed raw_response (raw):', raw);
              console.log('[Payment Link Client Debug] raw.key_id:', raw.key_id);
              console.log('[Payment Link Client Debug] raw.amount:', raw.amount);
              console.log('[Payment Link Client Debug] raw.currency:', raw.currency);
              console.log('[Payment Link Client Debug] attempt.gateway_txn_id:', attempt ? attempt.gateway_txn_id : undefined);

              const options = {
                key: raw.key_id,
                amount: raw.amount,
                currency: raw.currency || 'INR',
                name: '${hostelName.replace(/'/g, "\\'")}',
                description: '${dueMonth} Rent Payment',
                order_id: attempt ? attempt.gateway_txn_id : undefined,
                image: logoUrl || '${frontendUrl("/hostel_icon.png")}',
                prefill: {
                  name: raw.notes?.tenant_name || '',
                  email: raw.notes?.tenant_email || '',
                  contact: raw.notes?.tenant_phone || '',
                },
                theme: {
                  color: '#F97316',
                },
                handler: async (rzpResponse) => {
                  payBtn.innerText = 'Verifying...';
                  try {
                    const verifyRes = await fetch(window.location.pathname, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        action: 'verify',
                        attempt_id: attempt.id,
                        razorpay_payment_id: rzpResponse.razorpay_payment_id,
                        razorpay_order_id: rzpResponse.razorpay_order_id,
                        razorpay_signature: rzpResponse.razorpay_signature
                      })
                    });                     const verifyData = await verifyRes.json();
                    if (verifyData.success && (verifyData.status === 'SUCCESS' || verifyData.attempt?.status === 'SUCCESS')) {
                      document.querySelector('.container').innerHTML = \`
                        <div class="header-section">
                          <div class="hostel-logo-container">
                            \${logoUrl ? \`<img class="hostel-logo" src="\${logoUrl}" alt="Hostel Logo"/>\` : \`<span class="hostel-logo-fallback">🏠</span>\`}
                          </div>
                          <p class="hostel-name">\${escapeHtml("${hostelName}")}</p>
                          <div class="verified-badge">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                            <span>Verified Hostel</span>
                          </div>
                        </div>
                        
                        <div class="status-card paid">
                          <div class="status-icon">
                            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          </div>
                          <p class="status-text">Payment Successful</p>
                          <p class="status-sub">Your payment has been successfully recorded. Thank you!</p>
                        </div>
                        \${"${supportPhone}" ? \`<p class="support">Need help? Call <a href="tel:${supportPhone}">${supportPhone}</a></p>\` : ""}
                        \${"${hostelAddress}" ? \`
                        <div class="footer-section">
                          <p class="footer-hostel-info">\${escapeHtml("${hostelName}")}</p>
                          <p>\${escapeHtml("${hostelAddress}")}</p>
                        </div>
                        \` : ""}
                      \`;
                    } else if (verifyData.success && (verifyData.status === 'PENDING_VERIFICATION' || verifyData.attempt?.status === 'PENDING_VERIFICATION')) {
                      document.querySelector('.container').innerHTML = \`
                        <div class="header-section">
                          <div class="hostel-logo-container">
                            \${logoUrl ? \`<img class="hostel-logo" src="\${logoUrl}" alt="Hostel Logo"/>\` : \`<span class="hostel-logo-fallback">🏠</span>\`}
                          </div>
                          <p class="hostel-name">\${escapeHtml("${hostelName}")}</p>
                        </div>
                        
                        <div class="status-card pending">
                          <div class="status-icon">
                            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#F97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          </div>
                          <p class="status-text">Payment Received</p>
                          <p class="status-sub">We're confirming your payment. This usually takes a few seconds. Feel free to close this page.</p>
                        </div>
                        \${"${supportPhone}" ? \`<p class="support">Need help? Call <a href="tel:${supportPhone}">${supportPhone}</a></p>\` : ""}
                        \${"${hostelAddress}" ? \`
                        <div class="footer-section">
                          <p class="footer-hostel-info">\${escapeHtml("${hostelName}")}</p>
                          <p>\${escapeHtml("${hostelAddress}")}</p>
                        </div>
                        \` : ""}
                      \`;
                    } else {
                      throw new Error(verifyData.error?.message || verifyData.error || 'Payment verification pending or failed');
                    }
                  } catch (err) {
                    if (errorMsg) {
                      errorMsg.innerText = err.message || 'Payment verification failed. Please contact support.';
                      errorMsg.style.display = 'block';
                    }
                    payBtn.disabled = false;
                    payBtn.innerHTML = payBtnIdleLabel;
                  }
                },
                modal: {
                  ondismiss: () => {
                    payBtn.disabled = false;
                    payBtn.innerHTML = payBtnIdleLabel;
                  }
                }
              };
 
              console.log('[Payment Link Client Debug] Razorpay initialization options:');
              console.table(options);
              console.log('[Payment Link Client Debug] window.Razorpay definition:', window.Razorpay);

              // DIAGNOSTIC BEACON: Send checkout options to server so we can see them in Vercel logs.
              // Fire-and-forget — does not block checkout.
              try {
                fetch(window.location.pathname, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'client_diagnostic',
                    diagnostic: {
                      key_defined: options.key !== undefined && options.key !== null,
                      key_type: typeof options.key,
                      key_length: options.key ? options.key.length : 0,
                      key_prefix: options.key ? options.key.substring(0, 8) : '__UNDEFINED__',
                      order_id_defined: options.order_id !== undefined && options.order_id !== null,
                      order_id: options.order_id || '__UNDEFINED__',
                      amount: options.amount,
                      currency: options.currency,
                      raw_response_type: typeof data.attempt?.raw_response,
                      raw_response_keys: data.attempt?.raw_response ? Object.keys(data.attempt.raw_response) : [],
                      window_razorpay_defined: typeof window.Razorpay !== 'undefined',
                    }
                  })
                }).catch(function() {});
              } catch(e) {}

              const rzp = new window.Razorpay(options);
              rzp.open();
            } catch (err) {
              if (errorMsg) {
                errorMsg.innerText = err.message || 'Failed to initialize checkout';
                errorMsg.style.display = 'block';
              }
              payBtn.disabled = false;
              payBtn.innerHTML = payBtnIdleLabel;
            }
          });
        }

        function escapeHtml(str) {
          return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }
      })();
    </script>
  ` : "";

  const whatsappContinuityHtml = (openedFromWhatsApp && status === "DUE") ? `
    <div class="wa-banner">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <div>
        <p class="wa-badge">WhatsApp Reminder</p>
        <span>Hello ${tenantName} 👋 You're paying your ${dueMonth} hostel rent.</span>
      </div>
    </div>
  ` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="Payment for ${hostelName}">
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  ${razorpayScript}
  <style>
    /*
     * Stayo brand tokens, mirroring apps/frontend/src/styles/tokens/marketing.css.
     * The marketing palette rather than the product one: this page is read by a
     * resident or a guardian who has never seen the owner app, reached from a
     * WhatsApp message — a public surface, not a logged-in one.
     */
    :root {
      --bg: #fbefe9;
      --card: #ffffff;
      --fg: #2f2f2f;
      --muted-fg: #7a6e64;
      --primary: #a45d44;
      --primary-fg: #ffffff;
      --secondary: #f3e7dd;
      --accent: #d2986c;
      --soft: #fbf8f3;
      --line: rgba(47, 47, 47, 0.1);
      --success: #1f8a5b;
      --danger: #b8442f;
      --radius: 18px;
      --shadow: 0 1px 2px rgba(47, 32, 24, 0.04), 0 12px 32px -12px rgba(47, 32, 24, 0.16);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, .display { font-family: Manrope, Inter, sans-serif; }
    .container {
      max-width: 448px;
      width: 100%;
      background: var(--card);
      border-radius: 26px;
      padding: 28px 24px 24px;
      box-shadow: var(--shadow);
      border: 1px solid var(--line);
      text-align: center;
      animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: none; }
    }

    /* ── The WhatsApp continuity banner ───────────────────────────────── */
    .wa-banner {
      background: var(--soft);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 22px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      text-align: left;
      font-size: 13px;
      color: var(--fg);
      line-height: 1.45;
    }
    .wa-banner svg { flex-shrink: 0; color: var(--success); margin-top: 1px; }
    .wa-badge {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--success);
      letter-spacing: 0.6px;
      margin-bottom: 2px;
      font-family: Manrope, Inter, sans-serif;
    }

    /* ── Whose page this is ───────────────────────────────────────────── */
    .header-section { display: flex; flex-direction: column; align-items: center; margin-bottom: 22px; }
    .hostel-logo-container {
      width: 60px; height: 60px;
      background: var(--secondary);
      border: 1px solid var(--line);
      border-radius: 18px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 14px; overflow: hidden;
    }
    .hostel-logo { width: 100%; height: 100%; object-fit: cover; }
    .hostel-logo-fallback { font-size: 26px; line-height: 1; }
    .hostel-name {
      font-family: Manrope, Inter, sans-serif;
      font-size: 19px; font-weight: 800; letter-spacing: -0.01em;
      color: var(--fg); margin-bottom: 6px; line-height: 1.25;
    }
    .verified-badge {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 12px; font-weight: 600; color: var(--success);
      background: rgba(31, 138, 91, 0.08);
      border-radius: 999px; padding: 4px 10px;
    }

    /* ── The facts, as a quiet list rather than four boxes ─────────────── */
    .details-grid {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      margin-bottom: 18px;
      text-align: left;
    }
    .detail-card {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 12px; padding: 11px 14px;
      border-bottom: 1px solid var(--line);
    }
    .detail-card:last-child { border-bottom: 0; }
    .label {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.55px; color: var(--muted-fg);
      font-family: Manrope, Inter, sans-serif;
    }
    .val { font-size: 14px; font-weight: 600; color: var(--fg); text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .val.pending { color: var(--accent); }

    /* ── The number, which is what the page is for ─────────────────────── */
    .amount-card {
      background: var(--soft);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px 16px; margin-bottom: 14px;
    }
    .amount-card .label { display: block; margin-bottom: 10px; text-align: center; }
    .amount-input-row {
      display: flex; align-items: center; justify-content: center; gap: 2px;
      background: var(--card);
      border: 1.5px solid var(--line);
      border-radius: 14px; padding: 10px 14px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .amount-input-row:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(164, 93, 68, 0.12);
    }
    .amount-currency {
      font-family: Manrope, Inter, sans-serif;
      font-size: 26px; font-weight: 800; color: var(--primary);
    }
    .amount-input {
      font-family: Manrope, Inter, sans-serif;
      font-size: 30px; font-weight: 800; letter-spacing: -0.02em;
      color: var(--fg); background: transparent; border: 0; outline: none;
      width: 100%; max-width: 220px; text-align: left;
      -moz-appearance: textfield;
    }
    .amount-input::-webkit-outer-spin-button,
    .amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

    /* ── Where the money lands ─────────────────────────────────────────── */
    .breakdown-box {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 14px 16px; margin-bottom: 18px; text-align: left;
    }
    .breakdown-title {
      font-family: Manrope, Inter, sans-serif;
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.55px; color: var(--muted-fg); margin-bottom: 10px;
    }
    .breakdown-row {
      display: flex; justify-content: space-between; gap: 12px;
      font-size: 13.5px; padding: 5px 0; color: var(--fg);
    }
    .breakdown-row span:last-child { font-weight: 700; font-variant-numeric: tabular-nums; }
    .breakdown-loading { font-size: 13px; color: var(--muted-fg); }
    .breakdown-error { font-size: 13px; color: var(--danger); font-weight: 600; line-height: 1.45; }

    /* ── The one action ───────────────────────────────────────────────── */
    .pay-btn {
      width: 100%;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      font-family: Manrope, Inter, sans-serif;
      font-size: 15.5px; font-weight: 800;
      color: var(--primary-fg); background: var(--primary);
      border: 0; border-radius: 15px; padding: 16px 20px;
      cursor: pointer; min-height: 54px;
      box-shadow: 0 8px 20px -8px rgba(164, 93, 68, 0.55);
      transition: transform 0.12s ease, background 0.15s ease, box-shadow 0.15s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .pay-btn:hover { background: #8f5039; }
    .pay-btn:active { transform: scale(0.985); }
    .pay-btn:focus-visible { outline: 3px solid rgba(164, 93, 68, 0.35); outline-offset: 2px; }
    .pay-btn:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
    .error-msg {
      margin-top: 12px; font-size: 13px; font-weight: 600;
      color: var(--danger); background: rgba(184, 68, 47, 0.07);
      border-radius: 12px; padding: 10px 12px; line-height: 1.45;
    }

    /* ── Outcome states. ADR-191: the dog belongs to these, not to the
         payment form — nobody wants a cartoon watching them send money. ── */
    .status-card { padding: 6px 0 2px; }
    .dog-stage { width: 148px; height: 148px; margin: 0 auto 4px; }
    .dog { width: 100%; height: 100%; display: block; }
    .status-icon {
      width: 44px; height: 44px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 12px;
    }
    .status-card.paid .status-icon { background: rgba(31, 138, 91, 0.1); }
    .status-card.expired .status-icon,
    .status-card.error .status-icon { background: rgba(184, 68, 47, 0.08); }
    .status-text {
      font-family: Manrope, Inter, sans-serif;
      font-size: 19px; font-weight: 800; letter-spacing: -0.01em;
      color: var(--fg); margin-bottom: 6px; line-height: 1.3;
    }
    .status-sub { font-size: 14px; color: var(--muted-fg); line-height: 1.5; }
    .status-amount {
      font-family: Manrope, Inter, sans-serif;
      font-size: 28px; font-weight: 800; color: var(--success);
      letter-spacing: -0.02em; margin-bottom: 6px;
    }

    /* ── Why this page can be trusted ─────────────────────────────────── */
    .trust-container {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px;
      margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line);
      text-align: left;
    }
    .trust-item {
      display: flex; align-items: center; gap: 7px;
      font-size: 12.5px; font-weight: 600; color: var(--muted-fg);
    }
    .trust-item svg { flex-shrink: 0; color: var(--accent); }
    .support { margin-top: 16px; font-size: 13px; color: var(--muted-fg); }
    .support a { color: var(--primary); font-weight: 700; text-decoration: none; }
    .footer-section {
      margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line);
      font-size: 12px; color: var(--muted-fg); line-height: 1.5;
    }
    .footer-hostel-info { font-weight: 700; color: var(--fg); margin-bottom: 2px; }

    /* ── Stayo disclosed as the channel, never as the counterparty.
         Same promise as the WhatsApp template footer.  ─────────────────── */
    .stayo-footer {
      display: flex; align-items: center; justify-content: center; gap: 7px;
      margin-top: 18px; font-size: 11.5px; font-weight: 600;
      color: var(--muted-fg); letter-spacing: 0.01em;
    }
    .stayo-footer .mark { color: var(--primary); display: block; }

    @media (max-width: 380px) {
      .container { padding: 22px 18px 20px; border-radius: 22px; }
      .amount-input { font-size: 26px; }
      .trust-container { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .container { animation: none; }
      .pay-btn { transition: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${whatsappContinuityHtml}
    
    <div class="header-section">
      <div class="hostel-logo-container">
        ${logoUrl ? `<img class="hostel-logo" src="${logoUrl}" alt="Hostel Logo"/>` : `<span class="hostel-logo-fallback">🏠</span>`}
      </div>
      <p class="hostel-name">${hostelName}</p>
      <div class="verified-badge">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <span>Verified Hostel</span>
      </div>
    </div>

    ${status === "DUE" ? `
      <div class="details-grid">
        <div class="detail-card">
          <span class="label">Resident</span>
          <span class="val" title="${tenantName}">${tenantName}</span>
        </div>
        <div class="detail-card">
          <span class="label">Room</span>
          <span class="val">${roomNo}</span>
        </div>
        <div class="detail-card">
          <span class="label">Rent period</span>
          <span class="val">${dueMonth || "N/A"}</span>
        </div>
        <div class="detail-card">
          <span class="label">Status</span>
          <span class="val pending">Pending</span>
        </div>
      </div>
    ` : ""}

    ${statusBlock}

    ${status === "DUE" ? `
      <div class="trust-container">
        <div class="trust-item">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zm-1-6l-3-3 1.41-1.41L11 13.17l4.59-4.59L17 10l-6 6z"/></svg>
          <span>Secure Razorpay</span>
        </div>
        <div class="trust-item">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          <span>Instant Receipt</span>
        </div>
        <div class="trust-item">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
          <span>WhatsApp Updates</span>
        </div>
        <div class="trust-item">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
          <span>Hostel Verified</span>
        </div>
      </div>
    ` : ""}

    ${supportPhone ? `<p class="support">Need help? Call <a href="tel:${supportPhone}">${supportPhone}</a></p>` : ""}

    ${hostelAddress ? `
      <div class="footer-section">
        <p class="footer-hostel-info">${hostelName}</p>
        <p>${hostelAddress}</p>
      </div>
    ` : ""}

    <!--
      Stayo names itself as the channel, never as the counterparty — the same
      promise the WhatsApp template footer makes. The reader's trust is in
      their own hostel, whose name is at the top; this says who carried the
      message and who is securing the payment.
    -->
    <div class="stayo-footer">
      <span class="mark">${stayoMark(15)}</span>
      <span>Payments secured by Stayo</span>
    </div>
  </div>
  ${clientScript}
</body>
</html>`;
}

/**
 * Safely parses and sanitizes a raw token from the URL parameter.
 * Logs if the token was malformed but successfully recovered, or if it is unrecoverable.
 */
function sanitizeAndValidateToken(rawToken: string, requestType: "GET" | "POST"): { token: string | null; errorResponse?: NextResponse } {
  let token = rawToken;
  let decoded: string | null = null;
  try {
    decoded = decodeURIComponent(rawToken);
  } catch (e) {
    // decodeURIComponent threw a URIError (e.g. due to %7T in malformed Meta prefix)
  }

  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let match = decoded ? decoded.match(uuidRegex) : null;
  if (!match) {
    match = rawToken.match(uuidRegex);
  }

  if (match) {
    token = match[0];
    if (token !== rawToken) {
      logger.warn("payment_link.token.sanitized", {
        requestType,
        original: rawToken,
        sanitized: token,
        message: "Token was malformed/prefixed but recovered via UUID extraction. This indicates an upstream WhatsApp template configuration anomaly."
      });
    }
  } else if (decoded && decoded.startsWith("{{1}}")) {
    token = decoded.substring(5);
    logger.warn("payment_link.token.sanitized", {
      requestType,
      original: rawToken,
      sanitized: token,
      message: "Token was malformed/prefixed with {{1}} but recovered. This indicates an upstream WhatsApp template configuration anomaly."
    });
  } else if (rawToken.startsWith("{{1}}")) {
    token = rawToken.substring(5);
    logger.warn("payment_link.token.sanitized", {
      requestType,
      original: rawToken,
      sanitized: token,
      message: "Token was malformed/prefixed with {{1}} but recovered. This indicates an upstream WhatsApp template configuration anomaly."
    });
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  if (!isUuid) {
    logger.warn("payment_link.token.invalid_format", { requestType, rawToken, parsedToken: token });
    if (requestType === "GET") {
      const html = renderPage({
        title: "Payment Not Found",
        hostelName: "Sunrise Residency",
        tenantName: "Resident",
        status: "ERROR",
        errorMessage: "Payment Link Not Found",
      });
      return {
        token: null,
        errorResponse: new NextResponse(html, {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }) as any
      };
    } else {
      return {
        token: null,
        errorResponse: NextResponse.json({ success: false, error: "Invalid payment token format." }, { status: 400 })
      };
    }
  }

  return { token };
}

/**
 * GET /api/payments/pay/[token]
 *
 * Public endpoint. Renders a payment summary page.
 * No authentication required — access is gated by the cryptographic token.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  const result = sanitizeAndValidateToken(rawToken, "GET");
  if (result.errorResponse) {
    return result.errorResponse;
  }
  const token = result.token!;

  try {
    // 1. Token lookup
    const linkToken = await prisma.payment_link_tokens.findUnique({
      where: { token },
      include: {
        rent_obligations: {
          include: {
            payments: { select: { amount_paid: true } },
          },
        },
        tenants: {
          include: {
            profiles: { select: { name: true } },
            room_allocations: {
              where: { is_active: true },
              include: { room: { select: { room_no: true } } },
              take: 1
            }
          },
        },
        hostels: {
          select: {
            name: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            pincode: true,
            logo_url: true,
          },
        },
      },
    });

    if (!linkToken) {
      return new NextResponse(
        renderPage({
          title: "Payment Not Found",
          hostelName: "Sunrise Residency",
          tenantName: "",
          status: "ERROR",
          errorMessage: "This payment link is not valid.",
        }),
        { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const hostelName = linkToken.hostels.name || "Sunrise Residency";
    const tenantName = linkToken.tenants.profiles?.name || "Tenant";
    const supportPhone = linkToken.hostels.phone || "";
    const obligation = linkToken.rent_obligations;

    const hostelAddressParts = [
      linkToken.hostels.address,
      linkToken.hostels.city,
      linkToken.hostels.state,
      linkToken.hostels.pincode,
    ].filter(Boolean);
    const hostelAddress = hostelAddressParts.join(", ");
    const logoUrl = linkToken.hostels.logo_url || "";

    // Room Number resolution
    const roomNo = linkToken.tenants.room_allocations?.[0]?.room?.room_no || "N/A";

    // WhatsApp continuity resolution
    let openedFromWhatsApp = false;
    try {
      const url = new URL(_req.url);
      const sourceParam = url.searchParams.get("source");
      if (sourceParam === "wa" || sourceParam === "whatsapp") {
        openedFromWhatsApp = true;
      } else if (obligation) {
        const hasWaLog = await prisma.whatsapp_logs.findFirst({
          where: { obligation_id: obligation.id }
        });
        if (hasWaLog) {
          openedFromWhatsApp = true;
        }
      }
    } catch (err) {
      logger.error("whatsapp_source_check.failed", { error: String(err) });
    }

    // 2. Expiry check
    if (linkToken.expires_at < new Date()) {
      return new NextResponse(
        renderPage({
          title: "Link Expired",
          hostelName,
          tenantName,
          status: "EXPIRED",
          supportPhone,
          hostelAddress,
          logoUrl,
        }),
        { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // 3. Compute the default amount to pre-fill.
    // Priority: (a) the hinted obligation's remaining balance, if any and
    // still unpaid; (b) what's actually due today or overdue across the
    // tenant's obligations. Deliberately NOT the full remaining-lease total
    // (settlement-planner's total_outstanding sums every UPCOMING obligation
    // all the way to lease end) — a tenant with 11 months left would otherwise
    // see a pre-filled amount worth 11 months' rent. If nothing is due yet,
    // leave the field at 0 so the payer types whatever they want to pay.
    let defaultAmount = 0;
    if (obligation && obligation.status !== "PAID") {
      const paidAmount = obligation.payments.reduce(
        (sum: number, p: any) => sum + Number(p.amount_paid),
        0
      );
      defaultAmount = Math.max(0, Number(obligation.amount) - paidAmount);
    }

    if (defaultAmount <= 0) {
      const dues = await financialService.getTenantDues(
        linkToken.tenant_id,
        undefined,
        linkToken.hostel_id
      );
      const todayKey = new Date().toISOString().slice(0, 10);
      defaultAmount = dues.items
        .filter((i) => i.status !== "UPCOMING" && new Date(i.due_date).toISOString().slice(0, 10) <= todayKey)
        .reduce((sum, i) => sum + Number(i.outstanding ?? 0), 0);
    }

    const formatDate = (date: Date | string | null): string => {
      if (!date) return "N/A";
      const d = new Date(date);
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    };

    // 4. Render summary page with the editable amount + Proceed button
    return new NextResponse(
      renderPage({
        title: `Pay ${hostelName}`,
        hostelName,
        tenantName,
        status: "DUE",
        dueMonth: obligation ? formatMonth(obligation.rent_month) : undefined,
        dueDate: obligation ? formatDate(obligation.due_date) : undefined,
        amount: defaultAmount,
        supportPhone,
        token,
        roomNo,
        openedFromWhatsApp,
        hostelAddress,
        logoUrl,
        monthlyRent: Number(linkToken.tenants.monthly_rent || 0),
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (error: any) {
    console.error("GET error:", error);
    logger.error("payment_link.get.failed", { token, error: String(error?.message || error) });
    return new NextResponse(
      renderPage({
        title: "Error",
        hostelName: "Sunrise Residency",
        tenantName: "",
        status: "ERROR",
        errorMessage: "Something went wrong. Please try again.",
      }),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

/**
 * POST /api/payments/pay/[token]
 *
 * Creates or reuses a payment attempt, returning JSON details to the frontend
 * for client-side SDK payment initialization, or verifies the payment status.
 * No authentication required — access is gated by the cryptographic token.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  const result = sanitizeAndValidateToken(rawToken, "POST");
  if (result.errorResponse) {
    return result.errorResponse;
  }
  const token = result.token!;

  try {
    // 1. Re-validate token
    const linkToken = await prisma.payment_link_tokens.findUnique({
      where: { token },
      include: {
        rent_obligations: true,
        hostels: { select: { name: true, phone: true } },
        tenants: { include: { profiles: { select: { name: true } } } },
      },
    });

    if (!linkToken) {
      return NextResponse.json({ success: false, error: "This payment link is not valid." }, { status: 404 });
    }

    // 2. Expiry check
    if (linkToken.expires_at < new Date()) {
      return NextResponse.json({ success: false, error: "This payment link has expired." }, { status: 410 });
    }

    // Read request body to determine action
    let body: any = {};
    try {
      body = await _req.json();
    } catch (e) {
      // Default to initiate if body is missing or malformed
    }

    if (body.action === "client_diagnostic") {
      // DIAGNOSTIC: Client-side beacon reporting checkout options at runtime.
      // This lets us see the exact options.key value in Vercel logs.
      logger.info("payment_link.client_diagnostic", {
        token,
        ...body.diagnostic,
      });
      return NextResponse.json({ success: true, action: "diagnostic_received" });
    }

    if (body.action === "preview") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ success: false, error: "Enter a valid amount." }, { status: 400 });
      }

      const plan = await financialPaymentFacade.previewSettlement({
        tenantId: linkToken.tenant_id,
        hostelId: linkToken.hostel_id,
        amountRupees: amount,
      });

      return NextResponse.json({ success: true, plan });
    }

    if (body.action === "verify") {
      logger.info("payment_link.verify.initiate", {
        token,
        attempt_id: body.attempt_id,
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_order_id: body.razorpay_order_id,
      });

      // Verification uses owner role context since this is a public token lookup
      const verifyResult = await paymentService.verifyPaymentStatus({
        userId: linkToken.owner_id,
        role: "OWNER",
        attemptId: body.attempt_id,
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_order_id: body.razorpay_order_id,
        razorpay_signature: body.razorpay_signature,
      });

      return NextResponse.json({ success: true, ...verifyResult });
    }

    // Default: initiate payment
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "Enter a valid amount before proceeding." }, { status: 400 });
    }

    logger.info("payment_link.checkout.initiate", {
      token,
      amount,
      obligation_id: linkToken.obligation_id,
      tenant_id: linkToken.tenant_id,
      hostel_id: linkToken.hostel_id,
    });

    const rawAttempt = await paymentService.createAmountPaymentIntent(
      amount,
      linkToken.owner_id,
      linkToken.tenant_id,
      linkToken.hostel_id,
      { bypassCollectionPolicy: true, source: "PAYMENT_LINK" }
    );

    const attempt = (rawAttempt as any).isReused === true
      ? (rawAttempt as any).attempt
      : rawAttempt;

    if (attempt) {
      if (!attempt.raw_response || typeof attempt.raw_response !== "object") {
        attempt.raw_response = {};
      }

      // DIAGNOSTIC: Capture raw_response state BEFORE key_id injection
      const preInjectKeyId = attempt.raw_response.key_id;
      const preInjectKeys = Object.keys(attempt.raw_response);

      try {
        const providerContext = await getProviderContext({
          paymentDomain: "RENT_COLLECTION",
          flowType: "RENT",
          operationalOwnerId: linkToken.owner_id,
          hostelId: linkToken.hostel_id,
          scopeType: "HOSTEL",
        });
        attempt.raw_response.key_id = providerContext.config.key_id;
      } catch (e) {
        logger.warn("payment_link.inject_key_failed", { attemptId: attempt.id, error: String(e) });
      }

      // DIAGNOSTIC: Capture key_id state AFTER injection attempt
      logger.info("payment_link.key_id_diagnostic", {
        attemptId: attempt.id,
        attemptStatus: attempt.status,
        preInjectKeyId: preInjectKeyId ?? "__MISSING__",
        postInjectKeyId: attempt.raw_response.key_id ?? "__MISSING__",
        preInjectKeys,
        postInjectKeys: Object.keys(attempt.raw_response),
        gatewayTxnId: attempt.gateway_txn_id ?? "__MISSING__",
        hasRawCreateResponse: attempt.raw_create_response != null,
        rawCreateResponseType: typeof attempt.raw_create_response,
      });

      if (!attempt.raw_response.amount) {
        attempt.raw_response.amount = Math.round(Number(attempt.amount) * 100);
      }
      if (!attempt.raw_response.currency) {
        attempt.raw_response.currency = "INR";
      }
      if (!attempt.raw_response.notes) {
        attempt.raw_response.notes = {
          tenant_name: linkToken.tenants?.profiles?.name || "",
          tenant_email: linkToken.tenants?.profiles?.email || "",
          tenant_phone: linkToken.tenants?.profiles?.phone || "",
        };
      }
    }

    console.log("[Payment Link Server Debug] POST /pay/:token info:", {
      token,
      obligation_id: linkToken.obligation_id,
      payment_attempt_id: attempt?.id,
      gateway: attempt?.provider,
      gateway_transaction_id: attempt?.gateway_txn_id,
      raw_response: attempt?.raw_response,
      parsed_raw_response_type: typeof attempt?.raw_response,
      parsed_key_id: attempt?.raw_response?.key_id,
      parsed_order_id: attempt?.gateway_txn_id,
      parsed_amount: attempt?.raw_response?.amount,
      parsed_currency: attempt?.raw_response?.currency,
    });

    const responsePayload = {
      success: true,
      attempt,
    };

    console.log("[Payment Link Server Debug] Returning payload:", JSON.stringify(responsePayload, null, 2));

    // DIAGNOSTIC: Verify key_id survives JSON serialization
    // This is the definitive server-side checkpoint before the response hits the wire.
    try {
      const serialized = JSON.stringify(responsePayload);
      const reparsed = JSON.parse(serialized);
      logger.info("payment_link.response_serialization_check", {
        token,
        attemptId: attempt?.id,
        keyIdOnObject: attempt?.raw_response?.key_id ?? "__MISSING__",
        keyIdAfterReparse: reparsed?.attempt?.raw_response?.key_id ?? "__MISSING__",
        keyIdMatch: attempt?.raw_response?.key_id === reparsed?.attempt?.raw_response?.key_id,
        gatewayTxnIdOnObject: attempt?.gateway_txn_id ?? "__MISSING__",
        gatewayTxnIdAfterReparse: reparsed?.attempt?.gateway_txn_id ?? "__MISSING__",
        rawResponseKeysOnObject: attempt?.raw_response ? Object.keys(attempt.raw_response) : [],
        rawResponseKeysAfterReparse: reparsed?.attempt?.raw_response ? Object.keys(reparsed.attempt.raw_response) : [],
        serializedLength: serialized.length,
      });
    } catch (serErr) {
      logger.error("payment_link.serialization_failed", { token, error: String(serErr) });
    }

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    logger.error("payment_link.post.failed", { token, error: String(error?.message || error) });
    return NextResponse.json({
      success: false,
      error: error?.message || "Could not initiate payment. Please try again later."
    }, { status: 500 });
  }
}
